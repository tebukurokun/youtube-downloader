import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDownloadPlans, type YtdlpInfo } from "../src/services/formats.ts";

const info: YtdlpInfo = {
  id: "dQw4w9WgXcQ",
  duration: 100,
  formats: [
    { format_id: "sb0", ext: "mhtml", vcodec: "none", acodec: "none", protocol: "mhtml" },
    {
      format_id: "140",
      ext: "m4a",
      vcodec: "none",
      acodec: "mp4a.40.2",
      abr: 129,
      filesize: 1000,
      protocol: "https",
    },
    {
      format_id: "139",
      ext: "m4a",
      vcodec: "none",
      acodec: "mp4a.40.5",
      abr: 48,
      filesize: 400,
      protocol: "https",
    },
    {
      format_id: "251",
      ext: "webm",
      vcodec: "none",
      acodec: "opus",
      abr: 140,
      filesize: 1100,
      protocol: "https",
    },
    {
      format_id: "137",
      ext: "mp4",
      vcodec: "avc1.640028",
      acodec: "none",
      height: 1080,
      fps: 30,
      filesize: 9000,
    },
    {
      format_id: "299",
      ext: "mp4",
      vcodec: "avc1.64002a",
      acodec: "none",
      height: 1080,
      fps: 60,
      filesize: 12000,
    },
    { format_id: "248", ext: "webm", vcodec: "vp9", acodec: "none", height: 1080, fps: 30, filesize: 8000 },
    { format_id: "313", ext: "webm", vcodec: "vp9", acodec: "none", height: 2160, fps: 30, filesize: 50000 },
    {
      format_id: "337",
      ext: "webm",
      vcodec: "vp09.02.51.10",
      acodec: "none",
      height: 2160,
      dynamic_range: "HDR10",
    },
    { format_id: "400", ext: "mp4", vcodec: "av01.0.12M.08", acodec: "none", height: 1440, filesize: 30000 },
    { format_id: "drm1", ext: "mp4", vcodec: "avc1", acodec: "none", height: 720, has_drm: true },
    { format_id: "bad id;rm", ext: "mp4", vcodec: "avc1", acodec: "none", height: 480 },
    { format_id: "18", ext: "mp4", vcodec: "avc1.42001E", acodec: "mp4a.40.2", height: 360 },
  ],
};

describe("buildDownloadPlans", () => {
  it("offers one option per height, preferring H.264 MP4", () => {
    const { plans } = buildDownloadPlans(info, Number.MAX_SAFE_INTEGER);
    const summary = plans.map((p) => [p.option.id, p.option.label, p.option.container, p.formatSelector]);
    assert.deepEqual(summary, [
      ["video-2160-vp9", "2160p", "webm", "313+251"],
      ["video-1440-av1", "1440p", "mp4", "400+140"],
      ["video-1080-h264", "1080p60", "mp4", "299+140"],
      ["audio-mp3", "MP3", "mp3", "251"],
    ]);
    const h264 = plans.find((p) => p.option.id === "video-1080-h264");
    assert.equal(h264?.option.estimatedSizeBytes, 13000);
    assert.equal(h264?.option.requiresConversion, false);
    assert.equal(h264?.option.requiresMerge, true);
    assert.deepEqual(h264?.extraArgs, ["--merge-output-format", "mp4"]);
  });

  it("never uses DRM, storyboard or unsafe format IDs", () => {
    const { plans } = buildDownloadPlans(info, Number.MAX_SAFE_INTEGER);
    const selectors = plans.map((p) => p.formatSelector).join(",");
    assert.doesNotMatch(selectors, /drm1|sb0|bad id|337/);
  });

  it("prefers direct (DASH), non-DRC, stereo AAC streams", () => {
    const { plans } = buildDownloadPlans(
      {
        formats: [
          {
            format_id: "312",
            ext: "mp4",
            vcodec: "avc1.64002A",
            acodec: "none",
            height: 1080,
            fps: 60,
            tbr: 7418,
            protocol: "m3u8_native",
          },
          {
            format_id: "299",
            ext: "mp4",
            vcodec: "avc1.64002A",
            acodec: "none",
            height: 1080,
            fps: 60,
            tbr: 3248,
            protocol: "https",
            filesize: 100,
          },
          {
            format_id: "140-drc",
            ext: "m4a",
            vcodec: "none",
            acodec: "mp4a.40.2",
            abr: 130,
            protocol: "https",
            format_note: "medium, DRC",
            filesize: 10,
          },
          {
            format_id: "140",
            ext: "m4a",
            vcodec: "none",
            acodec: "mp4a.40.2",
            abr: 129,
            protocol: "https",
            audio_channels: 2,
            filesize: 10,
          },
          {
            format_id: "258",
            ext: "m4a",
            vcodec: "none",
            acodec: "mp4a.40.2",
            abr: 388,
            protocol: "https",
            audio_channels: 6,
          },
          {
            format_id: "380",
            ext: "m4a",
            vcodec: "none",
            acodec: "ac-3",
            abr: 384,
            protocol: "https",
            audio_channels: 6,
          },
        ],
      },
      Number.MAX_SAFE_INTEGER,
    );
    assert.deepEqual(
      plans.map((p) => [p.option.id, p.formatSelector]),
      [
        ["video-1080-h264", "299+140"],
        ["audio-mp3", "140"],
      ],
    );
  });

  it("excludes options above the size limit with a notice", () => {
    const { plans, notices } = buildDownloadPlans(info, 20000);
    assert.ok(!plans.some((p) => p.option.id === "video-2160-vp9"));
    assert.ok(notices.some((n) => n.includes("2160p")));
  });

  it("falls back to a muxed MP4 when no separate video streams exist", () => {
    const { plans } = buildDownloadPlans(
      { formats: [{ format_id: "18", ext: "mp4", vcodec: "avc1.42001E", acodec: "mp4a.40.2", height: 360 }] },
      Number.MAX_SAFE_INTEGER,
    );
    assert.deepEqual(
      plans.map((p) => [p.option.id, p.formatSelector, p.option.requiresMerge]),
      [
        ["video-360-muxed", "18", false],
        ["audio-mp3", "18", false],
      ],
    );
  });

  it("reports when nothing is available", () => {
    const { plans, notices } = buildDownloadPlans({ formats: [] }, Number.MAX_SAFE_INTEGER);
    assert.equal(plans.length, 0);
    assert.equal(notices.length, 2);
  });
});
