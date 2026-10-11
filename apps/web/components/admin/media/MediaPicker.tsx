"use client";

import {
  type AdminImage,
  IMAGE_CUSTOM_WIDTH_MAX,
  IMAGE_CUSTOM_WIDTH_MIN,
  type ImageDisplaySize,
  imageContentTypes,
  type MediaFolder,
} from "@blog/shared";
import { ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { adminApi } from "@/lib/admin-api";
import { uploadImage } from "@/lib/image-upload";
import { markdownForImage } from "@/lib/media";
import { MediaGrid } from "./MediaGrid";
import styles from "./MediaPicker.module.css";

type SizeChoice = "small" | "medium" | "large" | "custom";

const sizeOptions = [
  { value: "small", label: "小" },
  { value: "medium", label: "中" },
  { value: "large", label: "大" },
  { value: "custom", label: "自定义" },
] as const;

const sizeHints: Record<SizeChoice, string> = {
  small: "约半栏宽，居中",
  medium: "和正文一样宽",
  large: "比正文宽，手机上贴满屏幕（默认）",
  custom: "按指定宽度显示",
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** 选好后插入正文的 Markdown */
  onInsert: (markdown: string) => void;
};

/** 显示尺寸的选择 → 写进地址的片段；"大"是单独成段图片的默认效果，不写片段 */
export function displaySizeOf(choice: SizeChoice, customWidth: number): ImageDisplaySize | null {
  if (choice === "large") return null;
  if (choice === "custom") return { width: customWidth };
  return { preset: choice };
}

/**
 * 编辑器的媒体选择器：从媒体库里挑一张图（也可以当场上传），选显示尺寸、改这一次使用的描述，插入正文。
 * 粘贴、拖入图片仍然直接上传并插入，不经过这里——那是最快的路径。
 */
export function MediaPicker({ open, onClose, onInsert }: Props) {
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [folder, setFolder] = useState<"all" | "none" | number>("all");
  const [query, setQuery] = useState("");
  const [images, setImages] = useState<AdminImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<AdminImage | null>(null);
  const [size, setSize] = useState<SizeChoice>("large");
  const [customWidth, setCustomWidth] = useState("480");
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    adminApi.listFolders().then(
      (list) => !ignore && setFolders(list),
      () => {},
    );
    return () => {
      ignore = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    const timer = setTimeout(() => {
      const q = query.trim();
      adminApi.listImages({ folder, ...(q && { q }) }).then(
        (list) => {
          if (ignore) return;
          setImages(list);
          setError(null);
        },
        (err: unknown) => !ignore && setError(err instanceof Error ? err.message : "图片加载失败"),
      );
    }, 250);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [open, folder, query, reloadKey]);

  function pick(image: AdminImage) {
    setPicked((current) => (current?.id === image.id ? null : image));
    setAlt(image.description);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const image = await uploadImage(file, { folderId: typeof folder === "number" ? folder : null });
      setPicked(image);
      setAlt(image.description);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  const width = Number(customWidth);
  const widthValid = Number.isInteger(width) && width >= IMAGE_CUSTOM_WIDTH_MIN && width <= IMAGE_CUSTOM_WIDTH_MAX;
  const canInsert = picked !== null && (size !== "custom" || widthValid);

  function insert() {
    if (!picked || !canInsert) return;
    onInsert(markdownForImage({ url: picked.url, description: alt }, displaySizeOf(size, width)));
    setPicked(null);
    onClose();
  }

  return (
    <Dialog
      open={open}
      title="插入图片"
      size="wide"
      onClose={onClose}
      footer={
        <div className={styles.footer}>
          <div className={styles.options}>
            <div className={styles.sizeRow}>
              <SegmentedControl label="显示尺寸" options={sizeOptions} value={size} onChange={setSize} />
              {size === "custom" && (
                <TextField
                  className={styles.widthField}
                  label="宽度（px）"
                  hideLabel
                  type="number"
                  inputMode="numeric"
                  min={IMAGE_CUSTOM_WIDTH_MIN}
                  max={IMAGE_CUSTOM_WIDTH_MAX}
                  value={customWidth}
                  onChange={(event) => setCustomWidth(event.target.value)}
                  error={widthValid ? undefined : `${IMAGE_CUSTOM_WIDTH_MIN}–${IMAGE_CUSTOM_WIDTH_MAX}`}
                />
              )}
              <span className={styles.hint}>{sizeHints[size]}；不会放大到超过原图</span>
            </div>
            <TextField
              label="图片描述"
              hint="读屏软件会读出它；默认来自媒体库，只改这一次使用"
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
              disabled={!picked}
              maxLength={500}
            />
          </div>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button variant="primary" disabled={!canInsert} onClick={insert}>
              插入
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.toolbar}>
        <label className={styles.selectField}>
          <span className="visually-hidden">文件夹</span>
          <select
            value={String(folder)}
            onChange={(event) => {
              const value = event.target.value;
              setFolder(value === "all" || value === "none" ? value : Number(value));
            }}
          >
            <option value="all">全部图片</option>
            <option value="none">未归类</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <TextField
          className={styles.search}
          type="search"
          label="搜索图片"
          hideLabel
          placeholder="按文件名或描述搜索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button variant="secondary" busy={uploading} onClick={() => fileInputRef.current?.click()}>
          <ImagePlus aria-hidden="true" />
          上传
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={imageContentTypes.join(",")}
          hidden
          onChange={(event) => {
            void upload(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </div>

      {error && <Banner title="出错了">{error}</Banner>}
      {!images && !error && (
        <p className={styles.placeholder}>
          <Spinner />
          正在加载…
        </p>
      )}
      {images && images.length === 0 && <p className={styles.placeholder}>没有图片。点「上传」添加一张。</p>}
      {images && images.length > 0 && (
        <MediaGrid images={images} mode="pick" selected={new Set(picked ? [picked.id] : [])} onToggle={pick} />
      )}
    </Dialog>
  );
}
