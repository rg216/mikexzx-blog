import { postCreateInputSchema, postUpdateInputSchema } from "@blog/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../lib/errors.ts";
import { type RateLimiter, rateLimit, rules } from "../lib/rate-limit.ts";
import { type Revalidator, tagsForChange } from "../lib/revalidate.ts";
import { validate } from "../lib/validate.ts";
import { type AuthEnv, requireSession, sessionOf } from "../middleware/auth.ts";
import { createPost, deletePost, getPostById, listAllPosts, updatePost } from "../services/posts.ts";

const idParam = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });

export function adminRoutes(db: Db, revalidate: Revalidator, limiter: RateLimiter) {
  // 写操作按用户限流：正常编辑远远用不到，主要防脚本失控或 session 泄露后的批量破坏
  const limitWrites = rateLimit(limiter, rules.adminWrite, (c) => `user:${sessionOf(c).user.id}`);

  /** 写入成功后，如果前台可见内容变了，通知前端让对应页面失效 */
  async function notify(before: Parameters<typeof tagsForChange>[0], after: Parameters<typeof tagsForChange>[1]) {
    const tags = tagsForChange(before, after);
    if (tags.length > 0) await revalidate(tags);
  }

  return new Hono<AuthEnv>()
    .use(requireSession)
    .use(async (c, next) => (c.req.method === "GET" ? next() : limitWrites(c, next)))
    .get("/posts", async (c) => c.json(await listAllPosts(db)))
    .get("/posts/:id", validate("param", idParam), async (c) => {
      const post = await getPostById(db, c.req.valid("param").id);
      if (!post) throw new HttpError(404, "not_found", "文章不存在");
      return c.json(post);
    })
    .post("/posts", validate("json", postCreateInputSchema), async (c) => {
      const post = await createPost(db, c.req.valid("json"));
      await notify(null, post);
      c.header("Location", `/admin/posts/${post.id}`);
      return c.json(post, 201);
    })
    .patch("/posts/:id", validate("param", idParam), validate("json", postUpdateInputSchema), async (c) => {
      const result = await updatePost(db, c.req.valid("param").id, c.req.valid("json"));
      if (!result) throw new HttpError(404, "not_found", "文章不存在");
      await notify(result.before, result.post);
      return c.json(result.post);
    })
    .delete("/posts/:id", validate("param", idParam), async (c) => {
      const deleted = await deletePost(db, c.req.valid("param").id);
      if (!deleted) throw new HttpError(404, "not_found", "文章不存在");
      await notify(deleted, null);
      return c.body(null, 204);
    });
}
