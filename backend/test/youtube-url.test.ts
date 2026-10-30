import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalVideoUrl, extractVideoId, InvalidUrlError } from "../src/services/youtube-url.ts";

describe("extractVideoId", () => {
  const id = "dQw4w9WgXcQ";

  it("accepts single-video URLs", () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=10s`,
      `https://m.youtube.com/watch?v=${id}`,
      `http://www.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
      `  https://www.youtube.com/watch?v=${id}  `,
      // プレイリスト内の動画URLは動画単体として扱う
      `https://www.youtube.com/watch?v=${id}&list=PL1234567890`,
    ]) {
      assert.equal(extractVideoId(url), id, url);
    }
  });

  it("rejects non-YouTube, playlist, channel and malformed URLs", () => {
    for (const url of [
      "",
      "not a url",
      `ftp://www.youtube.com/watch?v=${id}`,
      `javascript:alert(1)//www.youtube.com/watch?v=${id}`,
      `https://example.com/watch?v=${id}`,
      `https://www.youtube.com.evil.example/watch?v=${id}`,
      `https://evil.example/?u=https://www.youtube.com/watch?v=${id}`,
      `https://user:pass@www.youtube.com/watch?v=${id}`,
      `https://www.youtube.com:8443/watch?v=${id}`,
      "https://www.youtube.com/playlist?list=PL1234567890",
      "https://www.youtube.com/@SomeChannel",
      "https://www.youtube.com/channel/UC1234567890",
      "https://www.youtube.com/watch?list=PL1234567890",
      "https://www.youtube.com/watch?v=short",
      `https://www.youtube.com/watch?v=${id}x`,
      `https://www.youtube.com/watch?v=${id}&v=${id}`,
      "https://www.youtube.com/watch?v=abc%20defghi",
      `https://youtu.be/${id}/extra`,
      `https://www.youtube.com/shorts/${id}/extra`,
      `https://music.youtube.com/watch?v=${id}`,
      `https://www.youtube.com/watch?v=${id}`.repeat(60),
    ]) {
      assert.throws(() => extractVideoId(url), InvalidUrlError, url);
    }
  });
});

describe("canonicalVideoUrl", () => {
  it("builds a fixed URL and refuses invalid IDs", () => {
    assert.equal(canonicalVideoUrl("dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.throws(() => canonicalVideoUrl("--exec=rm -rf"), InvalidUrlError);
  });
});
