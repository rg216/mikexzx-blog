import { serve } from "@hono/node-server";
import app, { pool } from "./index.ts";

// 本地开发和自托管（v5 VPS）用：在 Node 里监听端口。Vercel 不走这个文件。
const port = Number(process.env.PORT ?? 8787);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});

// 优雅退出：先停止接收新请求，等进行中的请求结束，再关闭数据库连接池
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
