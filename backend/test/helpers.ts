import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type AppConfig, config as baseConfig } from "../src/config.ts";

const fixtures = path.join(import.meta.dirname, "fixtures");

export async function testConfig(overrides: Partial<AppConfig> = {}): Promise<AppConfig> {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vd-test-"));
  const config: AppConfig = {
    ...baseConfig,
    workRoot,
    jobsDir: path.join(workRoot, "jobs"),
    cacheDir: path.join(workRoot, "cache"),
    staticDir: path.join(workRoot, "static-not-present"),
    ytdlpPath: path.join(fixtures, "fake-yt-dlp.mjs"),
    ffprobePath: path.join(fixtures, "fake-ffprobe.mjs"),
    killGraceMs: 500,
    minFreeDiskBytes: 1,
    ...overrides,
  };
  await fs.mkdir(config.jobsDir, { recursive: true });
  await fs.mkdir(config.cacheDir, { recursive: true });
  return config;
}

export async function waitFor<T>(
  fn: () => T | undefined | false | Promise<T | undefined | false>,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== undefined && value !== false) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("waitFor: timed out");
}
