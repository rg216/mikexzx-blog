import { type AdminImage, type ImageDisplaySize, variantUrl, withImageSize } from "@blog/shared";
import { imageMarkdown } from "./markdown-edit";

/** 缩略图用的地址：宽度够用的最小版本，没有就用原图（媒体库网格里几十张图，不该都下载原图） */
export function thumbnailUrl(image: Pick<AdminImage, "url" | "variants">, minWidth = 320): string {
  const width = [...image.variants].sort((a, b) => a - b).find((w) => w >= minWidth);
  return width ? variantUrl(image.url, width) : image.url;
}

const units = ["B", "KB", "MB"] as const;

/** 1536000 → "1.5 MB" */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** 插入正文的 Markdown：默认描述作为 alt，显示尺寸写在地址的 #片段里 */
export function markdownForImage(image: Pick<AdminImage, "url" | "description">, size: ImageDisplaySize | null): string {
  return imageMarkdown(withImageSize(image.url, size), image.description);
}
