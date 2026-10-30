import type { ErrorResponse } from "@app/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppConfig } from "./config.ts";

const SAFE_METHODS = new Set(["GET", "HEAD"]);
/** API への GET を許可する Sec-Fetch-Site の値（同一オリジン、またはアドレスバーからの直接アクセス） */
const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https://i.ytimg.com",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function reject(reply: FastifyReply, code: string, message: string): FastifyReply {
  const body: ErrorResponse = { error: { code, message } };
  return reply.code(403).send(body);
}

/**
 * ローカル専用サービスとしての防御。
 * - Host ヘッダーを許可値に限定する（DNS rebinding 対策）
 * - 状態変更リクエストは Origin を検証する（CSRF 対策。CORS は有効にしない）
 * - API はクロスサイトからの読み込み・遷移を拒否する
 */
export function registerSecurity(app: FastifyInstance, config: AppConfig): void {
  const allowedHosts = new Set(config.allowedHosts);
  const allowedOrigins = new Set([
    ...config.allowedHosts.map((host) => `http://${host}`),
    ...config.extraAllowedOrigins,
  ]);

  app.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host?.toLowerCase();
    if (host === undefined || !allowedHosts.has(host)) {
      return reject(reply, "HOST_NOT_ALLOWED", "許可されていないホスト名でのアクセスです");
    }

    const fetchSite = request.headers["sec-fetch-site"];
    const isApi = request.url.startsWith("/api/");
    if (isApi && typeof fetchSite === "string" && !ALLOWED_FETCH_SITES.has(fetchSite)) {
      return reject(reply, "CROSS_SITE_REQUEST", "外部サイトからのリクエストは受け付けません");
    }

    if (!SAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin?.toLowerCase();
      if (origin === undefined || !allowedOrigins.has(origin)) {
        return reject(reply, "ORIGIN_NOT_ALLOWED", "許可されていないオリジンからのリクエストです");
      }
    }
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    return payload;
  });
}
