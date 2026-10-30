import type {
  CreateDownloadRequest,
  ErrorResponse,
  JobResponse,
  PublicError,
  VideoInfoRequest,
  VideoInfoResponse,
} from "@app/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, error: PublicError) {
    super(error.message);
    this.status = status;
    this.code = error.code;
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, { code: "NETWORK_ERROR", message: "サーバーに接続できませんでした" });
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as ErrorResponse | null)?.error;
    throw new ApiError(
      response.status,
      error ?? { code: "HTTP_ERROR", message: `リクエストに失敗しました (HTTP ${response.status})` },
    );
  }
  return data as T;
}

export function fetchVideoInfo(url: string): Promise<VideoInfoResponse> {
  return request("POST", "/api/videos/info", { url } satisfies VideoInfoRequest);
}

export function createDownload(body: CreateDownloadRequest): Promise<JobResponse> {
  return request("POST", "/api/downloads", body);
}

export function getDownload(id: string, signal?: AbortSignal): Promise<JobResponse> {
  return request("GET", `/api/downloads/${encodeURIComponent(id)}`, undefined, signal);
}

export function cancelDownload(id: string): Promise<JobResponse> {
  return request("DELETE", `/api/downloads/${encodeURIComponent(id)}`);
}
