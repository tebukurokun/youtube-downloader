import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.ts";
import { runCommand } from "./process.ts";

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
};

export function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * 外部から取得したタイトルを、保存用に安全なファイル名へ変換する。
 * パス区切り・制御文字・OSで禁止される文字を除去し、長さを制限する。
 */
export function safeFileName(title: string, ext: string, fallback = "video"): string {
  let base = title
    .normalize("NFC")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を除去するため
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");

  // Windows の予約名
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `_${base}`;

  // コードポイント単位で切り詰める（サロゲートペアを壊さない）
  const chars = [...base];
  if (chars.length > 120) base = chars.slice(0, 120).join("").trim();
  if (base === "") base = fallback;
  return `${base}.${ext}`;
}

/** RFC 6266 / 5987 形式の Content-Disposition。ASCII 以外は filename* で渡す */
export function contentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%;]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/** base 配下のパスであることを確認して返す（任意パスの読み込みを防ぐ） */
export function resolveInside(base: string, ...segments: string[]): string {
  const root = path.resolve(base);
  const target = path.resolve(root, ...segments);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`path escapes base directory: ${target}`);
  }
  return target;
}

export async function ensureWorkDirs(config: AppConfig): Promise<void> {
  await fs.mkdir(config.jobsDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(config.cacheDir, { recursive: true, mode: 0o700 });
}

export async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
}

/** jobs ディレクトリ内の、指定以外のディレクトリ・ファイルを削除する */
export async function removeOrphans(jobsDir: string, keep: Set<string>): Promise<string[]> {
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(jobsDir);
  } catch {
    return removed;
  }
  for (const entry of entries) {
    if (keep.has(entry)) continue;
    await removeDir(resolveInside(jobsDir, entry));
    removed.push(entry);
  }
  return removed;
}

export async function freeDiskBytes(dir: string): Promise<number> {
  const stats = await fs.statfs(dir);
  return stats.bavail * stats.bsize;
}

export interface ProbeResult {
  ok: boolean;
  streamTypes: string[];
  durationSeconds: number | null;
}

/** ffprobe で完成ファイルがメディアとして読めるか検証する */
export async function probeMedia(
  config: AppConfig,
  filePath: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const result = await runCommand(config.ffprobePath, {
    args: [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type:format=duration",
      "-of",
      "json",
      // サーバーが決めた絶対パスのみを渡す
      path.resolve(filePath),
    ],
    timeoutMs: config.probeTimeoutMs,
    killGraceMs: config.killGraceMs,
    signal,
    maxStdoutBytes: 1024 * 1024,
  });
  if (result.code !== 0) return { ok: false, streamTypes: [], durationSeconds: null };
  try {
    const parsed = JSON.parse(result.stdout) as {
      streams?: { codec_type?: string }[];
      format?: { duration?: string };
    };
    const streamTypes = (parsed.streams ?? []).map((s) => s.codec_type ?? "unknown");
    const duration = Number(parsed.format?.duration);
    return {
      ok: streamTypes.length > 0,
      streamTypes,
      durationSeconds: Number.isFinite(duration) ? duration : null,
    };
  } catch {
    return { ok: false, streamTypes: [], durationSeconds: null };
  }
}
