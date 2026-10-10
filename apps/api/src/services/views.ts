import { inArray, sql } from "drizzle-orm";
import { sha256Hex, randomToken } from "../auth/tokens.ts";
import type { Db } from "../db/client.ts";
import { posts, postViews } from "../db/schema.ts";
import type { Redis } from "../redis.ts";

/*
 * 阅读计数（Redis）
 *   views:total:<postId>              总阅读数
 *   views:day:<YYYY-MM-DD>            HASH postId → 当天阅读数（保留 8 天，供每日写入 Postgres）
 *   views:seen:<day>:<postId>:<访客>   去重标记，2 天过期
 *   views:salt:<day>                  当天的随机盐，2 天过期
 *
 * 去重不用 cookie、不存 IP：访客 = SHA-256(当天随机盐 | IP | User-Agent)。
 * 同一个人一天内反复刷新只算一次；盐每天更换且从不落盘，第二天的哈希无法和前一天关联，
 * 没法用它长期追踪任何人（Plausible 等隐私友好统计工具的做法）。
 */

const SITE_TIME_ZONE = "Asia/Shanghai";
const DAY_SECONDS = 24 * 60 * 60;

/** 按站点时区的日期 YYYY-MM-DD（en-CA 的日期格式恰好是 ISO 顺序） */
export function siteDay(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SITE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** 爬虫、预览抓取、命令行工具不计数（大多数爬虫也不执行 JS，本来就不会发计数请求） */
const NON_HUMAN_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python-requests|go-http-client|okhttp/i;

export function isLikelyBot(userAgent: string | undefined): boolean {
  return !userAgent || NON_HUMAN_UA.test(userAgent);
}

async function dailySalt(redis: Redis, day: string): Promise<string> {
  const key = `views:salt:${day}`;
  // 并发时只有第一个 SET NX 生效，大家随后读到同一个盐
  await redis.set(key, randomToken(16), { condition: "NX", expiration: { type: "EX", value: 2 * DAY_SECONDS } });
  return (await redis.get(key)) ?? "";
}

export async function getViews(redis: Redis, postId: number): Promise<number> {
  return Number((await redis.get(`views:total:${postId}`)) ?? 0);
}

/** 记一次阅读（同一访客同一天同一篇只算一次），返回最新总数。 */
export async function recordView(
  redis: Redis,
  { postId, ip, userAgent, now = new Date() }: { postId: number; ip: string; userAgent: string; now?: Date },
): Promise<{ counted: boolean; views: number }> {
  const day = siteDay(now);
  const visitor = sha256Hex(`${await dailySalt(redis, day)}|${ip}|${userAgent}`);
  const first = await redis.set(`views:seen:${day}:${postId}:${visitor}`, "1", {
    condition: "NX",
    expiration: { type: "EX", value: 2 * DAY_SECONDS },
  });
  if (first === null) return { counted: false, views: await getViews(redis, postId) };

  const dayKey = `views:day:${day}`;
  const [total] = await redis
    .multi()
    .incr(`views:total:${postId}`)
    .hIncrBy(dayKey, String(postId), 1)
    .expire(dayKey, 8 * DAY_SECONDS)
    .exec();
  return { counted: true, views: Number(total) };
}

/**
 * 把某天的阅读数写入 Postgres（每日定时任务调用）。
 * 用"覆盖写"而不是"累加"：同一天重复执行结果不变（幂等），漏跑一次第二天补上即可。
 */
export async function flushDay(redis: Redis, db: Db, day: string): Promise<number> {
  const counts = Object.entries(await redis.hGetAll(`views:day:${day}`))
    .map(([postId, views]) => ({ postId: Number(postId), views: Number(views) }))
    .filter((row) => Number.isInteger(row.postId) && row.postId > 0 && row.views > 0);
  if (counts.length === 0) return 0;

  // 期间被删除的文章没有对应行了，跳过（否则外键约束会让整批写入失败）
  const existing = new Set(
    (await db.select({ id: posts.id }).from(posts).where(inArray(posts.id, counts.map((r) => r.postId)))).map((r) => r.id),
  );
  const rows = counts.filter((r) => existing.has(r.postId)).map((r) => ({ ...r, day }));
  if (rows.length === 0) return 0;

  await db
    .insert(postViews)
    .values(rows)
    .onConflictDoUpdate({ target: [postViews.postId, postViews.day], set: { views: sql`excluded.views` } });
  return rows.length;
}
