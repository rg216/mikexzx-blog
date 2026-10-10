// Vercel 的 Hono 构建器只认"入口文件自己 import 了 hono"，不会顺着 import 链去找，
// 所以这里直接导入 Hono（下面用 satisfies 校验导出的确实是 Hono 实例）。
import { Hono } from "hono";
import { createAuthConfig } from "./auth/config.ts";
import { createApp } from "./create-app.ts";
import { createDb } from "./db/client.ts";
import { createGitHub } from "./auth/github.ts";
import { githubConfigFrom, loadEnv, storageConfigFrom } from "./env.ts";
import { createRevalidator } from "./lib/revalidate.ts";
import { createRedisProvider } from "./redis.ts";
import { createObjectStorage } from "./storage.ts";
import type { AuthEnv } from "./middleware/auth.ts";

/*
 * 生产入口：读环境变量、连数据库、默认导出 Hono app。
 * - Vercel 自动识别 src/index.ts 的默认导出，部署成 Function；
 * - 本地 / VPS 由 serve.ts 用 @hono/node-server 监听端口。
 * 两种部署方式共用这一个文件，业务代码不感知运行在哪里。
 */
const env = loadEnv();
export const { db, pool } = createDb(env.DATABASE_URL);

const storage = storageConfigFrom(env);
const github = githubConfigFrom(env);

const app = createApp({
  db,
  auth: createAuthConfig({ webOrigin: env.WEB_ORIGIN, setupToken: env.ADMIN_SETUP_TOKEN }),
  ...(env.REVALIDATE_SECRET
    ? { revalidate: createRevalidator({ url: `${env.WEB_ORIGIN}/hooks/revalidate`, secret: env.REVALIDATE_SECRET }) }
    : {}),
  redis: env.REDIS_URL ? createRedisProvider(env.REDIS_URL) : null,
  storage: storage ? createObjectStorage(storage) : null,
  github: github ? createGitHub(github) : null,
  ...(env.CRON_SECRET ? { cronSecret: env.CRON_SECRET } : {}),
  logRequests: true,
}) satisfies Hono<AuthEnv>;
export default app;
