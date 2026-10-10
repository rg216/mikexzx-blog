import { slugSchema, type ViewCount } from "@blog/shared";
import { Hono } from "hono";
import { clientIp } from "../lib/client-ip.ts";
import { HttpError } from "../lib/errors.ts";
import { type RateLimiter, rateLimit, rules } from "../lib/rate-limit.ts";
import type { Db } from "../db/client.ts";
import type { RedisProvider } from "../redis.ts";
import { getPublishedPostId } from "../services/posts.ts";
import { getViews, isLikelyBot, recordView } from "../services/views.ts";

/**
 * 阅读计数。数字由浏览器单独请求，不写进 ISR 页面——否则每多一次阅读就要重新生成一次页面。
 * Redis 不可用时返回 { views: null }，前端不显示数字；不影响页面本身。
 */
export function viewRoutes(db: Db, redis: RedisProvider | null, limiter: RateLimiter) {
  async function postIdOr404(slug: string): Promise<number> {
    const id = slugSchema.safeParse(slug).success ? await getPublishedPostId(db, slug) : null;
    if (id === null) throw new HttpError(404, "not_found", "文章不存在");
    return id;
  }

  async function withRedis<T>(fn: (client: Awaited<ReturnType<RedisProvider>>) => Promise<T>): Promise<T | null> {
    if (!redis) return null;
    try {
      return await fn(await redis());
    } catch (error) {
      console.warn("views unavailable:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  return new Hono()
    .get("/posts/:slug/views", async (c) => {
      const postId = await postIdOr404(c.req.param("slug"));
      const views = await withRedis((client) => getViews(client, postId));
      return c.json({ views } satisfies ViewCount);
    })
    .post(
      "/posts/:slug/views",
      rateLimit(limiter, rules.views, (c) => clientIp(c)),
      async (c) => {
        const postId = await postIdOr404(c.req.param("slug"));
        const userAgent = c.req.header("user-agent");
        const views = await withRedis(async (client) =>
          isLikelyBot(userAgent)
            ? getViews(client, postId)
            : (await recordView(client, { postId, ip: clientIp(c), userAgent: userAgent ?? "" })).views,
        );
        return c.json({ views } satisfies ViewCount);
      },
    );
}
