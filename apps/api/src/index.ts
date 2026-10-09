import { createApp } from "./create-app.ts";
import { createDb } from "./db/client.ts";
import { loadEnv } from "./env.ts";

/*
 * 生产入口：读环境变量、连数据库、默认导出 Hono app。
 * - Vercel 自动识别 src/index.ts 的默认导出，部署成 Function；
 * - 本地 / VPS 由 serve.ts 用 @hono/node-server 监听端口。
 * 两种部署方式共用这一个文件，业务代码不感知运行在哪里。
 */
const env = loadEnv();
export const { db, pool } = createDb(env.DATABASE_URL);

const app = createApp({ db, adminToken: env.ADMIN_TOKEN, logRequests: true });
export default app;
