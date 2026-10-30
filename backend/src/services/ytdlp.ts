import type { PublicError } from "@app/shared";
import type { AppConfig } from "../config.ts";
import type { DownloadPart, DownloadPlan, YtdlpInfo } from "./formats.ts";
import { runCommand } from "./process.ts";
import { canonicalVideoUrl } from "./youtube-url.ts";

export class YtdlpError extends Error {
  readonly publicError: PublicError;

  constructor(publicError: PublicError, detail?: string) {
    super(detail ?? publicError.message);
    this.publicError = publicError;
  }
}

const PROGRESS_MARKER = "__YTDL_PROGRESS__";
const POSTPROCESS_MARKER = "__YTDL_POSTPROCESS__";

/** 設定ファイル・Cookie を読み込まず、単一動画だけを扱う共通引数 */
function commonArgs(config: AppConfig): string[] {
  return [
    "--ignore-config",
    "--no-playlist",
    "--no-cookies",
    "--no-cookies-from-browser",
    "--js-runtimes",
    "deno",
    "--cache-dir",
    config.cacheDir,
    "--socket-timeout",
    "30",
    "--color",
    "never",
  ];
}

export function buildInfoArgs(config: AppConfig, videoId: string): string[] {
  return [...commonArgs(config), "--dump-single-json", "--skip-download", "--", canonicalVideoUrl(videoId)];
}

export function buildDownloadArgs(
  config: AppConfig,
  videoId: string,
  plan: DownloadPlan,
  jobDir: string,
): string[] {
  return [
    ...commonArgs(config),
    "--format",
    plan.formatSelector,
    ...plan.extraArgs,
    // リダイレクト等で別の動画やライブ配信に変わっていたら保存しない
    "--match-filters",
    `id='${videoId}' & !is_live`,
    "--paths",
    jobDir,
    "--output",
    "media.%(ext)s",
    "--max-filesize",
    String(config.maxFileSizeBytes),
    "--no-overwrites",
    "--no-mtime",
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "--abort-on-unavailable-fragments",
    "--newline",
    "--progress-template",
    `download:${PROGRESS_MARKER} %(info.format_id)s %(progress.status)s %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.fragment_index)s %(progress.fragment_count)s`,
    "--progress-template",
    `postprocess:${POSTPROCESS_MARKER} %(progress.postprocessor)s %(progress.status)s`,
    "--",
    canonicalVideoUrl(videoId),
  ];
}

export async function fetchVideoInfo(config: AppConfig, videoId: string): Promise<YtdlpInfo> {
  const result = await runCommand(config.ytdlpPath, {
    args: buildInfoArgs(config, videoId),
    timeoutMs: config.infoTimeoutMs,
    killGraceMs: config.killGraceMs,
  });
  if (result.spawnError) {
    throw new YtdlpError(
      { code: "YTDLP_NOT_AVAILABLE", message: "yt-dlp を起動できませんでした" },
      result.spawnError.message,
    );
  }
  if (result.timedOut) {
    throw new YtdlpError({ code: "TIMEOUT", message: "動画情報の取得がタイムアウトしました" });
  }
  if (result.code !== 0) {
    throw new YtdlpError(classifyYtdlpError(result.stderr), result.stderr.slice(-2000));
  }
  if (result.stdoutTruncated) {
    throw new YtdlpError({ code: "INFO_TOO_LARGE", message: "動画情報が大きすぎるため処理できません" });
  }

  let info: YtdlpInfo;
  try {
    info = JSON.parse(result.stdout) as YtdlpInfo;
  } catch {
    throw new YtdlpError({ code: "INFO_PARSE_FAILED", message: "動画情報を解析できませんでした" });
  }
  if (info === null || typeof info !== "object" || (info._type !== undefined && info._type !== "video")) {
    throw new YtdlpError({ code: "NOT_A_VIDEO", message: "単一動画として扱えないURLです" });
  }
  if (info.id !== videoId) {
    throw new YtdlpError(
      { code: "VIDEO_MISMATCH", message: "指定した動画と異なる動画が返されたため中止しました" },
      `expected ${videoId}, got ${String(info.id)}`,
    );
  }
  if (
    info.live_status === "is_live" ||
    info.live_status === "is_upcoming" ||
    info.live_status === "post_live"
  ) {
    throw new YtdlpError({
      code: "LIVE_NOT_SUPPORTED",
      message: "ライブ配信・配信予定・配信直後で処理中の動画には対応していません",
    });
  }
  return info;
}

/** yt-dlp の stderr を公開可能なエラーコードとメッセージに変換する */
export function classifyYtdlpError(stderr: string): PublicError {
  const text = stderr.toLowerCase();
  const rules: [RegExp, PublicError][] = [
    [/private video/, { code: "VIDEO_PRIVATE", message: "この動画は非公開です" }],
    [
      /members[- ]only|join this channel/,
      { code: "MEMBERS_ONLY", message: "メンバー限定の動画には対応していません" },
    ],
    [
      /confirm your age|age[- ]restricted|inappropriate for some users/,
      { code: "AGE_RESTRICTED", message: "年齢制限のある動画には対応していません（ログイン機能なし）" },
    ],
    [
      /available in your country|geo[- ]?restrict|blocked it in your country/,
      { code: "GEO_RESTRICTED", message: "この動画はお住まいの地域では利用できません" },
    ],
    [
      /not a bot|sign in to confirm/,
      {
        code: "BOT_CHECK",
        message: "YouTube から追加の確認を求められたため取得できませんでした。時間をおいて再試行してください",
      },
    ],
    [/drm/, { code: "DRM_PROTECTED", message: "DRMで保護された動画には対応していません" }],
    [
      /live event will begin|premieres in|is_live|this live event/,
      { code: "LIVE_NOT_SUPPORTED", message: "ライブ配信・配信予定の動画には対応していません" },
    ],
    [
      /requested format is not available/,
      {
        code: "FORMAT_UNAVAILABLE",
        message: "選択した形式が現在は利用できません。もう一度解析してください",
      },
    ],
    [
      /video (is )?unavailable|has been removed|no longer available|does not exist|account associated with this video has been terminated/,
      { code: "VIDEO_UNAVAILABLE", message: "動画が削除されたか、利用できない状態です" },
    ],
    [
      /http error 429|too many requests/,
      { code: "RATE_LIMITED", message: "アクセスが集中しています。時間をおいて再試行してください" },
    ],
    [
      /no space left on device/,
      { code: "INSUFFICIENT_STORAGE", message: "ディスクの空き容量が不足しています" },
    ],
    [
      /unable to download|connection|timed out|name or service not known|temporary failure in name resolution|network is unreachable/,
      {
        code: "NETWORK_ERROR",
        message: "ネットワークエラーが発生しました。接続を確認して再試行してください",
      },
    ],
  ];
  for (const [pattern, error] of rules) {
    if (pattern.test(text)) return error;
  }
  return { code: "YTDLP_FAILED", message: "動画の取得に失敗しました" };
}

export interface DownloadProgressEvent {
  type: "download";
  formatId: string;
  status: string;
  downloadedBytes: number | null;
  totalBytes: number | null;
  fragmentIndex: number | null;
  fragmentCount: number | null;
}

export interface PostprocessEvent {
  type: "postprocess";
  postprocessor: string;
  status: string;
}

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined || value === "NA" || value === "None") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseProgressLine(line: string): DownloadProgressEvent | PostprocessEvent | null {
  const trimmed = line.trim();
  if (trimmed.startsWith(PROGRESS_MARKER)) {
    const [, formatId, status, downloaded, total, estimate, fragIndex, fragCount] = trimmed.split(/\s+/);
    if (formatId === undefined || status === undefined) return null;
    return {
      type: "download",
      formatId,
      status,
      downloadedBytes: numberOrNull(downloaded),
      totalBytes: numberOrNull(total) ?? numberOrNull(estimate),
      fragmentIndex: numberOrNull(fragIndex),
      fragmentCount: numberOrNull(fragCount),
    };
  }
  if (trimmed.startsWith(POSTPROCESS_MARKER)) {
    const [, postprocessor, status] = trimmed.split(/\s+/);
    if (postprocessor === undefined || status === undefined) return null;
    return { type: "postprocess", postprocessor, status };
  }
  return null;
}

/**
 * 映像・音声など複数ファイルのダウンロード進捗を、全体の割合（0〜100）にまとめる。
 * 割合を算出できないときは null を返す（不定進捗表示にするため）。
 */
export class ProgressTracker {
  private readonly parts: DownloadPart[];
  private readonly weights: number[];
  private readonly fractions: number[];
  private known = false;

  constructor(parts: DownloadPart[]) {
    this.parts = parts;
    const sizes = parts.map((p) => p.sizeBytes);
    const total = sizes.every((s) => s !== null) ? sizes.reduce<number>((a, s) => a + (s ?? 0), 0) : 0;
    this.weights = parts.map((p) => (total > 0 ? (p.sizeBytes ?? 0) / total : 1 / parts.length));
    this.fractions = parts.map(() => 0);
  }

  update(event: DownloadProgressEvent): number | null {
    let index = this.parts.findIndex((p) => p.formatId === event.formatId);
    if (index === -1 && this.parts.length === 1) index = 0;
    if (index === -1) return this.percent();

    let fraction: number | null = null;
    if (event.status === "finished") fraction = 1;
    else if (event.downloadedBytes !== null && event.totalBytes !== null && event.totalBytes > 0) {
      fraction = event.downloadedBytes / event.totalBytes;
    } else if (event.fragmentIndex !== null && event.fragmentCount !== null && event.fragmentCount > 0) {
      fraction = event.fragmentIndex / event.fragmentCount;
    }
    if (fraction === null) return this.percent();

    // 後続のファイルに進んだら、それ以前のファイルは完了とみなす
    for (let i = 0; i < index; i++) this.fractions[i] = 1;
    this.fractions[index] = Math.max(this.fractions[index] ?? 0, Math.min(1, fraction));
    this.known = true;
    return this.percent();
  }

  percent(): number | null {
    if (!this.known) return null;
    const value = this.weights.reduce((sum, w, i) => sum + w * (this.fractions[i] ?? 0), 0);
    return Math.round(Math.min(1, value) * 1000) / 10;
  }
}
