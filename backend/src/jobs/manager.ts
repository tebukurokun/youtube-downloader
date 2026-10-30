import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { JobResponse, PublicError } from "@app/shared";
import type { AppConfig } from "../config.ts";
import {
  freeDiskBytes,
  probeMedia,
  removeDir,
  removeOrphans,
  resolveInside,
  safeFileName,
} from "../services/files.ts";
import type { DownloadPlan } from "../services/formats.ts";
import { runCommand } from "../services/process.ts";
import {
  buildDownloadArgs,
  classifyYtdlpError,
  ProgressTracker,
  parseProgressLine,
} from "../services/ytdlp.ts";
import { ACTIVE_STATUSES, CANCELLABLE_STATUSES, type Job, JobError } from "./types.ts";

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

const POSTPROCESS_MESSAGES: Record<string, string> = {
  Merger: "映像と音声を結合中",
  ExtractAudio: "MP3に変換中",
};

class JobFailure extends Error {
  readonly publicError: PublicError;

  constructor(publicError: PublicError, detail?: string) {
    super(detail ?? publicError.message);
    this.publicError = publicError;
  }
}

/**
 * ダウンロードジョブをメモリ上で管理する。
 * 同時実行は最大1件で、実行中に新しいジョブは作成できない。
 */
export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly running = new Set<Promise<void>>();
  private sweepTimer: NodeJS.Timeout | undefined;
  private readonly config: AppConfig;
  private readonly log: Logger;

  constructor(config: AppConfig, log: Logger) {
    this.config = config;
    this.log = log;
  }

  /** 起動時: 前回の残存作業ファイルを削除し、定期掃除を開始する */
  async start(): Promise<void> {
    const removed = await removeOrphans(this.config.jobsDir, new Set());
    if (removed.length > 0) this.log.info({ removed }, "removed leftover job directories");
    this.sweepTimer = setInterval(() => {
      this.sweep().catch((error: unknown) => this.log.error({ err: error }, "sweep failed"));
    }, this.config.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  /** 終了時: 実行中のジョブを停止し、作業ファイルを削除する */
  async stop(): Promise<void> {
    clearInterval(this.sweepTimer);
    for (const job of this.jobs.values()) {
      if (ACTIVE_STATUSES.has(job.status)) job.abort.abort();
    }
    await Promise.allSettled([...this.running]);
    await removeOrphans(this.config.jobsDir, new Set());
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  activeJob(): Job | undefined {
    for (const job of this.jobs.values()) {
      if (ACTIVE_STATUSES.has(job.status)) return job;
    }
    return undefined;
  }

  async create(videoId: string, title: string, plan: DownloadPlan): Promise<Job> {
    if (this.activeJob()) {
      throw new JobError(409, {
        code: "JOB_IN_PROGRESS",
        message: "他のダウンロードが実行中です。完了またはキャンセル後に再度お試しください",
      });
    }

    const required = this.config.minFreeDiskBytes + (plan.option.estimatedSizeBytes ?? 0) * 2;
    const free = await freeDiskBytes(this.config.jobsDir);
    if (free < required) {
      throw new JobError(507, {
        code: "INSUFFICIENT_STORAGE",
        message: "ディスクの空き容量が不足しているため開始できません",
      });
    }
    // 空き容量の確認中に別のジョブが作成された場合
    if (this.activeJob()) {
      throw new JobError(409, { code: "JOB_IN_PROGRESS", message: "他のダウンロードが実行中です" });
    }

    const id = randomUUID();
    const job: Job = {
      id,
      videoId,
      title,
      plan,
      dir: resolveInside(this.config.jobsDir, id),
      status: "queued",
      progress: null,
      message: "開始待ち",
      fileRemoved: false,
      createdAt: Date.now(),
      abort: new AbortController(),
    };
    this.jobs.set(id, job);

    const task = this.run(job).finally(() => this.running.delete(task));
    this.running.add(task);
    return job;
  }

  cancel(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new JobError(404, { code: "JOB_NOT_FOUND", message: "ジョブが見つかりません" });
    if (job.status === "cancelling") return job;
    if (!CANCELLABLE_STATUSES.has(job.status)) {
      throw new JobError(409, {
        code: "NOT_CANCELLABLE",
        message: "このジョブは既に終了しているためキャンセルできません",
      });
    }
    job.status = "cancelling";
    job.message = "キャンセル中";
    job.abort.abort();
    return job;
  }

  /** ファイルの送信が完了したら作業ファイルを削除する */
  async markSent(job: Job): Promise<void> {
    if (job.fileRemoved) return;
    job.fileRemoved = true;
    await removeDir(job.dir);
    this.log.info({ jobId: job.id }, "file sent; removed job directory");
  }

  toResponse(job: Job): JobResponse {
    const response: JobResponse = {
      id: job.id,
      status: job.status,
      progress: job.progress,
      message: job.message,
    };
    if (job.status === "completed" && job.output) {
      response.file = {
        name: job.output.name,
        sizeBytes: job.output.sizeBytes,
        url: `/api/downloads/${job.id}/file`,
        available: !job.fileRemoved,
      };
    }
    if (job.error) response.error = job.error;
    return response;
  }

  /** 保持期限を過ぎたファイル・ジョブ記録・管理外のディレクトリを削除する */
  async sweep(now = Date.now()): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.finishedAt === undefined) continue;
      if (!job.fileRemoved && now - job.finishedAt >= this.config.fileRetentionMs) {
        job.fileRemoved = true;
        await removeDir(job.dir);
        this.log.info({ jobId: job.id }, "retention expired; removed job directory");
      }
      if (now - job.finishedAt >= this.config.jobRetentionMs) this.jobs.delete(job.id);
    }
    const keep = new Set<string>();
    for (const job of this.jobs.values()) {
      if (!job.fileRemoved) keep.add(job.id);
    }
    const removed = await removeOrphans(this.config.jobsDir, keep);
    if (removed.length > 0) this.log.info({ removed }, "removed orphan job directories");
  }

  private async run(job: Job): Promise<void> {
    try {
      await fs.mkdir(job.dir, { recursive: true, mode: 0o700 });
      await this.download(job);
      if (job.abort.signal.aborted) throw new Error("cancelled");
      await this.verify(job);
      if (job.abort.signal.aborted) throw new Error("cancelled");
      job.status = "completed";
      job.progress = 100;
      job.message = "完了";
      this.log.info({ jobId: job.id, sizeBytes: job.output?.sizeBytes }, "job completed");
    } catch (error) {
      job.fileRemoved = true;
      await removeDir(job.dir).catch(() => undefined);
      if (job.abort.signal.aborted) {
        job.status = "cancelled";
        job.message = "キャンセルしました";
        this.log.info({ jobId: job.id }, "job cancelled");
      } else {
        job.status = "failed";
        job.error =
          error instanceof JobFailure
            ? error.publicError
            : { code: "INTERNAL_ERROR", message: "処理中にエラーが発生しました" };
        job.message = job.error.message;
        this.log.warn({ jobId: job.id, code: job.error.code, detail: String(error) }, "job failed");
      }
    } finally {
      job.finishedAt = Date.now();
    }
  }

  private async download(job: Job): Promise<void> {
    if (job.abort.signal.aborted) return;
    const tracker = new ProgressTracker(job.plan.parts);
    job.status = "downloading";
    job.message = "ダウンロード中";

    const result = await runCommand(this.config.ytdlpPath, {
      args: buildDownloadArgs(this.config, job.videoId, job.plan, job.dir),
      timeoutMs: this.config.downloadTimeoutMs,
      killGraceMs: this.config.killGraceMs,
      signal: job.abort.signal,
      onLine: (line) => {
        if (job.status === "cancelling") return;
        const event = parseProgressLine(line);
        if (!event) return;
        if (event.type === "download" && job.status === "downloading") {
          job.progress = tracker.update(event);
        } else if (event.type === "postprocess" && event.status !== "finished") {
          job.status = "processing";
          job.progress = null;
          job.message = POSTPROCESS_MESSAGES[event.postprocessor] ?? "後処理中";
        }
      },
    });

    if (result.aborted) return;
    if (result.spawnError) {
      throw new JobFailure({ code: "YTDLP_NOT_AVAILABLE", message: "yt-dlp を起動できませんでした" });
    }
    if (result.timedOut) {
      throw new JobFailure({ code: "TIMEOUT", message: "処理がタイムアウトしました" });
    }
    if (result.code !== 0) {
      throw new JobFailure(classifyYtdlpError(result.stderr), result.stderr.slice(-2000));
    }

    const output = `${result.stdout}\n${result.stderr}`;
    const ext = job.plan.option.container;
    const filePath = resolveInside(job.dir, `media.${ext}`);
    const stat = await fs.stat(filePath).catch(() => undefined);
    if (!stat?.isFile()) {
      if (/max-filesize|larger than max/i.test(output)) {
        throw new JobFailure({
          code: "FILE_TOO_LARGE",
          message: "ファイルサイズが上限を超えるため中止しました",
        });
      }
      if (/does not pass filter/i.test(output)) {
        throw new JobFailure({
          code: "VIDEO_MISMATCH",
          message: "指定した動画と一致しないため保存しませんでした",
        });
      }
      throw new JobFailure(
        { code: "NO_OUTPUT", message: "完成ファイルが見つかりませんでした" },
        output.slice(-2000),
      );
    }
    job.output = {
      path: filePath,
      name: safeFileName(job.title, ext),
      sizeBytes: stat.size,
      ext,
    };
  }

  private async verify(job: Job): Promise<void> {
    const output = job.output;
    if (!output) throw new JobFailure({ code: "NO_OUTPUT", message: "完成ファイルが見つかりませんでした" });
    job.status = "processing";
    job.progress = null;
    job.message = "ファイルを検証中";

    if (output.sizeBytes <= 0) {
      throw new JobFailure({ code: "INVALID_OUTPUT", message: "完成ファイルが空です" });
    }
    if (output.sizeBytes > this.config.maxFileSizeBytes) {
      throw new JobFailure({ code: "FILE_TOO_LARGE", message: "ファイルサイズが上限を超えています" });
    }
    const probe = await probeMedia(this.config, output.path, job.abort.signal);
    const required = job.plan.option.kind === "video" ? ["video", "audio"] : ["audio"];
    if (!probe.ok || !required.every((type) => probe.streamTypes.includes(type))) {
      throw new JobFailure(
        { code: "INVALID_OUTPUT", message: "完成ファイルをメディアとして読み込めませんでした" },
        `streams: ${probe.streamTypes.join(",")}`,
      );
    }
  }
}
