import type { VideoInfoRequest, VideoInfoResponse } from "@app/shared";
import type { FastifyInstance } from "fastify";
import type { VideoInfoService } from "../services/video-info.ts";
import { extractVideoId, InvalidUrlError } from "../services/youtube-url.ts";
import { YtdlpError } from "../services/ytdlp.ts";
import { sendError } from "./errors.ts";

/** 公開エラーコードに対応する HTTP ステータス */
const STATUS_BY_CODE: Record<string, number> = {
  TOO_MANY_REQUESTS: 429,
  RATE_LIMITED: 503,
  TIMEOUT: 504,
  NETWORK_ERROR: 502,
  YTDLP_NOT_AVAILABLE: 500,
  YTDLP_FAILED: 502,
};

export function videoRoutes(videoInfo: VideoInfoService) {
  return async (app: FastifyInstance): Promise<void> => {
    app.post<{ Body: VideoInfoRequest; Reply: VideoInfoResponse }>(
      "/api/videos/info",
      {
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["url"],
            properties: { url: { type: "string", minLength: 1, maxLength: 2048 } },
          },
        },
      },
      async (request, reply) => {
        let videoId: string;
        try {
          videoId = extractVideoId(request.body.url);
        } catch (error) {
          if (error instanceof InvalidUrlError) {
            return sendError(reply, 400, { code: "INVALID_URL", message: error.message });
          }
          throw error;
        }

        try {
          return await videoInfo.getInfo(videoId);
        } catch (error) {
          if (error instanceof YtdlpError) {
            request.log.warn({ videoId, code: error.publicError.code, detail: error.message }, "info failed");
            return sendError(reply, STATUS_BY_CODE[error.publicError.code] ?? 422, error.publicError);
          }
          throw error;
        }
      },
    );
  };
}
