import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { JobResponse, VideoInfoResponse } from "@app/shared";
import { type App, buildApp } from "../src/app.ts";
import type { AppConfig } from "../src/config.ts";
import { testConfig, waitFor } from "./helpers.ts";

const ORIGIN = "http://localhost:3000";
const HEADERS = { host: "localhost:3000", origin: ORIGIN, "sec-fetch-site": "same-origin" };

let current: App | undefined;
afterEach(async () => {
  await current?.jobs.stop();
  await current?.app.close();
  current = undefined;
});

async function setup(overrides: Partial<AppConfig> = {}) {
  const config = await testConfig(overrides);
  current = buildApp(config);
  await current.jobs.start();
  return { ...current, config };
}

async function analyze(app: App["app"], videoId: string) {
  return app.inject({
    method: "POST",
    url: "/api/videos/info",
    headers: HEADERS,
    payload: { url: `https://youtu.be/${videoId}` },
  });
}

async function startDownload(app: App["app"], videoId: string, formatId: string) {
  return app.inject({
    method: "POST",
    url: "/api/downloads",
    headers: HEADERS,
    payload: { videoId, formatId },
  });
}

async function jobStatus(app: App["app"], id: string): Promise<JobResponse> {
  const res = await app.inject({ method: "GET", url: `/api/downloads/${id}`, headers: HEADERS });
  return res.json<JobResponse>();
}

describe("Host / Origin checks", () => {
  it("rejects unknown Host headers (DNS rebinding)", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "evil.example:3000" },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, "HOST_NOT_ALLOWED");
  });

  it("allows same-origin requests", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/health", headers: HEADERS });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { status: "ok" });
    assert.match(String(res.headers["content-security-policy"]), /default-src 'self'/);
  });

  it("rejects state-changing requests without an allowed Origin", async () => {
    const { app } = await setup();
    for (const origin of [undefined, "http://evil.example", "null", "http://localhost:3001"]) {
      const headers: Record<string, string> = { host: "localhost:3000" };
      if (origin) headers.origin = origin;
      const res = await app.inject({
        method: "POST",
        url: "/api/videos/info",
        headers,
        payload: { url: "https://youtu.be/aaaaaaaaaaa" },
      });
      assert.equal(res.statusCode, 403, String(origin));
      assert.equal(res.json().error.code, "ORIGIN_NOT_ALLOWED");
    }
  });

  it("rejects cross-site API requests", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "localhost:3000", "sec-fetch-site": "cross-site" },
    });
    assert.equal(res.statusCode, 403);
  });

  it("rejects non-JSON bodies", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/api/videos/info",
      headers: { ...HEADERS, "content-type": "text/plain" },
      payload: "url=https://youtu.be/aaaaaaaaaaa",
    });
    assert.equal(res.statusCode, 415);
  });
});

describe("POST /api/videos/info", () => {
  it("returns metadata and available formats", async () => {
    const { app } = await setup();
    const res = await analyze(app, "aaaaaaaaaaa");
    assert.equal(res.statusCode, 200);
    const body = res.json<VideoInfoResponse>();
    assert.equal(body.videoId, "aaaaaaaaaaa");
    assert.equal(body.title, 'Test / Video: "quoted" <tag>');
    assert.equal(body.thumbnailUrl, "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg");
    assert.deepEqual(
      body.formats.map((f) => f.id),
      ["video-2160-vp9", "video-1080-h264", "video-720-h264", "audio-mp3"],
    );
  });

  it("rejects invalid URLs before running yt-dlp", async () => {
    const { app } = await setup();
    for (const url of ["https://example.com/", "https://www.youtube.com/playlist?list=PLx", "--exec rm"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/videos/info",
        headers: HEADERS,
        payload: { url },
      });
      assert.equal(res.statusCode, 400, url);
      assert.equal(res.json().error.code, "INVALID_URL");
    }
    const extra = await app.inject({
      method: "POST",
      url: "/api/videos/info",
      headers: HEADERS,
      payload: { url: "https://youtu.be/aaaaaaaaaaa", args: ["--exec", "id"] },
    });
    assert.equal(extra.statusCode, 400);
  });

  it("maps yt-dlp errors to public messages without internal details", async () => {
    const { app } = await setup();
    const res = await analyze(app, "privateVid1");
    assert.equal(res.statusCode, 422);
    assert.deepEqual(res.json(), { error: { code: "VIDEO_PRIVATE", message: "この動画は非公開です" } });
  });

  it("rejects a different video returned by yt-dlp", async () => {
    const { app } = await setup();
    const res = await analyze(app, "mismatchId1");
    assert.equal(res.json().error.code, "VIDEO_MISMATCH");
  });

  it("rejects live streams", async () => {
    const { app } = await setup();
    const res = await analyze(app, "liveVideo01");
    assert.equal(res.json().error.code, "LIVE_NOT_SUPPORTED");
  });
});

async function waitForStatus(app: App["app"], id: string, statuses: string[]): Promise<JobResponse> {
  return waitFor(async () => {
    const job = await jobStatus(app, id);
    return statuses.includes(job.status) ? job : undefined;
  });
}

describe("downloads", () => {
  it("downloads, serves the file once and removes it", async () => {
    const { app, config } = await setup();
    await analyze(app, "aaaaaaaaaaa");
    const created = await startDownload(app, "aaaaaaaaaaa", "video-1080-h264");
    assert.equal(created.statusCode, 202);
    const { id } = created.json<JobResponse>();
    assert.match(id, /^[0-9a-f-]{36}$/);

    const job = await waitForStatus(app, id, ["completed", "failed"]);
    assert.equal(job.status, "completed", JSON.stringify(job));
    assert.equal(job.progress, 100);
    assert.deepEqual(job.file, {
      name: "Test _ Video_ _quoted_ _tag_.mp4",
      sizeBytes: 2048,
      url: `/api/downloads/${id}/file`,
      available: true,
    });

    const file = await app.inject({ method: "GET", url: `/api/downloads/${id}/file`, headers: HEADERS });
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers["content-type"], "video/mp4");
    assert.match(String(file.headers["content-disposition"]), /^attachment; /);
    assert.equal(file.rawPayload.length, 2048);

    await waitFor(async () => (await fs.readdir(config.jobsDir)).length === 0);
    const after = await jobStatus(app, id);
    assert.equal(after.file?.available, false);
    const again = await app.inject({ method: "GET", url: `/api/downloads/${id}/file`, headers: HEADERS });
    assert.equal(again.statusCode, 410);
  });

  it("converts to MP3", async () => {
    const { app } = await setup();
    await analyze(app, "aaaaaaaaaaa");
    const { id } = (await startDownload(app, "aaaaaaaaaaa", "audio-mp3")).json<JobResponse>();
    const job = await waitForStatus(app, id, ["completed", "failed"]);
    assert.equal(job.status, "completed", JSON.stringify(job));
    assert.equal(job.file?.name.endsWith(".mp3"), true);
  });

  it("requires a fresh analysis and a known format ID", async () => {
    const { app } = await setup();
    const expired = await startDownload(app, "aaaaaaaaaaa", "video-1080-h264");
    assert.equal(expired.statusCode, 410);

    await analyze(app, "aaaaaaaaaaa");
    const unknown = await startDownload(app, "aaaaaaaaaaa", "video-480-h264");
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.json().error.code, "FORMAT_UNAVAILABLE");

    const injected = await startDownload(app, "aaaaaaaaaaa", "bv*+ba --exec id");
    assert.equal(injected.statusCode, 400);
    assert.equal(injected.json().error.code, "INVALID_REQUEST");
  });

  it("rejects parallel jobs and cancels, killing child processes and removing files", async () => {
    const { app, config } = await setup();
    await analyze(app, "slowVideo01");
    await analyze(app, "aaaaaaaaaaa");
    const { id } = (await startDownload(app, "slowVideo01", "video-1080-h264")).json<JobResponse>();
    await waitForStatus(app, id, ["downloading"]);

    const parallel = await startDownload(app, "aaaaaaaaaaa", "audio-mp3");
    assert.equal(parallel.statusCode, 409);
    assert.equal(parallel.json().error.code, "JOB_IN_PROGRESS");

    // 偽の yt-dlp が起動した子プロセス（sleep）の PID
    const pidFile = path.join(config.jobsDir, id, "child.pid");
    const sleepPid = Number(await waitFor(() => fs.readFile(pidFile, "utf8").catch(() => undefined)));
    const cancel = await app.inject({ method: "DELETE", url: `/api/downloads/${id}`, headers: HEADERS });
    assert.equal(cancel.statusCode, 202);
    assert.equal(cancel.json<JobResponse>().status, "cancelling");

    const job = await waitForStatus(app, id, ["cancelled"]);
    assert.equal(job.status, "cancelled");
    assert.deepEqual(await fs.readdir(config.jobsDir), []);
    assert.throws(() => process.kill(sleepPid, 0), "child process should be gone");

    const again = await app.inject({ method: "DELETE", url: `/api/downloads/${id}`, headers: HEADERS });
    assert.equal(again.statusCode, 409);
  });

  it("returns 404 for unknown jobs and 400 for malformed IDs", async () => {
    const { app } = await setup();
    const unknown = await app.inject({
      method: "GET",
      url: "/api/downloads/00000000-0000-4000-8000-000000000000/file",
      headers: HEADERS,
    });
    assert.equal(unknown.statusCode, 404);
    const traversal = await app.inject({
      method: "GET",
      url: "/api/downloads/..%2F..%2Fetc%2Fpasswd/file",
      headers: HEADERS,
    });
    assert.equal(traversal.statusCode, 400);
  });

  it("removes leftover job directories on start and expired files on sweep", async () => {
    const config = await testConfig({ fileRetentionMs: 1 });
    await fs.mkdir(path.join(config.jobsDir, "leftover"), { recursive: true });
    current = buildApp(config);
    await current.jobs.start();
    assert.deepEqual(await fs.readdir(config.jobsDir), []);

    const { app, jobs } = current;
    await analyze(app, "aaaaaaaaaaa");
    const { id } = (await startDownload(app, "aaaaaaaaaaa", "audio-mp3")).json<JobResponse>();
    await waitForStatus(app, id, ["completed"]);
    assert.deepEqual(await fs.readdir(config.jobsDir), [id]);
    await jobs.sweep(Date.now() + 10);
    assert.deepEqual(await fs.readdir(config.jobsDir), []);
    assert.equal((await jobStatus(app, id)).file?.available, false);
  });
});
