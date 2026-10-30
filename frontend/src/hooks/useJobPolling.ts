import type { JobResponse, JobStatus } from "@app/shared";
import { useEffect, useState } from "react";
import { ApiError, getDownload } from "../api/client.ts";

const POLL_INTERVAL_MS = 1000;
const TERMINAL: ReadonlySet<JobStatus> = new Set(["completed", "failed", "cancelled"]);

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL.has(status);
}

/** ジョブ状態を1秒間隔で取得する。終了状態になったら停止する */
export function useJobPolling(initial: JobResponse | null): {
  job: JobResponse | null;
  pollError: string | null;
  setJob: (job: JobResponse | null) => void;
} {
  const [job, setJob] = useState<JobResponse | null>(initial);
  const [pollError, setPollError] = useState<string | null>(null);
  const jobId = job?.id;
  const done = job === null || isTerminal(job.status);

  useEffect(() => {
    if (jobId === undefined || done) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await getDownload(jobId, controller.signal);
        setPollError(null);
        setJob(next);
        if (isTerminal(next.status)) return;
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setPollError("ジョブが見つかりません（サーバーが再起動された可能性があります）");
          setJob(null);
          return;
        }
        setPollError(error instanceof Error ? error.message : "状態を取得できませんでした");
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    timer = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId, done]);

  return { job, pollError, setJob };
}
