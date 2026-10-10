import { randomBytes } from "node:crypto";
import type { AdminImage, ImageContentType, ImageUpload, ImageUploadRequest } from "@blog/shared";
import { and, asc, eq, isNull, lt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { images } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import type { ObjectStorage } from "../storage.ts";

/** 上传 URL 的有效期：够传完一张 10MB 的图，又不会长期有效 */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
/** 申请后多久还没确认就当作放弃，由定时任务清理（远大于 URL 有效期，不会误删正在上传的） */
export const PENDING_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;

const extensions: Record<ImageContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

type ImageRow = typeof images.$inferSelect;

function toAdminImage(storage: ObjectStorage, row: ImageRow): AdminImage {
  return {
    id: row.id,
    url: storage.publicUrl(row.key),
    // 写入时已按 imageContentTypeSchema 校验过
    contentType: row.contentType as ImageContentType,
    size: row.size,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 对象 key：images/2026/10/<16 位随机串>.webp。按月分目录只是方便在存储控制台里浏览 */
function newKey(contentType: ImageContentType, now: Date): string {
  const month = now.toISOString().slice(0, 7).replace("-", "/");
  return `images/${month}/${randomBytes(12).toString("base64url")}.${extensions[contentType]}`;
}

/** 第一步：记一笔"待确认"的图片，签发只能上传这个类型、这个大小的 URL */
export async function createImageUpload(db: Db, storage: ObjectStorage, request: ImageUploadRequest, now = new Date()): Promise<ImageUpload> {
  const [row] = await db
    .insert(images)
    .values({ key: newKey(request.contentType, now), contentType: request.contentType, size: request.size })
    .returning();
  if (!row) throw new Error("insert returned no row");

  const { url, headers } = storage.presignPut(row.key, { ...request, expiresIn: UPLOAD_URL_TTL_SECONDS });
  return {
    image: toAdminImage(storage, row),
    upload: { url, method: "PUT", headers, expiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString() },
  };
}

/**
 * 第二步：浏览器说"传完了"，但不能只听它说——到存储里查一下文件是否真的在、大小和类型是否与申请时一致。
 * 不一致（理论上签名会拦住，这里再兜底）就删掉文件和记录。重复确认直接返回。
 */
export async function confirmImage(db: Db, storage: ObjectStorage, id: number, now = new Date()): Promise<AdminImage | null> {
  const [row] = await db.select().from(images).where(eq(images.id, id));
  if (!row) return null;
  if (row.confirmedAt) return toAdminImage(storage, row);

  const object = await storage.head(row.key);
  if (!object) throw new HttpError(409, "conflict", "图片还没有上传完成");
  if (object.size !== row.size || object.contentType !== row.contentType) {
    await storage.delete(row.key);
    await db.delete(images).where(eq(images.id, id));
    throw new HttpError(400, "validation_error", "上传的文件与申请时声明的不一致，请重新上传");
  }

  const [confirmed] = await db.update(images).set({ confirmedAt: now }).where(eq(images.id, id)).returning();
  return confirmed ? toAdminImage(storage, confirmed) : null;
}

/** 定时任务：清理申请后一直没确认的图片（先删存储里的文件，再删记录；中途失败下次重试）。返回清理的张数 */
export async function cleanupPendingImages(db: Db, storage: ObjectStorage, now = new Date()): Promise<number> {
  const stale = await db
    .select({ id: images.id, key: images.key })
    .from(images)
    .where(and(isNull(images.confirmedAt), lt(images.createdAt, new Date(now.getTime() - PENDING_IMAGE_TTL_MS))))
    .orderBy(asc(images.createdAt))
    // 每次最多处理 100 张，单次调用不会超过函数时限；积压的第二天接着清
    .limit(100);
  for (const { id, key } of stale) {
    await storage.delete(key);
    await db.delete(images).where(eq(images.id, id));
  }
  return stale.length;
}
