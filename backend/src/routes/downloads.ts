import { createReadStream } from "node:fs";
import type { CreateDownloadRequest, JobResponse } from "@app/shared";
import type { FastifyInstance } from "fastify";
import type { JobManager } from "../jobs/manager.ts";
import { contentDisposition, contentTypeFor } from "../services/files.ts";
import type { VideoInfoService } from "../services/video-info.ts";
import { sendError } from "./errors.ts";

const idParamsSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: {
      type: "string",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    },
  },
} as const;

export function downloadRoutes(videoInfo: VideoInfoService, jobs: JobManager) {
  return async (app: FastifyInstance): Promise<void> => {
    app.post<{ Body: CreateDownloadRequest; Reply: JobResponse }>(
      "/api/downloads",
      {
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["videoId", "formatId"],
            properties: {
              videoId: { type: "string", pattern: "^[A-Za-z0-9_-]{11}$" },
              formatId: { type: "string", pattern: "^(video-[0-9]{1,5}-(h264|vp9|av1|muxed)|audio-mp3)$" },
            },
          },
        },
      },
      async (request, reply) => {
        const { videoId, formatId } = request.body;
        const found = videoInfo.lookupPlan(videoId, formatId);
        if (found === "expired") {
          return sendError(reply, 410, {
            code: "INFO_EXPIRED",
            message: "解析結果の有効期限が切れました。もう一度解析してください",
          });
        }
        if (found === "unknown-format") {
          return sendError(reply, 400, {
            code: "FORMAT_UNAVAILABLE",
            message: "選択した形式は利用できません",
          });
        }
        const job = await jobs.create(videoId, found.title, found.plan);
        request.log.info({ jobId: job.id, videoId, formatId }, "job created");
        return reply.code(202).send(jobs.toResponse(job));
      },
    );

    app.get<{ Params: { id: string }; Reply: JobResponse }>(
      "/api/downloads/:id",
      { schema: { params: idParamsSchema } },
      async (request, reply) => {
        const job = jobs.get(request.params.id);
        if (!job) return sendError(reply, 404, { code: "JOB_NOT_FOUND", message: "ジョブが見つかりません" });
        reply.header("Cache-Control", "no-store");
        return jobs.toResponse(job);
      },
    );

    app.delete<{ Params: { id: string }; Reply: JobResponse }>(
      "/api/downloads/:id",
      { schema: { params: idParamsSchema } },
      async (request, reply) => {
        const job = jobs.cancel(request.params.id);
        return reply.code(202).send(jobs.toResponse(job));
      },
    );

    app.get<{ Params: { id: string } }>(
      "/api/downloads/:id/file",
      { schema: { params: idParamsSchema } },
      async (request, reply) => {
        const job = jobs.get(request.params.id);
        if (!job) return sendError(reply, 404, { code: "JOB_NOT_FOUND", message: "ジョブが見つかりません" });
        if (job.status !== "completed" || !job.output) {
          return sendError(reply, 409, { code: "NOT_READY", message: "ファイルはまだ準備できていません" });
        }
        if (job.fileRemoved) {
          return sendError(reply, 410, {
            code: "FILE_GONE",
            message: "ファイルは送信済み、または保持期限切れのため削除されました",
          });
        }

        // ジョブに紐づくサーバー管理下の完成ファイルだけを返す
        const output = job.output;
        const stream = createReadStream(output.path);
        reply.raw.once("finish", () => {
          jobs.markSent(job).catch((error: unknown) => request.log.error({ err: error }, "cleanup failed"));
        });
        return reply
          .header("Content-Type", contentTypeFor(output.ext))
          .header("Content-Length", String(output.sizeBytes))
          .header("Content-Disposition", contentDisposition(output.name))
          .header("Cache-Control", "no-store")
          .send(stream);
      },
    );
  };
}
