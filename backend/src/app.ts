import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { AppConfig } from "./config.ts";
import { JobManager } from "./jobs/manager.ts";
import { JobError } from "./jobs/types.ts";
import { downloadRoutes } from "./routes/downloads.ts";
import { sendError } from "./routes/errors.ts";
import { healthRoutes } from "./routes/health.ts";
import { videoRoutes } from "./routes/videos.ts";
import { registerSecurity } from "./security.ts";
import { VideoInfoService } from "./services/video-info.ts";

export interface App {
  app: FastifyInstance;
  jobs: JobManager;
  videoInfo: VideoInfoService;
}

export function buildApp(config: AppConfig, options: FastifyServerOptions = {}): App {
  const app = Fastify({
    bodyLimit: 16 * 1024,
    trustProxy: false,
    // 未知のプロパティは削除せずに拒否する
    ajv: { customOptions: { removeAdditional: false } },
    ...options,
  });
  const jobs = new JobManager(config, app.log);
  const videoInfo = new VideoInfoService(config);

  registerSecurity(app, config);
  // JSON 以外のリクエストボディは受け付けない
  app.removeContentTypeParser("text/plain");

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof JobError) return sendError(reply, error.statusCode, error.publicError);
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if ((error as { validation?: unknown }).validation) {
      return sendError(reply, 400, {
        code: "INVALID_REQUEST",
        message: "リクエストの形式が正しくありません",
      });
    }
    if (statusCode >= 400 && statusCode < 500) {
      return sendError(reply, statusCode, { code: "BAD_REQUEST", message: "リクエストを処理できません" });
    }
    // 内部エラーの詳細はログのみに残し、クライアントには返さない
    request.log.error({ err: error }, "unhandled error");
    return sendError(reply, 500, { code: "INTERNAL_ERROR", message: "サーバー内部でエラーが発生しました" });
  });

  app.register(healthRoutes);
  app.register(videoRoutes(videoInfo));
  app.register(downloadRoutes(videoInfo, jobs));

  if (existsSync(config.staticDir)) {
    app.register(fastifyStatic, { root: config.staticDir, wildcard: false, index: ["index.html"] });
  }

  app.setNotFoundHandler((_request, reply) =>
    sendError(reply, 404, { code: "NOT_FOUND", message: "見つかりません" }),
  );

  return { app, jobs, videoInfo };
}
