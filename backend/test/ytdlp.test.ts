import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { config } from "../src/config.ts";
import type { DownloadPlan } from "../src/services/formats.ts";
import {
  buildDownloadArgs,
  buildInfoArgs,
  classifyYtdlpError,
  type DownloadProgressEvent,
  ProgressTracker,
  parseProgressLine,
} from "../src/services/ytdlp.ts";

const plan: DownloadPlan = {
  option: {
    id: "video-1080-h264",
    kind: "video",
    label: "1080p",
    container: "mp4",
    requiresMerge: true,
    requiresConversion: false,
    estimatedSizeBytes: 400,
  },
  formatSelector: "137+140",
  parts: [
    { formatId: "137", sizeBytes: 300 },
    { formatId: "140", sizeBytes: 100 },
  ],
  extraArgs: ["--merge-output-format", "mp4"],
};

function progress(formatId: string, downloaded: number | null, total: number | null, status = "downloading") {
  return {
    type: "download",
    formatId,
    status,
    downloadedBytes: downloaded,
    totalBytes: total,
    fragmentIndex: null,
    fragmentCount: null,
  } satisfies DownloadProgressEvent;
}

describe("yt-dlp arguments", () => {
  it("uses a fixed URL, single-video mode and no config/cookies", () => {
    const args = buildInfoArgs(config, "dQw4w9WgXcQ");
    for (const flag of ["--ignore-config", "--no-playlist", "--no-cookies", "--dump-single-json"]) {
      assert.ok(args.includes(flag), flag);
    }
    assert.deepEqual(args.slice(-2), ["--", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"]);
  });

  it("builds download args only from server-side values", () => {
    const args = buildDownloadArgs(config, "dQw4w9WgXcQ", plan, "/work/jobs/x");
    assert.equal(args[args.indexOf("--format") + 1], "137+140");
    assert.equal(args[args.indexOf("--paths") + 1], "/work/jobs/x");
    assert.equal(args[args.indexOf("--output") + 1], "media.%(ext)s");
    assert.equal(args[args.indexOf("--match-filters") + 1], "id='dQw4w9WgXcQ' & !is_live");
    assert.equal(args.at(-1), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("refuses an invalid video ID", () => {
    assert.throws(() => buildDownloadArgs(config, "x' & id='y", plan, "/tmp/x"));
  });
});

describe("parseProgressLine", () => {
  it("parses download and postprocess lines", () => {
    assert.deepEqual(parseProgressLine("__YTDL_PROGRESS__ 137 downloading 50 NA 200 NA NA"), {
      type: "download",
      formatId: "137",
      status: "downloading",
      downloadedBytes: 50,
      totalBytes: 200,
      fragmentIndex: null,
      fragmentCount: null,
    });
    assert.deepEqual(parseProgressLine("__YTDL_POSTPROCESS__ Merger started"), {
      type: "postprocess",
      postprocessor: "Merger",
      status: "started",
    });
    assert.equal(parseProgressLine("[youtube] Extracting URL"), null);
  });
});

describe("ProgressTracker", () => {
  it("combines multiple parts by size and never goes backwards", () => {
    const tracker = new ProgressTracker(plan.parts);
    assert.equal(tracker.percent(), null);
    assert.equal(tracker.update(progress("137", 150, 300)), 37.5);
    assert.equal(tracker.update(progress("137", 100, 300)), 37.5);
    assert.equal(tracker.update(progress("140", 50, 100)), 87.5);
    assert.equal(tracker.update(progress("140", 100, 100, "finished")), 100);
  });

  it("stays indeterminate when no totals are known", () => {
    const tracker = new ProgressTracker([{ formatId: "251", sizeBytes: null }]);
    assert.equal(tracker.update(progress("251", 100, null)), null);
  });
});

describe("classifyYtdlpError", () => {
  it("maps known messages to public codes", () => {
    assert.equal(classifyYtdlpError("ERROR: [youtube] x: Private video").code, "VIDEO_PRIVATE");
    assert.equal(classifyYtdlpError("ERROR: [youtube] x: Video unavailable").code, "VIDEO_UNAVAILABLE");
    assert.equal(
      classifyYtdlpError("ERROR: [youtube] x: This video is unavailable").code,
      "VIDEO_UNAVAILABLE",
    );
    assert.equal(
      classifyYtdlpError("ERROR: The uploader has not made this video available in your country").code,
      "GEO_RESTRICTED",
    );
    assert.equal(classifyYtdlpError("ERROR: Requested format is not available").code, "FORMAT_UNAVAILABLE");
    assert.equal(classifyYtdlpError("something odd").code, "YTDLP_FAILED");
  });
});
