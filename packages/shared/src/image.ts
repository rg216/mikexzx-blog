import { z } from "zod";

/**
 * 允许上传的图片类型。不收 SVG：它可以内嵌脚本，直接打开图片地址时脚本会在存储域名下运行。
 */
export const imageContentTypes = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"] as const;
export const imageContentTypeSchema = z.enum(imageContentTypes, "只支持 JPEG、PNG、WebP、AVIF、GIF 图片");
export type ImageContentType = z.infer<typeof imageContentTypeSchema>;

/** 单张图片上限（浏览器缩放之后的大小） */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 申请上传：告诉 API 要传什么，API 据此签发只能上传这个类型、这个大小的 URL */
export const imageUploadRequestSchema = z.strictObject({
  contentType: imageContentTypeSchema,
  size: z.int().positive().max(MAX_IMAGE_BYTES, "图片不能超过 10MB"),
});
export type ImageUploadRequest = z.infer<typeof imageUploadRequestSchema>;

export const adminImageSchema = z.object({
  id: z.int().positive(),
  /** 公开访问地址，写进 Markdown 的就是它 */
  url: z.url(),
  contentType: imageContentTypeSchema,
  size: z.int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type AdminImage = z.infer<typeof adminImageSchema>;

/**
 * 上传凭证：浏览器用 upload.method 把文件发到 upload.url，并原样带上 upload.headers（它们参与了签名）。
 * 上传成功后调用确认接口，图片才算可用。
 */
export const imageUploadSchema = z.object({
  image: adminImageSchema,
  upload: z.object({
    url: z.url(),
    method: z.literal("PUT"),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime({ offset: true }),
  }),
});
export type ImageUpload = z.infer<typeof imageUploadSchema>;
