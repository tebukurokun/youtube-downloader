import path from "node:path";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`環境変数 ${name} は正の整数で指定してください: ${raw}`);
  }
  return value;
}

function listEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== "");
}

const MiB = 1024 * 1024;
const workRoot = path.resolve(process.env.WORK_DIR ?? path.join(process.cwd(), "tmp"));

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: intEnv("PORT", 3000),
  /** DNS rebinding 対策: 受け付ける Host ヘッダー */
  allowedHosts: listEnv("ALLOWED_HOSTS", ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]),
  /** 状態変更リクエストで許可する Origin（allowedHosts の http:// に加えて許可するもの。開発用） */
  extraAllowedOrigins: listEnv("ALLOWED_ORIGINS", []),
  /** ビルド済みフロントエンドの配置先 */
  staticDir: path.resolve(process.env.STATIC_DIR ?? path.join(import.meta.dirname, "../../frontend/dist")),
  workRoot,
  jobsDir: path.join(workRoot, "jobs"),
  cacheDir: path.join(workRoot, "cache"),
  ytdlpPath: process.env.YTDLP_PATH ?? "yt-dlp",
  ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
  /** メタデータ取得のタイムアウト */
  infoTimeoutMs: intEnv("INFO_TIMEOUT_SEC", 60) * 1000,
  /** ダウンロード + 後処理全体のタイムアウト */
  downloadTimeoutMs: intEnv("DOWNLOAD_TIMEOUT_SEC", 60 * 60) * 1000,
  /** ffprobe による検証のタイムアウト */
  probeTimeoutMs: intEnv("PROBE_TIMEOUT_SEC", 30) * 1000,
  /** キャンセル時に SIGTERM から SIGKILL までの猶予 */
  killGraceMs: intEnv("KILL_GRACE_SEC", 5) * 1000,
  /** 解析結果（選択肢）の有効期限 */
  infoTtlMs: intEnv("INFO_TTL_SEC", 15 * 60) * 1000,
  /** 完成ファイルの保持期限 */
  fileRetentionMs: intEnv("FILE_RETENTION_SEC", 30 * 60) * 1000,
  /** ジョブ記録（メモリ）の保持期限 */
  jobRetentionMs: intEnv("JOB_RETENTION_SEC", 2 * 60 * 60) * 1000,
  sweepIntervalMs: intEnv("SWEEP_INTERVAL_SEC", 60) * 1000,
  /** 1ファイルの最大サイズ */
  maxFileSizeBytes: intEnv("MAX_FILESIZE_MB", 4096) * MiB,
  /** ダウンロード開始に必要な空き容量（推定サイズに加算） */
  minFreeDiskBytes: intEnv("MIN_FREE_DISK_MB", 1024) * MiB,
  /** 同時に実行できるメタデータ解析の数 */
  maxConcurrentInfo: intEnv("MAX_CONCURRENT_INFO", 2),
};

export type AppConfig = typeof config;
