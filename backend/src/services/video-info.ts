import type { VideoInfoResponse } from "@app/shared";
import type { AppConfig } from "../config.ts";
import { buildDownloadPlans, type DownloadPlan } from "./formats.ts";
import { thumbnailUrl } from "./youtube-url.ts";
import { fetchVideoInfo, YtdlpError } from "./ytdlp.ts";

interface CacheEntry {
  response: VideoInfoResponse;
  plans: Map<string, DownloadPlan>;
  expiresAt: number;
}

const MAX_CACHE_ENTRIES = 50;

/**
 * 動画情報の取得結果と、そこから生成した選択肢をキャッシュする。
 * ダウンロードは有効期限内の選択肢IDからのみ開始できる。
 */
export class VideoInfoService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<CacheEntry>>();
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async getInfo(videoId: string): Promise<VideoInfoResponse> {
    const cached = this.fresh(videoId);
    if (cached) return cached.response;

    const pending = this.inflight.get(videoId);
    if (pending) return (await pending).response;

    if (this.inflight.size >= this.config.maxConcurrentInfo) {
      throw new YtdlpError({
        code: "TOO_MANY_REQUESTS",
        message: "他の動画を解析中です。しばらくしてから再試行してください",
      });
    }
    const task = this.load(videoId).finally(() => this.inflight.delete(videoId));
    this.inflight.set(videoId, task);
    return (await task).response;
  }

  /** 有効期限内の解析結果から、選択肢IDに対応するダウンロード手順を取り出す */
  lookupPlan(
    videoId: string,
    formatId: string,
  ): { plan: DownloadPlan; title: string } | "expired" | "unknown-format" {
    const entry = this.fresh(videoId);
    if (!entry) return "expired";
    const plan = entry.plans.get(formatId);
    if (!plan) return "unknown-format";
    return { plan, title: entry.response.title };
  }

  private fresh(videoId: string): CacheEntry | undefined {
    const entry = this.cache.get(videoId);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(videoId);
      return undefined;
    }
    return entry;
  }

  private async load(videoId: string): Promise<CacheEntry> {
    const info = await fetchVideoInfo(this.config, videoId);
    const { plans, notices } = buildDownloadPlans(info, this.config.maxFileSizeBytes);
    const expiresAt = Date.now() + this.config.infoTtlMs;
    const title = typeof info.title === "string" && info.title.trim() !== "" ? info.title : videoId;
    const channel = info.channel ?? info.uploader ?? null;

    const entry: CacheEntry = {
      response: {
        videoId,
        title,
        channel: typeof channel === "string" ? channel : null,
        thumbnailUrl: thumbnailUrl(videoId),
        durationSeconds: typeof info.duration === "number" ? Math.round(info.duration) : null,
        formats: plans.map((plan) => plan.option),
        notices,
        expiresAt: new Date(expiresAt).toISOString(),
      },
      plans: new Map(plans.map((plan) => [plan.option.id, plan])),
      expiresAt,
    };

    this.cache.delete(videoId);
    this.cache.set(videoId, entry);
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return entry;
  }
}
