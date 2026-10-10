import { Hono } from "hono";
import { safeEqual } from "../auth/tokens.ts";
import type { Db } from "../db/client.ts";
import { errorBody } from "../lib/errors.ts";
import type { RedisProvider } from "../redis.ts";
import { flushDay, siteDay } from "../services/views.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 定时任务接口（Vercel Cron 每天调用，见 apps/api/vercel.json）。
 * Vercel Cron 发的是 GET 请求，并自动带上 Authorization: Bearer <CRON_SECRET>。
 */
export function internalRoutes(db: Db, redis: RedisProvider | null, cronSecret: string | undefined) {
  return new Hono()
    .use(async (c, next) => {
      if (!cronSecret) return c.json(errorBody("internal_error", "未配置 CRON_SECRET"), 503);
      const token = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
      if (!token || !safeEqual(token, cronSecret)) return c.json(errorBody("unauthorized", "需要定时任务凭证"), 401);
      await next();
    })
    .get("/views/flush", async (c) => {
      if (!redis) return c.json(errorBody("internal_error", "未配置 REDIS_URL"), 503);
      const client = await redis();
      // 写入昨天和前天：哪天漏跑了，下一次会补上（flushDay 是幂等的覆盖写）
      const now = Date.now();
      const days = [siteDay(new Date(now - DAY_MS)), siteDay(new Date(now - 2 * DAY_MS))];
      const flushed: Record<string, number> = {};
      for (const day of days) flushed[day] = await flushDay(client, db, day);
      return c.json({ flushed });
    });
}
