#!/usr/bin/env node
// テスト用の yt-dlp の代替。引数に応じて決まった出力を返す。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const url = args.at(-1);
const id = new URL(url).searchParams.get("v");
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

if (id === "privateVid1") {
  process.stderr.write(
    "ERROR: [youtube] privateVid1: Private video. Sign in if you've been granted access\n",
  );
  process.exit(1);
}

if (args.includes("--dump-single-json")) {
  const info = {
    _type: "video",
    id: id === "mismatchId1" ? "otherVideo1" : id,
    title: 'Test / Video: "quoted" <tag>',
    channel: "Test Channel",
    duration: 10,
    live_status: id === "liveVideo01" ? "is_live" : "not_live",
    formats: [
      { format_id: "sb0", ext: "mhtml", vcodec: "none", acodec: "none", protocol: "mhtml" },
      { format_id: "140", ext: "m4a", vcodec: "none", acodec: "mp4a.40.2", abr: 129, filesize: 1000 },
      { format_id: "251", ext: "webm", vcodec: "none", acodec: "opus", abr: 140, filesize: 1100 },
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
        format_id: "136",
        ext: "mp4",
        vcodec: "avc1.4d401f",
        acodec: "none",
        height: 720,
        fps: 30,
        filesize: 5000,
      },
      {
        format_id: "313",
        ext: "webm",
        vcodec: "vp9",
        acodec: "none",
        height: 2160,
        fps: 30,
        filesize: 50000,
      },
      { format_id: "18", ext: "mp4", vcodec: "avc1.42001E", acodec: "mp4a.40.2", height: 360, fps: 30 },
    ],
  };
  process.stdout.write(JSON.stringify(info));
  process.exit(0);
}

// ダウンロード
const dir = opt("--paths");
const ext = args.includes("--extract-audio") ? "mp3" : (opt("--merge-output-format") ?? "mp4");
const parts = opt("--format").split("+");

if (id === "slowVideo01") {
  // キャンセル試験用: 子プロセスを起動して待ち続ける
  const child = spawn("sleep", ["300"], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "child.pid"), String(child.pid));
  fs.writeFileSync(path.join(dir, "media.f137.mp4.part"), "partial");
  process.stdout.write(`__YTDL_PROGRESS__ ${parts[0]} downloading 10 100 NA NA NA\n`);
  setInterval(() => {}, 1000);
} else {
  for (const formatId of parts) {
    for (const done of [50, 100]) {
      process.stdout.write(`__YTDL_PROGRESS__ ${formatId} downloading ${done} 100 NA NA NA\n`);
    }
    process.stdout.write(`__YTDL_PROGRESS__ ${formatId} finished 100 100 NA NA NA\n`);
  }
  process.stdout.write(`__YTDL_POSTPROCESS__ ${ext === "mp3" ? "ExtractAudio" : "Merger"} started\n`);
  fs.writeFileSync(path.join(dir, `media.${ext}`), Buffer.alloc(2048, 1));
  process.stdout.write(`__YTDL_POSTPROCESS__ MoveFiles finished\n`);
  process.exit(0);
}
