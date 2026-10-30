import type { JobStatus, PublicError } from "@app/shared";
import type { DownloadPlan } from "../services/formats.ts";

export interface JobOutput {
  path: string;
  name: string;
  sizeBytes: number;
  ext: string;
}

export interface Job {
  id: string;
  videoId: string;
  title: string;
  plan: DownloadPlan;
  dir: string;
  status: JobStatus;
  progress: number | null;
  message: string;
  error?: PublicError;
  output?: JobOutput;
  /** 完成ファイルが削除済み（送信済み・保持期限切れ）か */
  fileRemoved: boolean;
  createdAt: number;
  finishedAt?: number;
  abort: AbortController;
}

export const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set([
  "queued",
  "downloading",
  "processing",
  "cancelling",
]);

export const CANCELLABLE_STATUSES: ReadonlySet<JobStatus> = new Set(["queued", "downloading", "processing"]);

export class JobError extends Error {
  readonly statusCode: number;
  readonly publicError: PublicError;

  constructor(statusCode: number, publicError: PublicError) {
    super(publicError.message);
    this.statusCode = statusCode;
    this.publicError = publicError;
  }
}
