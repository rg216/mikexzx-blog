import { adminCommentListQuerySchema, commentModerationInputSchema, commenterAddInputSchema, commenterTrustInputSchema } from "@blog/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { GitHub } from "../auth/github.ts";
import type { Db } from "../db/client.ts";
import { errorBody, HttpError } from "../lib/errors.ts";
import { validate } from "../lib/validate.ts";
import type { AuthEnv } from "../middleware/auth.ts";
import {
  addTrustedCommenter,
  countPendingComments,
  deleteComment,
  listAdminComments,
  listCommenters,
  setCommentStatus,
  setCommenterTrust,
} from "../services/comments.ts";

const idParam = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });

/** 评论审核与白名单（挂在 /admin 下，鉴权和限流由 adminRoutes 统一处理） */
export function adminCommentRoutes(db: Db, github: GitHub | null) {
  return new Hono<AuthEnv>()
    .get("/comments", validate("query", adminCommentListQuerySchema), async (c) =>
      c.json(await listAdminComments(db, c.req.valid("query").status)),
    )
    .get("/comments/pending-count", async (c) => c.json({ count: await countPendingComments(db) }))
    .patch("/comments/:id", validate("param", idParam), validate("json", commentModerationInputSchema), async (c) => {
      if (!(await setCommentStatus(db, c.req.valid("param").id, c.req.valid("json").status))) {
        throw new HttpError(404, "not_found", "评论不存在");
      }
      return c.body(null, 204);
    })
    .delete("/comments/:id", validate("param", idParam), async (c) => {
      if (!(await deleteComment(db, c.req.valid("param").id))) throw new HttpError(404, "not_found", "评论不存在");
      return c.body(null, 204);
    })
    .get("/commenters", async (c) => c.json(await listCommenters(db)))
    .patch("/commenters/:id", validate("param", idParam), validate("json", commenterTrustInputSchema), async (c) => {
      const commenter = await setCommenterTrust(db, c.req.valid("param").id, c.req.valid("json").trust);
      if (!commenter) throw new HttpError(404, "not_found", "评论者不存在");
      return c.json(commenter);
    })
    .post("/commenters", validate("json", commenterAddInputSchema), async (c) => {
      if (!github) return c.json(errorBody("internal_error", "未配置 GitHub 登录"), 503);
      const user = await github.fetchUserByLogin(c.req.valid("json").login);
      if (!user) throw new HttpError(404, "not_found", "GitHub 上没有这个用户");
      return c.json(await addTrustedCommenter(db, user), 201);
    });
}
