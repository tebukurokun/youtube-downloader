#!/usr/bin/env node
// テスト用の ffprobe の代替。拡張子から想定されるストリームを返す。
const file = process.argv.at(-1);
const streams = file.endsWith(".mp3")
  ? [{ codec_type: "audio" }]
  : [{ codec_type: "video" }, { codec_type: "audio" }];
process.stdout.write(JSON.stringify({ streams, format: { duration: "10.0" } }));
