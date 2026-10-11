import { randomBytes } from "node:crypto";
import {
  type AdminImage,
  type AdminImageDetail,
  type ImageContentType,
  type ImageUpload,
  type imageListQuerySchema,
  type imageUpdateInputSchema,
  type imageUploadRequestSchema,
  imageKeysIn,
  type MediaFolder,
  type PostImageMeta,
} from "@blog/shared";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/client.ts";
import { images, mediaFolders, postImages, posts } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { readImageDimensions } from "../lib/image-dimensions.ts";
import type { ObjectStorage } from "../storage.ts";

/** db 本身或事务对象 */
type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** 上传 URL 的有效期：够传完一张 10MB 的图，又不会长期有效 */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
/** 申请后多久还没确认就当作放弃，由定时任务清理（远大于 URL 有效期，不会误删正在上传的） */
export const PENDING_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;
/** 读尺寸时下载文件开头多少字节：各格式的尺寸都在文件头里，JPEG 前面可能有较大的元数据段 */
const DIMENSION_PROBE_BYTES = 128 * 1024;
const LIST_LIMIT = 500;

const extensions: Record<ImageContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

type ImageRow = typeof images.$inferSelect;

/** 尺寸版本的 key：与原图同名，加宽度后缀（与 @blog/shared 的 variantUrl 一致） */
export function variantKey(key: string, width: number): string {
  return key.replace(/(\.\w+)$/, `-${width}w$1`);
}

/** 一张图在存储里的全部文件（原图 + 尺寸版本） */
function objectKeys(row: Pick<ImageRow, "key" | "variants">): string[] {
  return [row.key, ...row.variants.map((width) => variantKey(row.key, width))];
}

function toAdminImage(storage: ObjectStorage, row: ImageRow, usage = 0): AdminImage {
  return {
    id: row.id,
    url: storage.publicUrl(row.key),
    // 写入时已按 imageContentTypeSchema 校验过
    contentType: row.contentType as ImageContentType,
    size: row.size,
    filename: row.filename,
    width: row.width,
    height: row.height,
    variants: row.variants,
    folderId: row.folderId,
    description: row.description,
    usage,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 对象 key：images/2026/10/<16 位随机串>.webp。按月分目录只是方便在存储控制台里浏览 */
function newKey(contentType: ImageContentType, now: Date): string {
  const month = now.toISOString().slice(0, 7).replace("-", "/");
  return `images/${month}/${randomBytes(12).toString("base64url")}.${extensions[contentType]}`;
}

async function assertFolder(db: Executor, folderId: number | null | undefined): Promise<void> {
  if (folderId === null || folderId === undefined) return;
  const [folder] = await db.select({ id: mediaFolders.id }).from(mediaFolders).where(eq(mediaFolders.id, folderId));
  if (!folder) throw new HttpError(404, "not_found", "文件夹不存在");
}

// ---------- 上传 ----------

/** 第一步：记一笔"待确认"的图片，为原图和每个尺寸版本签发只能上传这个类型、这个大小的 URL */
export async function createImageUpload(
  db: Db,
  storage: ObjectStorage,
  request: z.output<typeof imageUploadRequestSchema>,
  now = new Date(),
): Promise<ImageUpload> {
  await assertFolder(db, request.folderId);
  const [row] = await db
    .insert(images)
    .values({
      key: newKey(request.contentType, now),
      contentType: request.contentType,
      size: request.size,
      filename: request.filename,
      variants: request.variants.map((v) => v.width),
      folderId: request.folderId,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");

  const sign = (key: string, size: number) => ({
    method: "PUT" as const,
    ...storage.presignPut(key, { contentType: request.contentType, size, expiresIn: UPLOAD_URL_TTL_SECONDS }),
  });
  return {
    image: toAdminImage(storage, row),
    upload: sign(row.key, request.size),
    variants: request.variants.map((v) => ({ width: v.width, ...sign(variantKey(row.key, v.width), v.size) })),
    expiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

/** 从存储里读图片的宽高；读不出返回 null（不影响图片使用，只是渲染时少了宽高和 srcset） */
async function probeDimensions(storage: ObjectStorage, key: string) {
  const head = await storage.readStart(key, DIMENSION_PROBE_BYTES);
  return head ? readImageDimensions(head) : null;
}

/**
 * 第二步：浏览器说"传完了"，但不能只听它说——到存储里查一下原图和每个尺寸版本是否都在、大小类型是否与申请时一致，
 * 再从原图的文件头读出宽高。不一致就删掉文件和记录。重复确认直接返回。
 */
export async function confirmImage(db: Db, storage: ObjectStorage, id: number, now = new Date()): Promise<AdminImage | null> {
  const [row] = await db.select().from(images).where(eq(images.id, id));
  if (!row) return null;
  if (row.confirmedAt) return toAdminImage(storage, row);

  const object = await storage.head(row.key);
  if (!object) throw new HttpError(409, "conflict", "图片还没有上传完成");
  const variantsOk = await Promise.all(
    row.variants.map(async (width) => {
      const info = await storage.head(variantKey(row.key, width));
      return info !== null && info.contentType === row.contentType;
    }),
  );
  if (object.size !== row.size || object.contentType !== row.contentType || variantsOk.includes(false)) {
    await Promise.all(objectKeys(row).map((key) => storage.delete(key)));
    await db.delete(images).where(eq(images.id, id));
    throw new HttpError(400, "validation_error", "上传的文件与申请时声明的不一致，请重新上传");
  }

  const dimensions = await probeDimensions(storage, row.key);
  const [confirmed] = await db
    .update(images)
    .set({ confirmedAt: now, width: dimensions?.width ?? null, height: dimensions?.height ?? null })
    .where(eq(images.id, id))
    .returning();
  return confirmed ? toAdminImage(storage, confirmed) : null;
}

// ---------- 媒体库 ----------

const usageCount = sql<number>`(SELECT count(*)::int FROM ${postImages} WHERE ${postImages.imageId} = ${images.id})`;

export async function listImages(db: Db, storage: ObjectStorage, query: z.output<typeof imageListQuerySchema>): Promise<AdminImage[]> {
  const pattern = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await db
    .select({ image: images, usage: usageCount })
    .from(images)
    .where(
      and(
        isNotNull(images.confirmedAt),
        query.folder === "none" ? isNull(images.folderId) : query.folder === "all" ? undefined : eq(images.folderId, query.folder),
        pattern ? or(ilike(images.filename, pattern), ilike(images.description, pattern)) : undefined,
        query.unused ? sql`${usageCount} = 0` : undefined,
      ),
    )
    .orderBy(desc(images.createdAt), desc(images.id))
    .limit(LIST_LIMIT);
  return rows.map(({ image, usage }) => toAdminImage(storage, image, usage));
}

export async function getImageDetail(db: Db, storage: ObjectStorage, id: number): Promise<AdminImageDetail | null> {
  const [row] = await db.select().from(images).where(and(eq(images.id, id), isNotNull(images.confirmedAt)));
  if (!row) return null;
  const usedBy = await db
    .select({ id: posts.id, slug: posts.slug, title: posts.title, status: posts.status })
    .from(postImages)
    .innerJoin(posts, eq(posts.id, postImages.postId))
    .where(eq(postImages.imageId, id))
    .orderBy(desc(posts.updatedAt));
  return { ...toAdminImage(storage, row, usedBy.length), posts: usedBy };
}

export async function updateImage(
  db: Db,
  storage: ObjectStorage,
  id: number,
  input: z.output<typeof imageUpdateInputSchema>,
): Promise<AdminImage | null> {
  await assertFolder(db, input.folderId);
  const [row] = await db
    .update(images)
    .set(input)
    .where(and(eq(images.id, id), isNotNull(images.confirmedAt)))
    .returning();
  if (!row) return null;
  const [usage] = await db.select({ n: count() }).from(postImages).where(eq(postImages.imageId, id));
  return toAdminImage(storage, row, usage?.n ?? 0);
}

export async function moveImages(db: Db, ids: number[], folderId: number | null): Promise<number> {
  await assertFolder(db, folderId);
  const moved = await db.update(images).set({ folderId }).where(inArray(images.id, ids)).returning({ id: images.id });
  return moved.length;
}

/**
 * 批量删除（文件和记录）。仍被文章引用的，除非 force，否则整批都不删，返回 409 并列出受影响的文章——
 * 删掉之后这些文章里的图片会显示不出来，要让管理员明确确认。
 */
export async function deleteImages(db: Db, storage: ObjectStorage, ids: number[], force: boolean): Promise<number> {
  const rows = await db.select().from(images).where(inArray(images.id, ids));
  if (!force) {
    const used = await db
      .selectDistinct({ title: posts.title })
      .from(postImages)
      .innerJoin(posts, eq(posts.id, postImages.postId))
      .where(inArray(postImages.imageId, ids));
    if (used.length > 0) {
      throw new HttpError(409, "conflict", `仍被这些文章引用：${used.map((p) => `《${p.title}》`).join("、")}`);
    }
  }
  // 先删文件再删记录：中途失败时记录还在，可以重试；反过来会留下数据库不知道的孤儿文件
  for (const row of rows) await Promise.all(objectKeys(row).map((key) => storage.delete(key)));
  await db.delete(images).where(inArray(images.id, rows.map((r) => r.id)));
  return rows.length;
}

// ---------- 文件夹 ----------

export async function listFolders(db: Db): Promise<MediaFolder[]> {
  return db
    .select({ id: mediaFolders.id, name: mediaFolders.name, imageCount: sql<number>`count(${images.id})::int` })
    .from(mediaFolders)
    .leftJoin(images, and(eq(images.folderId, mediaFolders.id), isNotNull(images.confirmedAt)))
    .groupBy(mediaFolders.id)
    .orderBy(asc(mediaFolders.name));
}

export async function createFolder(db: Db, name: string): Promise<MediaFolder> {
  const [row] = await db.insert(mediaFolders).values({ name }).returning();
  if (!row) throw new Error("insert returned no row");
  return { id: row.id, name: row.name, imageCount: 0 };
}

export async function renameFolder(db: Db, id: number, name: string): Promise<boolean> {
  const updated = await db.update(mediaFolders).set({ name }).where(eq(mediaFolders.id, id)).returning({ id: mediaFolders.id });
  return updated.length > 0;
}

/** 删除文件夹；里面的图片回到"未归类"（外键 ON DELETE SET NULL），图片本身不删 */
export async function deleteFolder(db: Db, id: number): Promise<boolean> {
  const deleted = await db.delete(mediaFolders).where(eq(mediaFolders.id, id)).returning({ id: mediaFolders.id });
  return deleted.length > 0;
}

// ---------- 文章引用 ----------

/** 按正文重建这篇文章引用的图片（保存文章时在同一个事务里调用） */
export async function syncPostImages(db: Executor, postId: number, contentMd: string): Promise<void> {
  await db.delete(postImages).where(eq(postImages.postId, postId));
  const keys = imageKeysIn(contentMd);
  if (keys.length === 0) return;
  const found = await db
    .select({ id: images.id })
    .from(images)
    .where(and(inArray(images.key, keys), isNotNull(images.confirmedAt)));
  if (found.length > 0) await db.insert(postImages).values(found.map(({ id }) => ({ postId, imageId: id })));
}

/** 全部文章重建一遍（迁移后执行：新加这张表时补齐，以后识别规则变了也能一次修正）。返回处理的篇数 */
export async function rebuildAllPostImages(db: Db): Promise<number> {
  const rows = await db.select({ id: posts.id, contentMd: posts.contentMd }).from(posts);
  for (const row of rows) await syncPostImages(db, row.id, row.contentMd);
  return rows.length;
}

/** 文章引用的图片中尺寸已知的，按 key 索引（渲染时加宽高和 srcset） */
export async function imageMetaForPost(db: Executor, postId: number): Promise<Record<string, PostImageMeta>> {
  const rows = await db
    .select({ key: images.key, width: images.width, height: images.height, variants: images.variants })
    .from(postImages)
    .innerJoin(images, eq(images.id, postImages.imageId))
    .where(eq(postImages.postId, postId));
  const meta: Record<string, PostImageMeta> = {};
  for (const row of rows) {
    if (row.width && row.height) meta[row.key] = { width: row.width, height: row.height, variants: row.variants };
  }
  return meta;
}

// ---------- 定时任务 ----------

/** 清理申请后一直没确认的图片（先删存储里的文件，再删记录；中途失败下次重试）。返回清理的张数 */
export async function cleanupPendingImages(db: Db, storage: ObjectStorage, now = new Date()): Promise<number> {
  const stale = await db
    .select()
    .from(images)
    .where(and(isNull(images.confirmedAt), lt(images.createdAt, new Date(now.getTime() - PENDING_IMAGE_TTL_MS))))
    .orderBy(asc(images.createdAt))
    // 每次最多处理 100 张，单次调用不会超过函数时限；积压的第二天接着清
    .limit(100);
  for (const row of stale) {
    await Promise.all(objectKeys(row).map((key) => storage.delete(key)));
    await db.delete(images).where(eq(images.id, row.id));
  }
  return stale.length;
}

/** 补全尺寸未知的图片（加这个功能之前上传的）。每次最多 50 张，返回补全的张数 */
export async function backfillImageDimensions(db: Db, storage: ObjectStorage): Promise<number> {
  const missing = await db
    .select({ id: images.id, key: images.key })
    .from(images)
    .where(and(isNotNull(images.confirmedAt), isNull(images.width)))
    .limit(50);
  let filled = 0;
  for (const { id, key } of missing) {
    const dimensions = await probeDimensions(storage, key);
    if (!dimensions) continue;
    await db.update(images).set(dimensions).where(eq(images.id, id));
    filled++;
  }
  return filled;
}
