"use client";

import type { AdminImage } from "@blog/shared";
import { Check } from "lucide-react";
import { formatBytes, thumbnailUrl } from "@/lib/media";
import styles from "./MediaGrid.module.css";

type Props = {
  images: AdminImage[];
  /**
   * manage：点图片打开详情，左上角的复选框用于多选（批量移动、删除）；
   * pick：点图片即选中（单选），用于编辑器的媒体选择器
   */
  mode: "manage" | "pick";
  selected: ReadonlySet<number>;
  onToggle: (image: AdminImage) => void;
  onOpen?: (image: AdminImage) => void;
};

function label(image: AdminImage): string {
  return image.filename || image.description || `图片 ${image.id}`;
}

/** 媒体库的缩略图网格。缩略图用最小的够用尺寸版本，一屏几十张也不必下载原图 */
export function MediaGrid({ images, mode, selected, onToggle, onOpen }: Props) {
  return (
    <ul className={styles.grid}>
      {images.map((image) => {
        const isSelected = selected.has(image.id);
        const name = label(image);
        return (
          <li key={image.id} className={styles.cell}>
            <button
              type="button"
              className={styles.card}
              data-selected={isSelected || undefined}
              aria-pressed={mode === "pick" ? isSelected : undefined}
              onClick={() => (mode === "pick" ? onToggle(image) : onOpen?.(image))}
            >
              <span className={styles.thumb}>
                {/* eslint-disable-next-line @next/next/no-img-element -- 缩略图已是缩小过的版本，不需要再经 next/image 处理 */}
                <img src={thumbnailUrl(image)} alt="" loading="lazy" decoding="async" />
              </span>
              <span className={styles.name}>{name}</span>
              <span className={styles.meta}>
                {image.width && image.height ? `${image.width}×${image.height} · ` : ""}
                {formatBytes(image.size)}
                {image.usage === 0 ? " · 未被引用" : ` · ${image.usage} 篇文章`}
              </span>
            </button>
            {mode === "manage" && (
              <label className={styles.check}>
                <input type="checkbox" checked={isSelected} onChange={() => onToggle(image)} />
                <span className={styles.checkbox} aria-hidden="true">
                  <Check />
                </span>
                <span className="visually-hidden">选择 {name}</span>
              </label>
            )}
          </li>
        );
      })}
    </ul>
  );
}
