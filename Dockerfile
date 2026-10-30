# syntax=docker/dockerfile:1

# ベースイメージ・ツールのバージョンは固定し、意図的に更新する（README 参照）
ARG NODE_IMAGE=node:24.22.2-trixie-slim
ARG DENO_IMAGE=denoland/deno:bin-2.9.8

FROM ${DENO_IMAGE} AS deno

# ---- ビルド: フロントエンドをビルドし、バックエンドの本番依存だけを用意する ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY shared shared
COPY frontend frontend
RUN npm run build -w frontend

FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace=backend --include-workspace-root=false --no-audit --no-fund

# ---- 実行 ----
FROM ${NODE_IMAGE} AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY docker/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir --no-deps --require-virtualenv -r /tmp/requirements.txt \
  && /opt/yt-dlp/bin/pip check \
  && rm /tmp/requirements.txt

COPY --from=deno /deno /usr/local/bin/deno

ENV NODE_ENV=production \
  PATH=/opt/yt-dlp/bin:$PATH \
  HOST=0.0.0.0 \
  PORT=3000 \
  WORK_DIR=/app/tmp \
  STATIC_DIR=/app/frontend/dist \
  HOME=/app/tmp/home \
  DENO_DIR=/app/tmp/deno \
  DENO_NO_UPDATE_CHECK=1 \
  PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY backend/package.json backend/
COPY backend/src backend/src
COPY --from=build /app/frontend/dist frontend/dist
COPY docker/healthcheck.mjs docker/healthcheck.mjs

# アプリのファイルは root 所有（読み取り専用）とし、書き込み可能なのは作業ディレクトリのみ
RUN mkdir -p /app/tmp/home /app/tmp/deno && chown -R node:node /app/tmp && chmod 700 /app/tmp

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "docker/healthcheck.mjs"]
CMD ["node", "backend/src/server.ts"]
