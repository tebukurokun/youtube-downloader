// API で受け渡す JSON の型。フロントエンドとバックエンドで共有する。
// 実行時コードは置かない（バックエンドは型のみを import するため）。

export type FormatKind = "video" | "audio";

export interface FormatOption {
  /** バックエンドが生成した選択肢ID（例: "video-1080-h264", "audio-mp3"） */
  id: string;
  kind: FormatKind;
  /** 画面表示用ラベル（例: "1080p60"） */
  label: string;
  /** 完成ファイルのコンテナ / 拡張子 */
  container: "mp4" | "webm" | "mp3";
  /** 映像と音声の結合が必要か（再エンコードなし） */
  requiresMerge: boolean;
  /** 再エンコード（変換）が必要か。時間がかかる場合がある */
  requiresConversion: boolean;
  /** 推定ファイルサイズ（不明な場合は null） */
  estimatedSizeBytes: number | null;
  /** 補足説明（コーデックなど） */
  note?: string;
}

export interface VideoInfoRequest {
  url: string;
}

export interface VideoInfoResponse {
  videoId: string;
  title: string;
  channel: string | null;
  thumbnailUrl: string;
  durationSeconds: number | null;
  formats: FormatOption[];
  /** 選択肢を提供できなかった理由など */
  notices: string[];
  /** この解析結果でダウンロードを開始できる期限（ISO 8601） */
  expiresAt: string;
}

export interface CreateDownloadRequest {
  videoId: string;
  formatId: string;
}

export type JobStatus =
  | "queued"
  | "downloading"
  | "processing"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled";

export interface JobFile {
  name: string;
  sizeBytes: number;
  url: string;
  /** 送信済み・保持期限切れで削除された場合は false */
  available: boolean;
}

export interface PublicError {
  code: string;
  message: string;
}

export interface JobResponse {
  id: string;
  status: JobStatus;
  /** 0〜100。算出できない場合は null（不定進捗表示） */
  progress: number | null;
  message: string;
  file?: JobFile;
  error?: PublicError;
}

export interface ErrorResponse {
  error: PublicError;
}

export interface HealthResponse {
  status: "ok";
}
