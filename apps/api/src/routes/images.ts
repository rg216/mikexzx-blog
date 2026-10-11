import {
  imageDeleteInputSchema,
  imageListQuerySchema,
  imageMoveInputSchema,
  imageUpdateInputSchema,
  imageUploadRequestSchema,
  mediaFolderInputSchema,
} from "@blog/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { errorBody, HttpError } from "../lib/errors.ts";
import { validate } from "../lib/validate.ts";
import type { AuthEnv } from "../middleware/auth.ts";
import {
  confirmImage,
  createFolder,
  createImageUpload,
  deleteFolder,
  deleteImages,
  getImageDetail,
  listFolders,
  listImages,
  moveImages,
  renameFolder,
  updateImage,
} from "../services/images.ts";
import type { ObjectStorage } from "../storage.ts";

const idParam = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });

const unavailable = () => new Hono<AuthEnv>().all("*", (c) => c.json(errorBody("internal_error", "未配置图片存储"), 503));

/**
 * 媒体库（挂在 /admin/images 下，鉴权和限流由 adminRoutes 统一处理）。
 * 上传时文件不经过 API：API 只签发上传 URL，浏览器直接传给对象存储。
 * 这样 API 不用处理大请求体（Vercel 函数的请求体上限是 4.5MB），也不为搬运文件付带宽和执行时间。
 */
export function imageRoutes(db: Db, storage: ObjectStorage | null) {
  if (!storage) return unavailable();

  return new Hono<AuthEnv>()
    .get("/", validate("query", imageListQuerySchema), async (c) => c.json(await listImages(db, storage, c.req.valid("query"))))
    .post("/", validate("json", imageUploadRequestSchema), async (c) =>
      c.json(await createImageUpload(db, storage, c.req.valid("json")), 201),
    )
    // 批量操作用 POST + 动词路径：DELETE 请求带请求体在一些代理和客户端里支持得不好
    .post("/delete", validate("json", imageDeleteInputSchema), async (c) => {
      const { ids, force } = c.req.valid("json");
      return c.json({ deleted: await deleteImages(db, storage, ids, force) });
    })
    .post("/move", validate("json", imageMoveInputSchema), async (c) => {
      const { ids, folderId } = c.req.valid("json");
      return c.json({ moved: await moveImages(db, ids, folderId) });
    })
    .get("/:id", validate("param", idParam), async (c) => {
      const image = await getImageDetail(db, storage, c.req.valid("param").id);
      if (!image) throw new HttpError(404, "not_found", "图片不存在");
      return c.json(image);
    })
    .patch("/:id", validate("param", idParam), validate("json", imageUpdateInputSchema), async (c) => {
      const image = await updateImage(db, storage, c.req.valid("param").id, c.req.valid("json"));
      if (!image) throw new HttpError(404, "not_found", "图片不存在");
      return c.json(image);
    })
    .post("/:id/confirm", validate("param", idParam), async (c) => {
      const image = await confirmImage(db, storage, c.req.valid("param").id);
      if (!image) throw new HttpError(404, "not_found", "图片不存在");
      return c.json(image);
    });
}

/** 媒体库的文件夹（挂在 /admin/media-folders 下） */
export function mediaFolderRoutes(db: Db) {
  return new Hono<AuthEnv>()
    .get("/", async (c) => c.json(await listFolders(db)))
    .post("/", validate("json", mediaFolderInputSchema), async (c) => c.json(await createFolder(db, c.req.valid("json").name), 201))
    .patch("/:id", validate("param", idParam), validate("json", mediaFolderInputSchema), async (c) => {
      if (!(await renameFolder(db, c.req.valid("param").id, c.req.valid("json").name))) throw new HttpError(404, "not_found", "文件夹不存在");
      return c.body(null, 204);
    })
    .delete("/:id", validate("param", idParam), async (c) => {
      if (!(await deleteFolder(db, c.req.valid("param").id))) throw new HttpError(404, "not_found", "文件夹不存在");
      return c.body(null, 204);
    });
}
