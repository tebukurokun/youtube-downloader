const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const SHORT_HOSTS = new Set(["youtu.be"]);
/** /<prefix>/<videoId> 形式で単一動画を指すパス */
const ID_PATH_PREFIXES = new Set(["shorts", "embed", "live", "v"]);

export class InvalidUrlError extends Error {}

export function isValidVideoId(value: string): boolean {
  return VIDEO_ID_PATTERN.test(value);
}

/** 動画IDから yt-dlp に渡す固定形式のURLを組み立てる */
export function canonicalVideoUrl(videoId: string): string {
  if (!isValidVideoId(videoId)) throw new InvalidUrlError("動画IDの形式が正しくありません");
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * 単一動画の YouTube URL から動画IDを厳格に抽出する。
 * 許可するのは YouTube の明示的なドメイン・パスのみで、
 * プレイリスト・チャンネルなどのURLは拒否する。
 * watch URL に付いた list= などの追加パラメータは無視し、動画単体として扱う。
 */
export function extractVideoId(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) {
    throw new InvalidUrlError("URLを入力してください");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidUrlError("URLの形式が正しくありません");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InvalidUrlError("http または https のURLを入力してください");
  }
  if (url.username !== "" || url.password !== "" || url.port !== "") {
    throw new InvalidUrlError("サポートしていないURLです");
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter((segment) => segment !== "");

  let candidate: string | undefined;
  if (SHORT_HOSTS.has(host)) {
    if (segments.length === 1) candidate = segments[0];
  } else if (WATCH_HOSTS.has(host)) {
    const [first, second] = segments;
    if (segments.length === 1 && first === "watch") {
      const values = url.searchParams.getAll("v");
      if (values.length === 1) candidate = values[0];
    } else if (segments.length === 2 && first !== undefined && ID_PATH_PREFIXES.has(first)) {
      candidate = second;
    } else if (first === "playlist" || url.searchParams.has("list")) {
      throw new InvalidUrlError("プレイリストには対応していません。単一動画のURLを入力してください");
    }
  } else {
    throw new InvalidUrlError("YouTube の動画URLのみ対応しています");
  }

  if (candidate === undefined || !isValidVideoId(candidate)) {
    throw new InvalidUrlError("単一動画のURLを入力してください（チャンネル・プレイリスト等は非対応）");
  }
  return candidate;
}
