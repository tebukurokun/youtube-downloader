import type { JobResponse } from "@app/shared";
import { formatBytes } from "../format.ts";

const STATUS_LABELS: Record<JobResponse["status"], string> = {
  queued: "開始待ち",
  downloading: "ダウンロード中",
  processing: "後処理中",
  completed: "完了",
  failed: "失敗",
  cancelling: "キャンセル中",
  cancelled: "キャンセル済み",
};

interface Props {
  job: JobResponse;
  saved: boolean;
  onSave: () => void;
}

export function JobProgress({ job, saved, onSave }: Props) {
  const active = job.status === "queued" || job.status === "downloading" || job.status === "processing";
  const determinate = job.progress !== null && job.status !== "processing";
  const message = job.message !== STATUS_LABELS[job.status] ? job.message : "";

  return (
    <section className="job-progress" aria-live="polite">
      <p className={`status status-${job.status}`}>
        ステータス: {STATUS_LABELS[job.status]}
        {determinate && active && <span className="percent"> {job.progress?.toFixed(1)}%</span>}
        {message !== "" && active && <span className="status-message">（{message}）</span>}
      </p>

      {(active || job.status === "cancelling") && (
        <div
          className={`progress ${determinate ? "" : "indeterminate"}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={determinate ? (job.progress ?? 0) : undefined}
          aria-label={STATUS_LABELS[job.status]}
        >
          <div className="progress-bar" style={determinate ? { width: `${job.progress}%` } : undefined} />
        </div>
      )}

      {job.status === "failed" && job.error && (
        <p className="error" role="alert">
          {job.error.message}
          <span className="error-code">（{job.error.code}）</span>
        </p>
      )}

      {job.status === "completed" && job.file && (
        <div className="completed">
          {job.file.available && !saved ? (
            <a className="button primary" href={job.file.url} download={job.file.name} onClick={onSave}>
              ファイルを保存
            </a>
          ) : (
            <p className="hint">
              {saved
                ? "保存を開始しました。ブラウザのダウンロードを確認してください（送信後、サーバー上のファイルは削除されます）。"
                : "ファイルは送信済み、または保持期限切れのため削除されました。"}
            </p>
          )}
          <p className="file-meta">
            {job.file.name} · {formatBytes(job.file.sizeBytes)}
          </p>
        </div>
      )}
    </section>
  );
}
