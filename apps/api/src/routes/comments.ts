import { type CommentList, commentCreateInputSchema, commentUpdateInputSchema, type PublicComment, slugSchema } from "@blog/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../lib/errors.ts";
import { createMiddleware } from "hono/factory";
import { type RateLimiter, rateLimit, rules } from "../lib/rate-limit.ts";
import { validate } from "../lib/validate.ts";
import { type AuthEnv, commenterOf } from "../middleware/auth.ts";
import { createComment, deleteOwnComment, editComment, listPostComments } from "../services/comments.ts";
import { getPublishedPostId } from "../services/posts.ts";

/**
 * 文章评论。和阅读数一样由浏览器单独请求，不进 ISR 页面：评论随时会变，
 * 而且内容因人而异（自己待审核的评论只有自己看得到）。
 */
const idParam = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });

export function commentRoutes(db: Db, limiter: RateLimiter) {
  // 先确认登录，再按评论者限流（发、改、删共用一个额度）
  const requireCommenter = createMiddleware<AuthEnv>(async (c, next) => {
    commenterOf(c);
    await next();
  });
  const limitWrites = rateLimit(limiter, rules.comment, (c) => `commenter:${commenterOf(c).commenter.id}`);

  async function postIdOr404(slug: string): Promise<number> {
    const id = slugSchema.safeParse(slug).success ? await getPublishedPostId(db, slug) : null;
    if (id === null) throw new HttpError(404, "not_found", "文章不存在");
    return id;
  }

  return new Hono<AuthEnv>()
    .get("/posts/:slug/comments", async (c) => {
      const postId = await postIdOr404(c.req.param("slug"));
      const viewer = c.get("commenter")?.commenter.id ?? null;
      // 内容因登录状态而异，不能被任何共享缓存存下来
      c.header("Cache-Control", "private, no-store");
      return c.json((await listPostComments(db, postId, viewer)) satisfies CommentList);
    })
    .post(
      "/posts/:slug/comments",
      requireCommenter,
      limitWrites,
      validate("json", commentCreateInputSchema),
      async (c) => {
        const postId = await postIdOr404(c.req.param("slug"));
        const { body, parentId } = c.req.valid("json");
        const comment = await createComment(db, { postId, commenter: commenterOf(c).commenter, body, parentId });
        return c.json(comment satisfies PublicComment, 201);
      },
    )
    /** 作者编辑自己的评论 */
    .patch("/comments/:id", requireCommenter, limitWrites, validate("param", idParam), validate("json", commentUpdateInputSchema), async (c) => {
      const comment = await editComment(db, { id: c.req.valid("param").id, commenter: commenterOf(c).commenter, body: c.req.valid("json").body });
      return c.json(comment satisfies PublicComment);
    })
    /** 作者删除自己的评论 */
    .delete("/comments/:id", requireCommenter, limitWrites, validate("param", idParam), async (c) => {
      await deleteOwnComment(db, { id: c.req.valid("param").id, commenter: commenterOf(c).commenter });
      return c.body(null, 204);
    });
}
