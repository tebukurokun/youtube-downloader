import type { HealthResponse } from "@app/shared";
import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async (): Promise<HealthResponse> => ({ status: "ok" }));
}
