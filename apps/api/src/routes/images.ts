import { imageUploadRequestSchema } from "@blog/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { errorBody, HttpError } from "../lib/errors.ts";
import { validate } from "../lib/validate.ts";
import type { AuthEnv } from "../middleware/auth.ts";
import { confirmImage, createImageUpload } from "../services/images.ts";
import type { ObjectStorage } from "../storage.ts";

const idParam = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });

/**
 * 图片上传（挂在 /admin/images 下，鉴权和限流由 adminRoutes 统一处理）。
 * 文件不经过 API：API 只签发上传 URL，浏览器直接传给对象存储。
 * 这样 API 不用处理大请求体（Vercel 函数的请求体上限是 4.5MB），也不为搬运文件付带宽和执行时间。
 */
export function imageRoutes(db: Db, storage: ObjectStorage | null) {
  if (!storage) return new Hono<AuthEnv>().all("*", (c) => c.json(errorBody("internal_error", "未配置图片存储"), 503));

  return new Hono<AuthEnv>()
    .post("/", validate("json", imageUploadRequestSchema), async (c) =>
      c.json(await createImageUpload(db, storage, c.req.valid("json")), 201),
    )
    .post("/:id/confirm", validate("param", idParam), async (c) => {
      const image = await confirmImage(db, storage, c.req.valid("param").id);
      if (!image) throw new HttpError(404, "not_found", "图片不存在");
      return c.json(image);
    });
}
