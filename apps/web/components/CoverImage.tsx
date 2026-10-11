import type { PostCover } from "@blog/shared";
import type { CSSProperties } from "react";
import { coverSrcSet, heroSizes, thumbnailSizes } from "@/lib/cover";
import prose from "./Prose.module.css";
import styles from "./CoverImage.module.css";

/**
 * 文章页顶部的头图。复用正文的 .prose 网格和图片规则：和正文里的"大"图一样出血到 864、手机上贴满屏幕、
 * 不放大、竖图高度不超过视口的 80%。是首屏最大的图（LCP），所以立即加载、提高优先级。
 */
export function CoverHero({ cover }: { cover: PostCover }) {
  const sized = cover.width !== null && cover.height !== null;
  const style = sized ? ({ "--image-max": `${cover.width}px`, "--image-ratio": `${cover.width} / ${cover.height}` } as CSSProperties) : undefined;
  return (
    <div className={`${prose.prose} ${styles.hero}`}>
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element -- 媒体库的图片已经有自己生成的尺寸版本，不经过 next/image */}
        <img
          src={cover.url}
          srcSet={coverSrcSet(cover)}
          sizes={coverSrcSet(cover) ? heroSizes : undefined}
          width={cover.width ?? undefined}
          height={cover.height ?? undefined}
          alt={cover.alt}
          data-sized={sized ? "" : undefined}
          style={style}
          fetchPriority="high"
        />
      </figure>
    </div>
  );
}

/** 列表卡片的缩略图：装饰性的（卡片的链接文字就是标题），alt 为空；懒加载 */
export function CoverThumbnail({ cover }: { cover: PostCover }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 同上
    <img
      className={styles.thumbnail}
      src={cover.url}
      srcSet={coverSrcSet(cover)}
      sizes={coverSrcSet(cover) ? thumbnailSizes : undefined}
      width={cover.width ?? undefined}
      height={cover.height ?? undefined}
      alt=""
      loading="lazy"
      decoding="async"
    />
  );
}
