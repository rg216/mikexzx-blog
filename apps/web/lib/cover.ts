import { type PostCover, variantUrl } from "@blog/shared";
import { sizesFor } from "./rehype-images";

/*
 * 头图（v4.6）的地址计算：srcset、分享卡片用哪个版本。纯函数，单元测试直接跑。
 * 宽度未知（旧图片还没补全宽高）时不给 srcset：浏览器按原图显示。
 */

/** 原图和各尺寸版本组成的 srcset；没有版本或宽度未知时 undefined */
export function coverSrcSet(cover: PostCover): string | undefined {
  if (cover.width === null || cover.variants.length === 0) return undefined;
  return [...cover.variants.map((w) => `${variantUrl(cover.url, w)} ${w}w`), `${cover.url} ${cover.width}w`].join(", ");
}

/** 文章页顶部的头图按"大"图显示（出血 864，手机贴边），sizes 和正文里的大图一致 */
export const heroSizes = sizesFor(null, true);

/** 列表卡片的缩略图：手机 88px、宽屏 160px（与 PostListItem.module.css 一致） */
export const thumbnailSizes = "(min-width: 70rem) 160px, 88px";

/** 分享卡片（og:image）的推荐宽度：1200 左右，太大的原图浪费社交平台的流量，也可能超过它们的大小限制 */
const OG_TARGET_WIDTH = 1200;

/**
 * 分享卡片用的图片：不小于 1200 的最小版本，没有就用原图。宽高已知时一并给出（按比例换算版本的高度）。
 */
export function ogImageOf(cover: PostCover): { url: string; width?: number; height?: number; alt: string } {
  const alt = cover.alt;
  if (cover.width === null || cover.height === null) return { url: cover.url, alt };
  const { width, height } = cover;
  const candidate = [...cover.variants].sort((a, b) => a - b).find((w) => w >= OG_TARGET_WIDTH && w < width);
  if (candidate === undefined) return { url: cover.url, width, height, alt };
  return { url: variantUrl(cover.url, candidate), width: candidate, height: Math.round((height * candidate) / width), alt };
}
