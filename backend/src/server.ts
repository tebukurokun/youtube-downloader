import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { ensureWorkDirs } from "./services/files.ts";

await ensureWorkDirs(config);

const { app, jobs } = buildApp(config, {
  logger: { level: process.env.LOG_LEVEL ?? "info" },
});

await jobs.start();

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  try {
    await jobs.stop();
    await app.close();
  } finally {
    process.exit(0);
  }
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
