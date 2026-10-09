import { postCreateInputSchema, postUpdateInputSchema } from "@blog/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { HttpError } from "../lib/errors.ts";
import { validate } from "../lib/validate.ts";
import { type AuthEnv, requireSession } from "../middleware/auth.ts";
import { createPost, deletePost, getPostById, listAllPosts, updatePost } from "../services/posts.ts";

const idParam = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });

export function adminRoutes(db: Db) {
  return new Hono<AuthEnv>()
    .use(requireSession)
    .get("/posts", async (c) => c.json(await listAllPosts(db)))
    .get("/posts/:id", validate("param", idParam), async (c) => {
      const post = await getPostById(db, c.req.valid("param").id);
      if (!post) throw new HttpError(404, "not_found", "文章不存在");
      return c.json(post);
    })
    .post("/posts", validate("json", postCreateInputSchema), async (c) => {
      const post = await createPost(db, c.req.valid("json"));
      c.header("Location", `/admin/posts/${post.id}`);
      return c.json(post, 201);
    })
    .patch("/posts/:id", validate("param", idParam), validate("json", postUpdateInputSchema), async (c) => {
      const post = await updatePost(db, c.req.valid("param").id, c.req.valid("json"));
      if (!post) throw new HttpError(404, "not_found", "文章不存在");
      return c.json(post);
    })
    .delete("/posts/:id", validate("param", idParam), async (c) => {
      const deleted = await deletePost(db, c.req.valid("param").id);
      if (!deleted) throw new HttpError(404, "not_found", "文章不存在");
      return c.body(null, 204);
    });
}
