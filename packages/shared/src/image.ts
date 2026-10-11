import { z } from "zod";
import { IMAGE_VARIANT_WIDTHS } from "./media.ts";

/**
 * 允许上传的图片类型。不收 SVG：它可以内嵌脚本，直接打开图片地址时脚本会在存储域名下运行。
 */
export const imageContentTypes = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"] as const;
export const imageContentTypeSchema = z.enum(imageContentTypes, "只支持 JPEG、PNG、WebP、AVIF、GIF 图片");
export type ImageContentType = z.infer<typeof imageContentTypeSchema>;

/** 单张图片上限（浏览器缩放之后的大小） */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const isoDateTime = z.iso.datetime({ offset: true });
const fileSize = z.int().positive().max(MAX_IMAGE_BYTES, "图片不能超过 10MB");
const id = z.int().positive();

/**
 * 申请上传：告诉 API 要传什么，API 据此为原图和每个尺寸版本各签发一个只能上传这个类型、这个大小的 URL。
 * 宽高不在这里：确认时由 API 从文件头里读。
 */
export const imageUploadRequestSchema = z.strictObject({
  contentType: imageContentTypeSchema,
  size: fileSize,
  filename: z.string().trim().max(200).default(""),
  /** 浏览器额外生成的较小版本（宽度只能取 IMAGE_VARIANT_WIDTHS 里的值，每种最多一个） */
  variants: z
    .array(z.strictObject({ width: z.union(IMAGE_VARIANT_WIDTHS.map((w) => z.literal(w))), size: fileSize }))
    .max(IMAGE_VARIANT_WIDTHS.length)
    .refine((list) => new Set(list.map((v) => v.width)).size === list.length, "尺寸版本不能重复")
    .default([]),
  folderId: id.nullable().default(null),
});
export type ImageUploadRequest = z.input<typeof imageUploadRequestSchema>;

export const adminImageSchema = z.object({
  id,
  /** 原图的公开地址，写进 Markdown 的就是它 */
  url: z.url(),
  contentType: imageContentTypeSchema,
  size: z.int().positive(),
  filename: z.string(),
  /** 由 API 从文件读出；未知为 null */
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  /** 已生成的尺寸版本（宽度） */
  variants: z.array(z.int().positive()),
  folderId: id.nullable(),
  /** 插入文章时默认带上的描述 */
  description: z.string(),
  /** 引用它的文章数 */
  usage: z.int().nonnegative(),
  createdAt: isoDateTime,
});
export type AdminImage = z.infer<typeof adminImageSchema>;

export const adminImageDetailSchema = adminImageSchema.extend({
  posts: z.array(z.object({ id, slug: z.string(), title: z.string(), status: z.enum(["draft", "published"]) })),
});
export type AdminImageDetail = z.infer<typeof adminImageDetailSchema>;

const presignedPut = z.object({ url: z.url(), method: z.literal("PUT"), headers: z.record(z.string(), z.string()) });

/**
 * 上传凭证：浏览器把原图和各尺寸版本分别 PUT 到对应的 URL，并原样带上 headers（它们参与了签名）。
 * 全部上传成功后调用确认接口，图片才算可用。
 */
export const imageUploadSchema = z.object({
  image: adminImageSchema,
  upload: presignedPut,
  variants: z.array(presignedPut.extend({ width: z.int().positive() })),
  expiresAt: isoDateTime,
});
export type ImageUpload = z.infer<typeof imageUploadSchema>;

export const imageListQuerySchema = z.object({
  /** all：全部；none：未归入文件夹的；数字：某个文件夹 */
  folder: z.union([z.literal("all"), z.literal("none"), z.coerce.number().int().positive()]).default("all"),
  q: z.string().trim().max(100).optional(),
  /** 只看没有被任何文章引用的 */
  unused: z.literal("1").optional(),
});
export type ImageListQuery = z.input<typeof imageListQuerySchema>;

export const imageUpdateInputSchema = z
  .strictObject({
    filename: z.string().trim().max(200),
    description: z.string().trim().max(500),
    folderId: id.nullable(),
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, "至少需要更新一个字段");
export type ImageUpdateInput = z.input<typeof imageUpdateInputSchema>;

const imageIds = z.array(id).min(1).max(200);

/** 批量删除。仍被文章引用的图片需要 force: true，否则返回 409 和受影响的文章 */
export const imageDeleteInputSchema = z.strictObject({ ids: imageIds, force: z.boolean().default(false) });
export const imageMoveInputSchema = z.strictObject({ ids: imageIds, folderId: id.nullable() });

export const mediaFolderSchema = z.object({ id, name: z.string(), imageCount: z.int().nonnegative() });
export type MediaFolder = z.infer<typeof mediaFolderSchema>;
export const mediaFolderInputSchema = z.strictObject({ name: z.string().trim().min(1, "文件夹名不能为空").max(50) });

/** 渲染文章时需要的图片信息（按原图 key 索引）：宽高用于 <img width height>，variants 用于 srcset */
export const postImageMetaSchema = z.object({
  width: z.int().positive(),
  height: z.int().positive(),
  variants: z.array(z.int().positive()),
});
export type PostImageMeta = z.infer<typeof postImageMetaSchema>;
