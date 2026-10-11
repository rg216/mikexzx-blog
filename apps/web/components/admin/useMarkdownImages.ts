"use client";

import { type ClipboardEvent, type DragEvent, type RefObject, useRef, useState } from "react";
import { uploadImage } from "@/lib/image-upload";
import { imageMarkdown, insertBlock, replacePlaceholder, uploadPlaceholder } from "@/lib/markdown-edit";

type Options = {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 当前正文（插入位置按它和光标计算） */
  value: string;
  /** 同步插入（占位符、媒体库图片）：相当于用户的一次编辑 */
  onChange: (value: string) => void;
  /** 上传完成后的异步替换：基于最新正文修改——上传期间作者可能继续打字，不能用发起上传时的旧正文 */
  onUpdate: (update: (value: string) => string) => void;
  /** 插入前调用：比如窄屏处在预览视图时切回编辑，插入后才能把光标放到正文框里 */
  onBeforeInsert?: () => void;
};

/** 粘贴板、拖放里的图片文件（其他文件忽略，交给浏览器默认处理） */
function imageFiles(list: FileList | null): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
}

/**
 * 正文框插入图片：粘贴 / 拖入直接上传，"插入图片"打开媒体选择器。
 * 文章编辑器和译文编辑器共用（译文里也可能插原文没有的图，比如换成带英文标注的截图）。
 *
 * 做成 hook 而不是组件：保存按钮要同步知道"还有没有图片在上传"（isUploading），
 * 媒体选择器（<dialog>）也要渲染在 <form> 外面，这两件事都由调用方决定位置。
 */
export function useMarkdownImages({ textareaRef, value, onChange, onUpdate, onBeforeInsert }: Options) {
  /** 正在上传的图片数；ref 是给保存同步判断用的（state 要等下一次渲染才更新） */
  const [uploading, setUploading] = useState(0);
  const uploadingRef = useRef(0);
  const uploadSeq = useRef(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  /** 在光标处插入一段（前后补空行，单独成段的图片渲染成 figure），然后把光标放到插入内容后面 */
  function insertAtCursor(block: string) {
    const textarea = textareaRef.current;
    const { value: next, cursor } = insertBlock(value, textarea?.selectionStart ?? value.length, textarea?.selectionEnd ?? value.length, block);
    onChange(next);
    onBeforeInsert?.();
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    });
  }

  /**
   * 先在光标处为每张图插入占位符，再逐张上传，完成一张替换一张。
   * 逐张而不是并发：顺序和选择的顺序一致，也不会同时占满带宽。
   */
  async function insertFiles(files: File[]) {
    if (files.length === 0) return;
    setUploadError(null);
    const placeholders = files.map((file) => uploadPlaceholder(String(++uploadSeq.current), file.name));
    insertAtCursor(placeholders.join("\n\n"));

    uploadingRef.current += files.length;
    setUploading(uploadingRef.current);
    for (const [i, file] of files.entries()) {
      const placeholder = placeholders[i] ?? "";
      try {
        const image = await uploadImage(file);
        onUpdate((content) => replacePlaceholder(content, placeholder, imageMarkdown(image.url)));
      } catch (error) {
        onUpdate((content) => replacePlaceholder(content, placeholder, ""));
        setUploadError(`${file.name || "图片"}：${error instanceof Error ? error.message : "上传失败"}`);
      } finally {
        uploadingRef.current -= 1;
        setUploading(uploadingRef.current);
      }
    }
  }

  return {
    uploading,
    uploadError,
    /** 同步判断：上传中的图片在正文里还是占位符，这时保存会把占位符存进去 */
    isUploading: () => uploadingRef.current > 0,
    pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
    /** 媒体选择器选好后插入 */
    insertMarkdown: insertAtCursor,
    /** 展开到正文 textarea 上 */
    textareaHandlers: {
      onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
        const files = imageFiles(event.clipboardData.files);
        if (files.length === 0) return;
        event.preventDefault();
        void insertFiles(files);
      },
      onDragOver(event: DragEvent<HTMLTextAreaElement>) {
        // 拖着文件经过时允许放下（默认行为是浏览器打开这个文件）
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      },
      onDrop(event: DragEvent<HTMLTextAreaElement>) {
        const files = imageFiles(event.dataTransfer.files);
        if (files.length === 0) return;
        event.preventDefault();
        void insertFiles(files);
      },
    },
  };
}

export type MarkdownImages = ReturnType<typeof useMarkdownImages>;
