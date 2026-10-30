import type { FormatKind, FormatOption } from "@app/shared";
import { formatBytes } from "../format.ts";

interface Props {
  formats: FormatOption[];
  kind: FormatKind;
  formatId: string;
  disabled: boolean;
  onKindChange: (kind: FormatKind) => void;
  onFormatChange: (formatId: string) => void;
}

function optionText(format: FormatOption): string {
  const size = format.estimatedSizeBytes === null ? "" : ` · 約 ${formatBytes(format.estimatedSizeBytes)}`;
  return `${format.label}（${format.container.toUpperCase()}）${size}`;
}

export function FormatSelector({ formats, kind, formatId, disabled, onKindChange, onFormatChange }: Props) {
  const videos = formats.filter((f) => f.kind === "video");
  const audios = formats.filter((f) => f.kind === "audio");
  const choices = kind === "video" ? videos : audios;
  const selected = formats.find((f) => f.id === formatId);

  return (
    <section className="format-selector" aria-label="保存形式">
      <div className="field">
        <label htmlFor="format-kind">保存形式</label>
        <select
          id="format-kind"
          value={kind}
          disabled={disabled}
          onChange={(event) => onKindChange(event.target.value as FormatKind)}
        >
          <option value="video" disabled={videos.length === 0}>
            動画（MP4優先）
          </option>
          <option value="audio" disabled={audios.length === 0}>
            音声（MP3）
          </option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="format-quality">{kind === "video" ? "画質" : "音質"}</label>
        <select
          id="format-quality"
          value={formatId}
          disabled={disabled || choices.length === 0}
          onChange={(event) => onFormatChange(event.target.value)}
        >
          {choices.length === 0 && <option value="">利用できる形式がありません</option>}
          {choices.map((format) => (
            <option key={format.id} value={format.id}>
              {optionText(format)}
            </option>
          ))}
        </select>
      </div>
      {selected?.note !== undefined && <p className="format-note">{selected.note}</p>}
    </section>
  );
}
