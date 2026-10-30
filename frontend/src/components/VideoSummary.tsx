import type { VideoInfoResponse } from "@app/shared";
import { formatDuration } from "../format.ts";

export function VideoSummary({ info }: { info: VideoInfoResponse }) {
  return (
    <section className="video-summary" aria-label="動画情報">
      <img src={info.thumbnailUrl} alt="" width={240} height={180} referrerPolicy="no-referrer" />
      <div>
        <h2 className="video-title">{info.title}</h2>
        <p className="video-meta">
          {formatDuration(info.durationSeconds)}
          {info.channel !== null && <> / {info.channel}</>}
        </p>
      </div>
    </section>
  );
}
