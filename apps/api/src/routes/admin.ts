import { localeSchema, postCreateInputSchema, postUpdateInputSchema, translationInputSchema } from "@blog/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../lib/errors.ts";
import { type RateLimiter, rateLimit, rules } from "../lib/rate-limit.ts";
import { type Revalidator, tagsForChange, tagsForTranslationChange } from "../lib/revalidate.ts";
import { validate } from "../lib/validate.ts";
import { type AuthEnv, requireSession, sessionOf } from "../middleware/auth.ts";
import { createPost, deletePost, getPostById, listAllPosts, updatePost } from "../services/posts.ts";
import { deleteTranslation, getTranslation, upsertTranslation } from "../services/translations.ts";
import type { ObjectStorage } from "../storage.ts";
import type { GitHub } from "../auth/github.ts";
import type { StatusDeps } from "../services/status.ts";
import { adminCommentRoutes } from "./admin-comments.ts";
import { adminSystemRoutes } from "./admin-system.ts";
import { adminTagRoutes } from "./admin-tags.ts";
import { imageRoutes, mediaFolderRoutes } from "./images.ts";
import { type TranslationDeps, translateRoutes } from "./translate.ts";

const idParam = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });
// 不支持的语言按 400 处理（与公开接口的 ?locale= 一致），而不是 404：那是请求本身写错了，不是"资源不存在"
const translationParam = idParam.extend({ locale: localeSchema });

export function adminRoutes(
  db: Db,
  revalidate: Revalidator,
  limiter: RateLimiter,
  storage: ObjectStorage | null,
  github: GitHub | null,
  translation: TranslationDeps,
  status: Omit<StatusDeps, "db">,
) {
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
    })
    // ---------- 译文（v4.5）：每篇文章每种非原文语言一篇，PUT 整体保存 ----------
    .get("/posts/:id/translations/:locale", validate("param", translationParam), async (c) => {
      const { id, locale } = c.req.valid("param");
      const translation = await getTranslation(db, id, locale);
      if (!translation) throw new HttpError(404, "not_found", "译文不存在");
      return c.json(translation);
    })
    .put("/posts/:id/translations/:locale", validate("param", translationParam), validate("json", translationInputSchema), async (c) => {
      const { id, locale } = c.req.valid("param");
      const { translation, change } = await upsertTranslation(db, id, locale, c.req.valid("json"));
      const tags = tagsForTranslationChange({ ...change, locale, existsAfter: true });
      if (tags.length > 0) await revalidate(tags);
      // PUT 的语义：新建返回 201，替换已有的返回 200
      return c.json(translation, change.existedBefore ? 200 : 201);
    })
    .delete("/posts/:id/translations/:locale", validate("param", translationParam), async (c) => {
      const { id, locale } = c.req.valid("param");
      const change = await deleteTranslation(db, id, locale);
      const tags = tagsForTranslationChange({ ...change, locale, existsAfter: false });
      if (tags.length > 0) await revalidate(tags);
      return c.body(null, 204);
    })
    // ---------- 大模型翻译（v5.5）：生成的译文只回给编辑器，保存仍走上面的 PUT ----------
    .route("/", translateRoutes(db, translation, limiter))
    .route("/tags", adminTagRoutes(db, revalidate))
    .route("/images", imageRoutes(db, storage))
    .route("/media-folders", mediaFolderRoutes(db))
    .route("/", adminCommentRoutes(db, github))
    .route("/", adminSystemRoutes(db, status));
}
