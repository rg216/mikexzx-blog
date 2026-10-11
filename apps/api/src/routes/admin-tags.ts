import { tagInputSchema, tagMergeInputSchema, tagUpdateInputSchema } from "@blog/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../lib/errors.ts";
import { type Revalidator, tagsForPublishedPosts } from "../lib/revalidate.ts";
import { validate } from "../lib/validate.ts";
import type { AuthEnv } from "../middleware/auth.ts";
import { createTag, deleteTag, listAdminTags, mergeTag, updateTag } from "../services/tags.ts";

const idParam = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });

/** 标签管理（挂在 /admin/tags，鉴权和限流由 adminRoutes 统一处理） */
export function adminTagRoutes(db: Db, revalidate: Revalidator) {
  async function refresh(publishedSlugs: string[]) {
    const tags = tagsForPublishedPosts(publishedSlugs);
    if (tags.length > 0) await revalidate(tags);
  }

  return new Hono<AuthEnv>()
    .get("/", async (c) => c.json(await listAdminTags(db)))
    .post("/", validate("json", tagInputSchema), async (c) => c.json(await createTag(db, c.req.valid("json")), 201))
    .patch("/:id", validate("param", idParam), validate("json", tagUpdateInputSchema), async (c) => {
      const change = await updateTag(db, c.req.valid("param").id, c.req.valid("json"));
      if (!change) throw new HttpError(404, "not_found", "标签不存在");
      await refresh(change.publishedSlugs);
      return c.json(change.result);
    })
    .delete("/:id", validate("param", idParam), async (c) => {
      const change = await deleteTag(db, c.req.valid("param").id);
      if (!change) throw new HttpError(404, "not_found", "标签不存在");
      await refresh(change.publishedSlugs);
      return c.body(null, 204);
    })
    .post("/:id/merge", validate("param", idParam), validate("json", tagMergeInputSchema), async (c) => {
      const change = await mergeTag(db, c.req.valid("param").id, c.req.valid("json").into);
      await refresh(change.publishedSlugs);
      return c.json(change.result);
    });
}
