import type { FormatKind, VideoInfoResponse } from "@app/shared";
import { useState } from "react";
import { ApiError, cancelDownload, createDownload, fetchVideoInfo } from "./api/client.ts";
import { FormatSelector } from "./components/FormatSelector.tsx";
import { JobProgress } from "./components/JobProgress.tsx";
import { UrlForm } from "./components/UrlForm.tsx";
import { UsageGuide } from "./components/UsageGuide.tsx";
import { VideoSummary } from "./components/VideoSummary.tsx";
import { isTerminal, useJobPolling } from "./hooks/useJobPolling.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "予期しないエラーが発生しました";
}

function defaultSelection(info: VideoInfoResponse): { kind: FormatKind; formatId: string } {
  // MP4 優先: 最高画質の MP4 を既定にし、無ければ最初の動画、次に音声
  const first =
    info.formats.find((f) => f.kind === "video" && f.container === "mp4") ??
    info.formats.find((f) => f.kind === "video") ??
    info.formats[0];
  return first ? { kind: first.kind, formatId: first.id } : { kind: "video", formatId: "" };
}

export function App() {
  const [analyzing, setAnalyzing] = useState(false);
  const [info, setInfo] = useState<VideoInfoResponse | null>(null);
  const [kind, setKind] = useState<FormatKind>("video");
  const [formatId, setFormatId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [saved, setSaved] = useState(false);
  const { job, pollError, setJob } = useJobPolling(null);

  const jobActive = job !== null && !isTerminal(job.status);
  const busy = analyzing || starting || jobActive;

  const analyze = async (url: string) => {
    setAnalyzing(true);
    setError(null);
    setInfo(null);
    setJob(null);
    try {
      const result = await fetchVideoInfo(url);
      const selection = defaultSelection(result);
      setInfo(result);
      setKind(selection.kind);
      setFormatId(selection.formatId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const changeKind = (next: FormatKind) => {
    setKind(next);
    setFormatId(info?.formats.find((f) => f.kind === next)?.id ?? "");
  };

  const start = async () => {
    if (!info || formatId === "" || busy) return;
    setStarting(true);
    setError(null);
    setSaved(false);
    try {
      setJob(await createDownload({ videoId: info.videoId, formatId }));
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.code === "INFO_EXPIRED") setInfo(null);
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    try {
      setJob(await cancelDownload(job.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Video Downloader</h1>
        <span className="badge">Local</span>
      </header>

      <main className="card">
        <UrlForm disabled={busy} analyzing={analyzing} onSubmit={analyze} />

        {analyzing && (
          <div className="progress indeterminate" role="progressbar" aria-label="解析中">
            <div className="progress-bar" />
          </div>
        )}

        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {!info && !analyzing && job === null && <UsageGuide />}

        {info && (
          <>
            <VideoSummary info={info} />
            {info.notices.length > 0 && (
              <ul className="notices">
                {info.notices.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
            )}
            <FormatSelector
              formats={info.formats}
              kind={kind}
              formatId={formatId}
              disabled={busy}
              onKindChange={changeKind}
              onFormatChange={setFormatId}
            />
            <div className="actions">
              <button type="button" className="primary" onClick={start} disabled={busy || formatId === ""}>
                {starting ? "開始中…" : "ダウンロード開始"}
              </button>
              <button type="button" onClick={cancel} disabled={!jobActive || job?.status === "cancelling"}>
                キャンセル
              </button>
            </div>
          </>
        )}

        {pollError !== null && (
          <p className="error" role="alert">
            {pollError}
          </p>
        )}
        {job && <JobProgress job={job} saved={saved} onSave={() => setSaved(true)} />}
      </main>

      <footer className="app-footer">ダウンロードする権利・許可のある動画にのみ使用してください。</footer>
    </div>
  );
}
