# Video Downloader

自分専用のローカル Web アプリです。ダウンロードする権利・許可がある YouTube 上の単一動画を、
広告や外部サイトを使わずに保存します。動画の取得には [yt-dlp](https://github.com/yt-dlp/yt-dlp)
を使っています。Docker Compose だけで動き、ホストに Node.js / Python / yt-dlp / FFmpeg を
インストールする必要はありません。

> **利用条件:** 著作権者の許可がある動画、自分でアップロードした動画など、ダウンロードする権利と
> 利用条件を確認できる動画にのみ使ってください。YouTube の利用規約は、許可がある場合を除き
> ダウンロードを制限しています。個人利用・ローカル実行であっても規約上の制限はなくなりません。
> DRM やアクセス制御の回避、Cookie・認証情報の取り込みには対応していません。

## 前提条件

- Docker Engine と Docker Compose v2（`docker compose` コマンド）が使えること
  - macOS / Windows: [Docker Desktop](https://docs.docker.com/desktop/)
  - Linux: [Docker Engine](https://docs.docker.com/engine/install/) と [Compose プラグイン](https://docs.docker.com/compose/install/linux/)
- Docker が起動していること（`docker info` で確認できます）
- イメージのビルドと YouTube へのアクセスのため、インターネットに接続できること
- ディスクの空き容量: イメージ約 900 MB ＋ ダウンロードする動画の 2 倍程度 ＋ 1 GB

## 使い方

```bash
# 初回・更新後にビルドして起動
docker compose up -d --build

# ブラウザで開く
open http://localhost:3000

# ログ確認
docker compose logs -f downloader

# 停止・コンテナ削除
docker compose down
```

1. 動画URLを入力して「解析」を押します（`youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/live/` に対応）。
2. 保存形式（動画 / 音声 MP3）と画質を選び、「ダウンロード開始」を押します。
3. 完了したら「ファイルを保存」でブラウザからホスト PC に保存します。

`docker compose down` ではイメージとビルドキャッシュは残ります。不要になったら
`docker image rm video-downloader:local` や `docker builder prune` で削除してください。

## 構成

```text
frontend/   React + TypeScript + Vite（1画面 UI、素の CSS）
backend/    Node.js 24 + TypeScript + Fastify（API・ジョブ管理・静的配信）
shared/     API の型定義（フロント・バックエンドで共有）
docker/     yt-dlp の固定バージョン、ヘルスチェック
Dockerfile  マルチステージ（フロントのビルド → 実行用イメージ）
compose.yaml
```

実行時は単一コンテナです。Fastify が API とビルド済み UI を配信し、yt-dlp（+ yt-dlp-ejs + Deno）
と FFmpeg / ffprobe をシェルを経由せずに呼び出します。ジョブ状態はメモリ上にあり、
コンテナ再起動で消えます。DB はありません。

| Method | Path | 内容 |
| --- | --- | --- |
| `POST` | `/api/videos/info` | URL を検証し、メタデータと保存可能な形式を返す |
| `POST` | `/api/downloads` | ジョブを作成・開始（実行中なら `409`） |
| `GET` | `/api/downloads/:id` | 状態・進捗・エラー（UI は1秒間隔でポーリング） |
| `GET` | `/api/downloads/:id/file` | 完成ファイルを配信（送信完了後に削除） |
| `DELETE` | `/api/downloads/:id` | キャンセル |
| `GET` | `/api/health` | ヘルスチェック |

## 実装時の決定事項

plan.md の保留事項・判断事項は、次のシンプルなデフォルトで決定しました。

| 項目 | 決定 |
| --- | --- |
| パッケージ管理 | npm workspaces（`shared` / `backend` / `frontend`） |
| Linter / Formatter | Biome（`npm run lint`、`npm run lint:fix`）。Markdown は日本語の表が崩れるため対象外 |
| バックエンドの実行 | Node.js 24 の型ストリッピングで `.ts` を直接実行（ビルド不要）。`tsc` は型チェックのみ |
| テスト | `node:test`。yt-dlp / ffprobe は偽スクリプトで置き換えて API を結合テスト |
| UI ライブラリ | 使わない（素の CSS、ダークモード対応） |
| 動画形式 | 解像度ごとに1つ。MP4（H.264 + AAC）を優先し、**結合のみで再エンコードしない**。H.264 が無い解像度（1440p / 2160p 等）は WebM（VP9 + Opus）、次に MP4（AV1 + AAC）を元のコーデックのまま提供し、画面に理由を表示 |
| 音声形式 | MP3（VBR V0 相当）への変換のみ |
| ストリーム選択 | 直接ダウンロード（DASH）> HLS、通常版 > DRC 版、ステレオ以下 > 5.1ch、元の言語を優先。DRM 付き・HDR・ストーリーボードは除外 |
| 選択肢の有効期限 | 15分（`INFO_TTL_SEC`）。期限切れは `410` で再解析を促す。実際の可否はダウンロード時に yt-dlp が再取得して再評価 |
| ファイル保持 | ブラウザへの送信完了時に削除。未取得でも完了から30分（`FILE_RETENTION_SEC`）で削除 |
| サイズ上限 | 1ファイル 4 GiB（`MAX_FILESIZE_MB`）。推定サイズが超える選択肢は表示しない |
| 空き容量 | 推定サイズ ×2 + 1 GiB（`MIN_FREE_DISK_MB`）未満なら `507` で開始しない |
| タイムアウト | 解析 60秒、ダウンロード + 後処理 60分、検証 30秒。キャンセル時は SIGTERM → 5秒後 SIGKILL（プロセスグループごと） |
| 同時実行 | ダウンロード1件（キューなし、`409`）、解析2件（超過は `429`） |
| `watch?v=…&list=…` | 動画単体として扱う（`list` は無視）。`/playlist` やチャンネル URL は拒否 |
| ライブ配信 | 配信中・配信予定・配信直後の処理中は非対応 |
| テスト用素材 | Blender Foundation「Big Buck Bunny」（`aqz-KE-bpKQ`、CC BY 3.0） |

### 環境変数

`compose.yaml` の `environment` で変更できます。

| 変数 | 既定値 | 内容 |
| --- | --- | --- |
| `ALLOWED_HOSTS` | `localhost:3000,127.0.0.1:3000,[::1]:3000` | 受け付ける `Host`。Origin は `http://<host>` を許可 |
| `ALLOWED_ORIGINS` | なし | 追加で許可する Origin（開発用） |
| `INFO_TTL_SEC` | `900` | 解析結果の有効期限 |
| `FILE_RETENTION_SEC` | `1800` | 完成ファイルの保持期限 |
| `JOB_RETENTION_SEC` | `7200` | ジョブ記録（メモリ）の保持期限 |
| `MAX_FILESIZE_MB` | `4096` | 1ファイルの最大サイズ |
| `MIN_FREE_DISK_MB` | `1024` | 開始に必要な空き容量（推定サイズに加算） |
| `INFO_TIMEOUT_SEC` / `DOWNLOAD_TIMEOUT_SEC` / `PROBE_TIMEOUT_SEC` | `60` / `3600` / `30` | 各タイムアウト |
| `MAX_CONCURRENT_INFO` | `2` | 同時解析数 |
| `LOG_LEVEL` | `info` | ログレベル |

ホスト側のポートを変える場合（例: `127.0.0.1:8080:3000`）は、`ALLOWED_HOSTS` も
`localhost:8080,127.0.0.1:8080` に変更してください。

## セキュリティ

- 公開ポートは `127.0.0.1:3000` のみ（LAN など他のインターフェースからは到達不可）。
- `Host` ヘッダーを許可リストに限定（DNS rebinding 対策）。
- `POST` / `DELETE` は `Origin` を検証し、API への `Sec-Fetch-Site: cross-site / same-site` を拒否。CORS は無効。JSON 以外のボディは `415`。
- 未知のプロパティを含むリクエストは `400`。形式IDはサーバーが生成したものだけを受け付け、yt-dlp のフォーマット式や引数をクライアントから渡せない。
- URL は YouTube の明示的なホスト・パスのみ許可し、動画ID（11文字）を抽出して `https://www.youtube.com/watch?v=<id>` に再構築。yt-dlp には `--ignore-config --no-playlist --no-cookies` と `--` の後に固定URLを渡し、`--match-filters "id='<id>' & !is_live"` で別の動画への差し替わりを防ぐ。取得したメタデータの ID も照合。
- `spawn()` を `shell: false` で使用。子プロセスには最小限の環境変数のみ渡す。
- コンテナは非 root（`node` ユーザー）、`cap_drop: [ALL]`、`no-new-privileges`、`pids_limit`、`init`。bind mount・Docker ソケット・ホームディレクトリ等はマウントしない。アプリのファイルは root 所有で、書き込めるのは `/app/tmp` のみ。
- ファイル配信はジョブに紐づくサーバー管理下のファイルのみ。ジョブIDは UUID で検証し、パスは作業ディレクトリ内に限定。
- ファイル名はタイトルから制御文字・パス区切り・禁止文字を除去して120文字に制限し、`Content-Disposition` は ASCII フォールバック + `filename*` で返す。タイトルは React がエスケープして表示。
- CSP（`script-src 'self'` 等）、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer` などを付与。サムネイルは動画IDから組み立てた `i.ytimg.com` の URL のみ。
- エラーは公開用のコードとメッセージのみ返し、yt-dlp の出力やスタックトレースはサーバーログにのみ残す。

## 作業ファイルの掃除

作業ファイルはコンテナ内の `/app/tmp/jobs/<job-id>/` に置かれ、次のタイミングで削除されます。

- 完了ファイルの送信完了時 / 失敗時 / キャンセル時
- 保持期限切れ（1分ごとの掃除で、管理外のディレクトリも削除）
- 正常終了時（SIGTERM）と起動時（強制終了後の残存分）

## 開発

```bash
npm install          # 開発用依存（Biome / TypeScript / Vite など）
npm run lint         # Biome による lint + format チェック
npm run lint:fix     # 自動修正
npm run typecheck    # backend / frontend の型チェック
npm test             # バックエンドのテスト（yt-dlp は偽スクリプトを使用）
npm run build        # フロントエンドのビルド
```

ホストで直接バックエンドを動かす場合のみ、ホストに yt-dlp・FFmpeg・Deno が必要です。
通常は Docker で動作確認してください。ホストで UI を開発する場合の例:

```bash
ALLOWED_ORIGINS=http://127.0.0.1:5173 npm run dev:backend   # :3000
npm run dev:frontend                                         # :5173（/api を :3000 にプロキシ）
```

## 動作確認の記録

| Phase | 確認内容 | 結果 |
| --- | --- | --- |
| 1 | コンテナ内で yt-dlp 2026.10.26 / yt-dlp-ejs 0.8.0 / Deno 2.9.8 / FFmpeg 7.1.5 が起動。yt-dlp の JS チャレンジが Deno + EJS（Python パッケージ版）で解決される | OK |
| 1 | テスト動画のメタデータ取得、360p MP4（結合）と MP3（変換）の保存、ffprobe で h264+aac / mp3 を確認 | OK |
| 1 | 2160p ダウンロード中のキャンセルで yt-dlp プロセスと `.part` ファイルが消える | OK |
| 2 | 並列ジョブ `409`、不正URL・プレイリスト・チャンネル `400`、不正 Host / Origin / cross-site `403`、パストラバーサル拒否 | OK |
| 2 | 送信完了後のファイル削除・`410`、SIGKILL 後の再起動時の残存ファイル掃除 | OK |
| 3 | Chrome で解析（サムネイル・タイトル・再生時間・形式表示）、360p MP4 / MP3 の進捗・後処理中（不定進捗）・完了表示、キャンセル、プレイリストURLのエラー表示。コンソールエラー・CSP 違反なし | OK |
| 4 | `docker compose up -d --build`、`127.0.0.1:3000` のみにバインド、LAN IP からは接続不可、非 root・cap_drop 確認 | OK（macOS / arm64） |
| 4 | `linux/amd64` でのビルド（Apple Silicon 上のエミュレーション）と yt-dlp / Deno / FFmpeg / Node の起動 | OK（実機の amd64 Linux では未確認） |

`linux/amd64` を確認する場合: `docker buildx build --platform linux/amd64 -t video-downloader:amd64 .`

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| `BOT_CHECK`（YouTube から追加の確認を求められた） | 時間をおいて再試行。続く場合は yt-dlp の更新を検討（ログイン・Cookie 機能はありません） |
| `FORMAT_UNAVAILABLE` / `YTDLP_FAILED` が頻発 | YouTube 側の仕様変更の可能性。下記の手順で yt-dlp を更新 |
| `HOST_NOT_ALLOWED` | `http://localhost:3000` で開いているか、ポート変更時に `ALLOWED_HOSTS` を更新したか確認 |
| `INSUFFICIENT_STORAGE` | Docker のディスク領域を確保（`docker system df` / `docker builder prune`） |
| 詳細を知りたい | `docker compose logs -f downloader` に yt-dlp のエラー出力が記録されます |

## 依存関係の更新手順

ベースイメージ・ツール・ライブラリはすべてバージョン固定です。意図的に更新してください。

1. **yt-dlp**（YouTube の仕様変更時はまずこれ）: `docker/requirements.txt` の `yt-dlp` と `yt-dlp-ejs`
   を更新。依存の固定値は次で取得できます。
   ```bash
   docker run --rm node:24.22.2-trixie-slim sh -c 'apt-get update -qq && apt-get install -y -qq python3-venv >/dev/null \
     && python3 -m venv /v && /v/bin/pip install -q "yt-dlp[default]==<新バージョン>" && /v/bin/pip freeze'
   ```
2. **Deno / Node.js ベースイメージ**: `Dockerfile` の `DENO_IMAGE` / `NODE_IMAGE` を更新（FFmpeg / Python は Debian のセキュリティ更新に追従するため、ベースイメージ更新で取り込まれます）。
3. **npm パッケージ**: 各 `package.json` の固定バージョンを更新して `npm install`。
4. `npm run lint && npm run typecheck && npm test` を実行し、`docker compose up -d --build` 後にテスト動画で解析・保存・キャンセルを確認。

## 既知の制約

- 対応は YouTube の単一動画のみ。プレイリスト、字幕・チャプター、ログインが必要な動画（メンバー限定・年齢制限・非公開）、ライブ配信は非対応。
- 画質・形式は動画ごとに異なり、MP4 や 1080p は保証されません。1440p 以上は通常 WebM（VP9）です。
- ジョブとファイルはコンテナ再起動で失われます。ダウンロードは同時に1件のみです。
- MP3 変換・映像音声の結合中は進捗率を表示できないため、不定進捗表示になります。
- YouTube 側の変更で yt-dlp が動作しなくなることがあります（上記の更新手順を参照）。
