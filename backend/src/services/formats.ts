import type { FormatOption } from "@app/shared";

/** yt-dlp の info JSON のうち、このアプリが参照するフィールド */
export interface YtdlpFormat {
  format_id?: string;
  ext?: string;
  vcodec?: string | null;
  acodec?: string | null;
  height?: number | null;
  fps?: number | null;
  tbr?: number | null;
  abr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  protocol?: string;
  dynamic_range?: string | null;
  has_drm?: boolean | string;
  language_preference?: number | null;
  audio_channels?: number | null;
  format_note?: string | null;
}

export interface YtdlpInfo {
  _type?: string;
  id?: string;
  title?: string;
  channel?: string | null;
  uploader?: string | null;
  duration?: number | null;
  live_status?: string | null;
  formats?: YtdlpFormat[];
}

export interface DownloadPart {
  formatId: string;
  sizeBytes: number | null;
}

/** 選択肢IDから決まる、サーバー側だけが知るダウンロード手順 */
export interface DownloadPlan {
  option: FormatOption;
  /** yt-dlp の -f に渡す式（サーバーが生成した format_id のみで構成） */
  formatSelector: string;
  parts: DownloadPart[];
  /** 形式に応じた追加の yt-dlp 引数 */
  extraArgs: string[];
}

export interface BuildResult {
  plans: DownloadPlan[];
  notices: string[];
}

const FORMAT_ID_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/;
const ALLOWED_PROTOCOLS = new Set(["https", "http", "m3u8_native", "m3u8", "http_dash_segments"]);
/** MP3 (VBR V0) の平均ビットレート相当（バイト/秒）。推定サイズの計算にのみ使う */
const MP3_BYTES_PER_SECOND = 245_000 / 8;

type Codec = "h264" | "vp9" | "av1" | "other";

function hasCodec(value: string | null | undefined): boolean {
  return value !== undefined && value !== null && value !== "none";
}

function videoCodec(format: YtdlpFormat): Codec {
  const vcodec = format.vcodec ?? "";
  if (vcodec.startsWith("avc1") || vcodec.startsWith("h264")) return "h264";
  if (/^vp0?9/.test(vcodec)) return "vp9";
  if (vcodec.startsWith("av01")) return "av1";
  return "other";
}

function sizeOf(format: YtdlpFormat): number | null {
  const size = format.filesize ?? format.filesize_approx;
  return typeof size === "number" && size > 0 ? Math.round(size) : null;
}

function isUsable(format: YtdlpFormat): boolean {
  if (format.format_id === undefined || !FORMAT_ID_PATTERN.test(format.format_id)) return false;
  if (format.has_drm === true || format.has_drm === "maybe") return false;
  if (format.protocol !== undefined && !ALLOWED_PROTOCOLS.has(format.protocol)) return false;
  return format.ext !== "mhtml";
}

function isSdr(format: YtdlpFormat): boolean {
  return (
    format.dynamic_range === undefined || format.dynamic_range === null || format.dynamic_range === "SDR"
  );
}

/** HLS より、サイズが分かり進捗を正確に取れる直接ダウンロード（DASH）を優先する */
function directScore(format: YtdlpFormat): number {
  return format.protocol === undefined || format.protocol === "https" || format.protocol === "http" ? 1 : 0;
}

/** ダイナミックレンジ圧縮（DRC）版より通常版を優先する */
function nonDrcScore(format: YtdlpFormat): number {
  return /drc/i.test(`${format.format_id ?? ""} ${format.format_note ?? ""}`) ? 0 : 1;
}

/** 互換性（MP3 変換・一般的なプレイヤー）のためステレオ以下を優先する */
function stereoScore(format: YtdlpFormat): number {
  return (format.audio_channels ?? 2) <= 2 ? 1 : 0;
}

/** 元の言語・通常版・ステレオ・直接ダウンロードを優先し、その中で最もビットレートの高いものを選ぶ */
function pickAudio(formats: YtdlpFormat[]): YtdlpFormat | undefined {
  return [...formats].sort(
    (a, b) =>
      (b.language_preference ?? 0) - (a.language_preference ?? 0) ||
      nonDrcScore(b) - nonDrcScore(a) ||
      stereoScore(b) - stereoScore(a) ||
      directScore(b) - directScore(a) ||
      (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0),
  )[0];
}

function pickVideo(formats: YtdlpFormat[]): YtdlpFormat | undefined {
  return [...formats].sort(
    (a, b) => directScore(b) - directScore(a) || (b.fps ?? 0) - (a.fps ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0),
  )[0];
}

function sumSizes(parts: DownloadPart[]): number | null {
  let total = 0;
  for (const part of parts) {
    if (part.sizeBytes === null) return null;
    total += part.sizeBytes;
  }
  return total;
}

function part(format: YtdlpFormat): DownloadPart {
  return { formatId: format.format_id as string, sizeBytes: sizeOf(format) };
}

function heightLabel(height: number, fps: number | null | undefined): string {
  return fps !== undefined && fps !== null && fps > 30 ? `${height}p${Math.round(fps)}` : `${height}p`;
}

/**
 * yt-dlp が返した形式一覧から、実際に保存できる選択肢を組み立てる。
 * - 動画は解像度ごとに1つ。MP4 (H.264 + AAC) を優先し、結合のみで再エンコードはしない。
 * - H.264 が無い解像度は WebM (VP9 + Opus)、次に MP4 (AV1 + AAC) を元のコーデックのまま提供する。
 * - 音声は MP3 への変換のみ提供する。
 */
export function buildDownloadPlans(info: YtdlpInfo, maxFileSizeBytes: number): BuildResult {
  const formats = (info.formats ?? []).filter(isUsable);
  const notices: string[] = [];
  const candidates: DownloadPlan[] = [];

  const videoOnly = formats.filter(
    (f) => hasCodec(f.vcodec) && !hasCodec(f.acodec) && typeof f.height === "number" && isSdr(f),
  );
  const audioOnly = formats.filter((f) => hasCodec(f.acodec) && !hasCodec(f.vcodec));
  const muxed = formats.filter((f) => hasCodec(f.acodec) && hasCodec(f.vcodec));

  const m4aAudio = pickAudio(audioOnly.filter((f) => f.ext === "m4a" && f.acodec?.startsWith("mp4a")));
  const webmAudio = pickAudio(audioOnly.filter((f) => f.ext === "webm" && f.acodec === "opus"));

  const heights = [...new Set(videoOnly.map((f) => f.height as number))].sort((a, b) => b - a);
  for (const height of heights) {
    const atHeight = videoOnly.filter((f) => f.height === height);
    const h264 = pickVideo(atHeight.filter((f) => videoCodec(f) === "h264" && f.ext === "mp4"));
    const vp9 = pickVideo(atHeight.filter((f) => videoCodec(f) === "vp9" && f.ext === "webm"));
    const av1 = pickVideo(atHeight.filter((f) => videoCodec(f) === "av1" && f.ext === "mp4"));

    let video: YtdlpFormat | undefined;
    let audio: YtdlpFormat | undefined;
    let codec: Codec;
    let container: "mp4" | "webm";
    let note: string;
    if (h264 && m4aAudio) {
      [video, audio, codec, container] = [h264, m4aAudio, "h264", "mp4"];
      note = "MP4（H.264 / AAC）";
    } else if (vp9 && webmAudio) {
      [video, audio, codec, container] = [vp9, webmAudio, "vp9", "webm"];
      note = "WebM（VP9 / Opus）— この画質は MP4(H.264) で提供されていないため元の形式で保存します";
    } else if (av1 && m4aAudio) {
      [video, audio, codec, container] = [av1, m4aAudio, "av1", "mp4"];
      note = "MP4（AV1 / AAC）— 古いプレイヤーでは再生できない場合があります";
    } else {
      continue;
    }

    const parts = [part(video), part(audio)];
    candidates.push({
      option: {
        id: `video-${height}-${codec}`,
        kind: "video",
        label: heightLabel(height, video.fps),
        container,
        requiresMerge: true,
        requiresConversion: false,
        estimatedSizeBytes: sumSizes(parts),
        note,
      },
      formatSelector: parts.map((p) => p.formatId).join("+"),
      parts,
      extraArgs: ["--merge-output-format", container],
    });
  }

  // 映像のみの形式が無い場合は、映像・音声一体の MP4 を使う
  if (candidates.length === 0) {
    const single = pickVideo(
      muxed.filter((f) => f.ext === "mp4" && typeof f.height === "number" && videoCodec(f) === "h264"),
    );
    if (single) {
      const parts = [part(single)];
      candidates.push({
        option: {
          id: `video-${single.height}-muxed`,
          kind: "video",
          label: heightLabel(single.height as number, single.fps),
          container: "mp4",
          requiresMerge: false,
          requiresConversion: false,
          estimatedSizeBytes: sumSizes(parts),
          note: "MP4（H.264 / AAC）",
        },
        formatSelector: single.format_id as string,
        parts,
        extraArgs: [],
      });
    }
  }
  if (candidates.length === 0) {
    notices.push("保存可能な動画形式が見つかりませんでした");
  }

  const audioSource = pickAudio(audioOnly) ?? pickAudio(muxed);
  if (audioSource) {
    const parts = [part(audioSource)];
    const duration = typeof info.duration === "number" ? info.duration : null;
    candidates.push({
      option: {
        id: "audio-mp3",
        kind: "audio",
        label: "MP3",
        container: "mp3",
        requiresMerge: false,
        requiresConversion: true,
        estimatedSizeBytes: duration !== null ? Math.round(duration * MP3_BYTES_PER_SECOND) : null,
        note: "MP3（VBR 高音質）へ変換します。動画の長さによっては時間がかかります",
      },
      formatSelector: audioSource.format_id as string,
      parts,
      extraArgs: ["--extract-audio", "--audio-format", "mp3", "--audio-quality", "0"],
    });
  } else {
    notices.push("保存可能な音声形式が見つかりませんでした");
  }

  const plans: DownloadPlan[] = [];
  for (const plan of candidates) {
    const size = plan.option.estimatedSizeBytes;
    if (size !== null && size > maxFileSizeBytes) {
      notices.push(`${plan.option.label} はファイルサイズの上限を超えるため選択できません`);
    } else {
      plans.push(plan);
    }
  }
  return { plans, notices };
}
