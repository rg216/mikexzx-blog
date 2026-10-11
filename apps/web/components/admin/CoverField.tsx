"use client";

import type { PostCover } from "@blog/shared";
import { CircleAlert, ImageIcon, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { coverFromImage } from "@/lib/post-form";
import { thumbnailUrl } from "@/lib/media";
import styles from "./CoverField.module.css";
import { MediaPicker } from "./media/MediaPicker";

type Props = {
  cover: PostCover | null;
  onChange: (cover: PostCover | null) => void;
  error?: string;
};

/**
 * 头图（可选）：从媒体库里选一张，显示在文章页顶部、列表卡片上，也用作分享卡片。
 * 描述（alt）用媒体库里的，要改就去媒体库改——所有用到这张图的地方一起变。
 */
export function CoverField({ cover, onChange, error }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const errorId = useId();

  return (
    <fieldset className={styles.fieldset} aria-describedby={error ? errorId : undefined}>
      <legend className={styles.legend}>头图</legend>
      <div className={styles.row}>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- 后台预览，直接用媒体库的缩略图版本
          <img className={styles.preview} src={thumbnailUrl({ url: cover.url, variants: cover.variants })} alt="" />
        ) : (
          <div className={styles.placeholder}>
            <ImageIcon aria-hidden="true" />
          </div>
        )}
        <div className={styles.side}>
          <p className={styles.hint}>
            {cover
              ? cover.alt
                ? `描述：${cover.alt}`
                : "这张图还没有描述，读屏软件读不到它的内容（在媒体库里补上）"
              : "可选。显示在文章顶部和列表里，也用作分享到社交网站时的配图。"}
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setPickerOpen(true)}>
              {cover ? "更换" : "选择头图"}
            </Button>
            {cover && (
              <Button variant="plain" onClick={() => onChange(null)}>
                <X aria-hidden="true" />
                移除
              </Button>
            )}
          </div>
        </div>
      </div>
      {error && (
        <p id={errorId} className={styles.error}>
          <CircleAlert className={styles.errorIcon} aria-hidden="true" />
          {error}
        </p>
      )}
      <MediaPicker open={pickerOpen} title="选择头图" onClose={() => setPickerOpen(false)} onPick={(image) => onChange(coverFromImage(image))} />
    </fieldset>
  );
}
