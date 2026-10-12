import { Hono } from "hono";
import { safeEqual } from "../auth/tokens.ts";
import type { Db } from "../db/client.ts";
import { errorBody } from "../lib/errors.ts";
import type { RedisProvider } from "../redis.ts";
import { backfillImageDimensions, cleanupPendingImages } from "../services/images.ts";
import { recordJobRun } from "../services/jobs.ts";
import { flushDay, siteDay } from "../services/views.ts";
import type { ObjectStorage } from "../storage.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 定时任务接口（Vercel Cron 每天调用，见 apps/api/vercel.json）。
 * Vercel Cron 发的是 GET 请求，并自动带上 Authorization: Bearer <CRON_SECRET>。
 * 每次运行的结果记在 job_runs（recordJobRun），后台的状态页据此显示；没配置依赖（503）不算一次运行。
 */
export function internalRoutes(db: Db, redis: RedisProvider | null, storage: ObjectStorage | null, cronSecret: string | undefined) {
  return new Hono()
    .use(async (c, next) => {
      if (!cronSecret) return c.json(errorBody("internal_error", "未配置 CRON_SECRET"), 503);
      const token = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
      if (!token || !safeEqual(token, cronSecret)) return c.json(errorBody("unauthorized", "需要定时任务凭证"), 401);
      await next();
    })
    .get("/views/flush", async (c) => {
      if (!redis) return c.json(errorBody("internal_error", "未配置 REDIS_URL"), 503);
      const result = await recordJobRun(db, "views-flush", async () => {
        const client = await redis();
        // 写入昨天和前天：哪天漏跑了，下一次会补上（flushDay 是幂等的覆盖写）
        const now = Date.now();
        const days = [siteDay(new Date(now - DAY_MS)), siteDay(new Date(now - 2 * DAY_MS))];
        const flushed: Record<string, number> = {};
        for (const day of days) flushed[day] = await flushDay(client, db, day);
        return { flushed };
      });
      return c.json(result);
    })
    .get("/images/cleanup", async (c) => {
      if (!storage) return c.json(errorBody("internal_error", "未配置图片存储"), 503);
      const result = await recordJobRun(db, "images-cleanup", async () => ({
        deleted: await cleanupPendingImages(db, storage),
        // 顺便补全旧图片的尺寸（加这个功能之前上传的）
        dimensionsFilled: await backfillImageDimensions(db, storage),
      }));
      return c.json(result);
    });
}
