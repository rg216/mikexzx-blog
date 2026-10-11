"use client";

import { ImagePlus } from "lucide-react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import styles from "./MarkdownImageTools.module.css";
import type { MarkdownImages } from "./useMarkdownImages";

/** 正文框下面的"插入图片"按钮、上传状态和上传失败提示（状态来自 useMarkdownImages） */
export function MarkdownImageTools({ images }: { images: MarkdownImages }) {
  return (
    <>
      <div className={styles.tools}>
        <Button variant="plain" onClick={images.openPicker}>
          <ImagePlus className={styles.icon} aria-hidden="true" />
          插入图片
        </Button>
        <p role="status" className={styles.status}>
          {images.uploading > 0 ? `正在上传 ${images.uploading} 张图片…` : "也可以直接粘贴或拖入图片"}
        </p>
      </div>
      {images.uploadError && (
        <Banner title="图片上传失败" className={styles.banner}>
          {images.uploadError}
        </Banner>
      )}
    </>
  );
}
