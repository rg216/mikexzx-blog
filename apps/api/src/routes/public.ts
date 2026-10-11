import { listPostsQuerySchema, localeQuerySchema, slugSchema } from "@blog/shared";
import { Hono } from "hono";
import type { Db } from "../db/client.ts";
import { decodeCursor } from "../lib/cursor.ts";
import { errorBody, HttpError } from "../lib/errors.ts";
import { validate } from "../lib/validate.ts";
import { getPublishedPost, listArchive, listPublishedPosts, listTags } from "../services/posts.ts";

export function publicRoutes(db: Db) {
  return new Hono()
    .get("/posts", validate("query", listPostsQuerySchema), async (c) => {
      const { limit, cursor, locale, tags, from, to } = c.req.valid("query");
      const decoded = cursor === undefined ? null : decodeCursor(cursor);
      if (cursor !== undefined && !decoded) {
        return c.json(errorBody("validation_error", "请求参数无效", [{ path: "cursor", message: "无效的分页游标" }]), 400);
      }
      return c.json(await listPublishedPosts(db, { limit, cursor: decoded, locale, filter: { tags, from, to } }));
    })
    .get("/archive", validate("query", localeQuerySchema), async (c) => c.json(await listArchive(db, c.req.valid("query").locale)))
    // ?locale= 不传时是默认语言（兼容没有语言参数的旧前端）；不支持的语言 400
    .get("/posts/:slug", validate("query", localeQuerySchema), async (c) => {
      const slug = c.req.param("slug");
      // 格式不合法的 slug 不可能存在，按 404 处理，不必报 400
      const post = slugSchema.safeParse(slug).success ? await getPublishedPost(db, slug, c.req.valid("query").locale) : null;
      if (!post) throw new HttpError(404, "not_found", "文章不存在");
      return c.json(post);
    })
    .get("/tags", validate("query", localeQuerySchema), async (c) => c.json(await listTags(db, c.req.valid("query").locale)));
}
