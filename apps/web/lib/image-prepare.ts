import { IMAGE_VARIANT_WIDTHS, type ImageContentType, imageContentTypes, type ImageVariantWidth } from "@blog/shared";

/** 长边超过这个像素数就缩小：正文最宽 864px，2 倍屏也只需要约 1700px，留些余量给点开看大图 */
export const MAX_IMAGE_EDGE = 2560;
/** JPEG / WebP 的编码质量：0.86 肉眼几乎看不出差别，体积通常只有手机原图的几分之一 */
const QUALITY = 0.86;

export class ImagePrepareError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ImagePrepareError";
  }
}

export function isAllowedImageType(type: string): type is ImageContentType {
  return (imageContentTypes as readonly string[]).includes(type);
}

/** 等比缩放到长边不超过 max；本来就不大的保持原尺寸 */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * 是否在浏览器里重新编码。GIF 不处理（画布只能画出第一帧，动图会变静态）；
 * AVIF 不处理（多数浏览器的画布不能编码 AVIF，而它本身已经很小）。
 */
export function shouldReencode(type: ImageContentType): boolean {
  return type === "image/jpeg" || type === "image/png" || type === "image/webp";
}

export type PreparedImage = {
  blob: Blob;
  contentType: ImageContentType;
  /** 较小的尺寸版本（只生成比原图窄的），渲染时组成 srcset，手机不用下载大图 */
  variants: { width: ImageVariantWidth; blob: Blob }[];
};

/** 原图宽度为 width 时要生成哪些尺寸版本 */
export function variantWidthsFor(width: number): ImageVariantWidth[] {
  return IMAGE_VARIANT_WIDTHS.filter((w) => w < width);
}

async function encode(bitmap: ImageBitmap, width: number, height: number, type: ImageContentType): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new ImagePrepareError("浏览器不支持图片处理");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type, quality: QUALITY });
}

/**
 * 上传前在浏览器里处理图片：缩小过大的图，并通过重新编码去掉全部元数据，顺便生成几个较小的尺寸版本。
 * 手机照片的 EXIF 里常有拍摄地点的 GPS 坐标，原样发到公开博客等于公开了位置——这是重新编码的主要目的，缩小体积是附带的好处。
 * createImageBitmap 的 imageOrientation: "from-image" 会先按 EXIF 方向旋转，去掉 EXIF 后图片不会倒过来。
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (!isAllowedImageType(file.type)) throw new ImagePrepareError("只支持 JPEG、PNG、WebP、AVIF、GIF 图片");
  if (!shouldReencode(file.type)) return { blob: file, contentType: file.type, variants: [] };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (error) {
    throw new ImagePrepareError("无法读取这张图片，文件可能已损坏", { cause: error });
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const blob = await encode(bitmap, width, height, file.type);
    // 浏览器不支持编码成这种格式时会退回 PNG（比如部分 Safari 不能编码 WebP），以实际结果为准
    const contentType = blob.type;
    if (!isAllowedImageType(contentType)) throw new ImagePrepareError("浏览器无法编码这种图片格式");
    // 各版本都从原始位图缩放（而不是从上一个版本再缩），画质最好
    const variants = await Promise.all(
      variantWidthsFor(width).map(async (w) => ({ width: w, blob: await encode(bitmap, w, Math.max(1, Math.round((height * w) / width)), contentType) })),
    );
    return { blob, contentType, variants };
  } finally {
    bitmap.close();
  }
}
