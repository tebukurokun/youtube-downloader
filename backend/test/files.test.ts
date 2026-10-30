import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentDisposition, resolveInside, safeFileName } from "../src/services/files.ts";

describe("safeFileName", () => {
  it("removes path separators and forbidden characters", () => {
    assert.equal(safeFileName('../../etc/passwd: "x" <y>|?*', "mp4"), "_.._etc_passwd_ _x_ _y____.mp4");
    assert.equal(safeFileName("a\u0000b‮c\nd", "mp3"), "abcd.mp3");
    assert.equal(safeFileName("...", "mp4"), "video.mp4");
    assert.equal(safeFileName("  ", "mp4"), "video.mp4");
    assert.equal(safeFileName("CON", "mp4"), "_CON.mp4");
    assert.equal(safeFileName("日本語のタイトル 🎵", "mp3"), "日本語のタイトル 🎵.mp3");
  });

  it("limits the length without breaking surrogate pairs", () => {
    const name = safeFileName("🎵".repeat(200), "mp3");
    assert.equal([...name].length, 124);
    assert.ok(!name.includes("�"));
  });
});

describe("contentDisposition", () => {
  it("provides an ASCII fallback and a UTF-8 filename", () => {
    assert.equal(
      contentDisposition("動画 (1).mp4"),
      "attachment; filename=\"__ (1).mp4\"; filename*=UTF-8''%E5%8B%95%E7%94%BB%20%281%29.mp4",
    );
    const header = contentDisposition('a";\r\nb.mp4');
    assert.doesNotMatch(header, /[\r\n]/);
    assert.match(header, /^attachment; filename="a____b\.mp4"; filename\*=UTF-8''a%22%3B%0D%0Ab\.mp4$/);
  });
});

describe("resolveInside", () => {
  it("rejects paths outside the base directory", () => {
    assert.equal(resolveInside("/work/jobs", "abc"), "/work/jobs/abc");
    assert.throws(() => resolveInside("/work/jobs", "../secret"));
    assert.throws(() => resolveInside("/work/jobs", "/etc/passwd"));
  });
});
