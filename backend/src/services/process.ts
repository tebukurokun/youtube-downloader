import { spawn } from "node:child_process";

export interface RunOptions {
  args: string[];
  timeoutMs: number;
  /** SIGTERM 送信から SIGKILL までの猶予 */
  killGraceMs: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** stdout / stderr を1行ずつ受け取る */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  /** 保持する stdout の上限（超過分は切り捨て、truncated を立てる） */
  maxStdoutBytes?: number;
  /** 保持する stderr の上限（末尾を残す） */
  maxStderrBytes?: number;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  timedOut: boolean;
  aborted: boolean;
  /** プロセスの起動自体に失敗した場合のエラー */
  spawnError?: Error;
}

/**
 * 外部コマンドをシェルを経由せずに実行する。
 * 独立したプロセスグループで起動し、タイムアウト・中断時は子プロセス（ffmpeg 等）も含めて停止する。
 */
export function runCommand(command: string, options: RunOptions): Promise<RunResult> {
  const maxStdout = options.maxStdoutBytes ?? 64 * 1024 * 1024;
  const maxStderr = options.maxStderrBytes ?? 256 * 1024;

  return new Promise((resolve) => {
    const child = spawn(command, options.args, {
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ?? minimalEnv(),
    });

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stdoutTruncated = false;
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let spawnError: Error | undefined;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let giveUpTimer: NodeJS.Timeout | undefined;

    const lineBuffers = { stdout: "", stderr: "" };
    const emitLines = (stream: "stdout" | "stderr", text: string, flush: boolean) => {
      if (!options.onLine) return;
      const parts = (lineBuffers[stream] + text).split(/\r\n|\r|\n/);
      lineBuffers[stream] = flush ? "" : (parts.pop() ?? "");
      for (const line of parts) {
        if (line !== "") options.onLine(line, stream);
      }
    };

    const killGroup = (sig: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, sig);
      } catch {
        // 既に終了している
      }
    };

    const terminate = () => {
      if (killTimer) return;
      killGroup("SIGTERM");
      killTimer = setTimeout(() => killGroup("SIGKILL"), options.killGraceMs);
      // SIGKILL 後も終了を確認できない場合は待つのをやめる
      giveUpTimer = setTimeout(() => finish(null, "SIGKILL"), options.killGraceMs * 2 + 1000);
    };

    const finish = (code: number | null, sig: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      clearTimeout(giveUpTimer);
      options.signal?.removeEventListener("abort", onAbort);
      // グループ内に残った子プロセスを確実に停止する
      killGroup("SIGKILL");
      emitLines("stdout", "", true);
      emitLines("stderr", "", true);
      resolve({
        code,
        signal: sig,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr,
        stdoutTruncated,
        timedOut,
        aborted,
        spawnError,
      });
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);

    const onAbort = () => {
      aborted = true;
      terminate();
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes < maxStdout) {
        stdoutChunks.push(chunk.subarray(0, maxStdout - stdoutBytes));
      }
      if (stdoutBytes + chunk.length > maxStdout) stdoutTruncated = true;
      stdoutBytes += chunk.length;
      emitLines("stdout", chunk.toString("utf8"), false);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr = (stderr + text).slice(-maxStderr);
      emitLines("stderr", text, false);
    });

    child.on("error", (error) => {
      spawnError = error;
      finish(null, null);
    });
    child.on("close", (code, sig) => finish(code, sig));
  });
}

/** 子プロセスに渡す環境変数。ホストやサーバーの不要な値を引き継がない */
export function minimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    LANG: "C.UTF-8",
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    DENO_NO_UPDATE_CHECK: "1",
  };
  for (const key of ["HOME", "DENO_DIR", "TZ"] as const) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
