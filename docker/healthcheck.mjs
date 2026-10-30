// コンテナの HEALTHCHECK 用。Host ヘッダーを許可値にしてヘルスチェック API を呼ぶ。
import http from "node:http";

const req = http.get(
  {
    host: "127.0.0.1",
    port: process.env.PORT ?? 3000,
    path: "/api/health",
    headers: { host: "localhost:3000" },
    timeout: 3000,
  },
  (res) => process.exit(res.statusCode === 200 ? 0 : 1),
);
req.on("timeout", () => req.destroy());
req.on("error", () => process.exit(1));
