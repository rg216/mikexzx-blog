"use client";

import type { AdminImage, AdminImageDetail, MediaFolder } from "@blog/shared";
import { Copy, ExternalLink } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { adminApi, AdminApiError } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/admin-format";
import { formatBytes, markdownForImage, thumbnailUrl } from "@/lib/media";
import styles from "./MediaLibrary.module.css";

type Props = {
  imageId: number | null;
  folders: MediaFolder[];
  onClose: () => void;
  onChanged: (image: AdminImage) => void;
  onDeleted: (id: number) => void;
};

const messageOf = (error: unknown) => (error instanceof AdminApiError ? error.message : "出现了意外错误，请稍后重试");

/** 图片详情：预览、信息、改名和默认描述、换文件夹、复制地址 / Markdown、被哪些文章引用、删除 */
export function ImageDetailDialog({ imageId, folders, onClose, onChanged, onDeleted }: Props) {
  const [image, setImage] = useState<AdminImageDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  useEffect(() => {
    if (imageId === null) return;
    let ignore = false;
    adminApi.getImage(imageId).then(
      (detail) => {
        if (ignore) return;
        setImage(detail);
        setFilename(detail.filename);
        setDescription(detail.description);
        setLoadError(null);
      },
      (error: unknown) => !ignore && setLoadError(messageOf(error)),
    );
    return () => {
      ignore = true;
      setImage(null);
      setSaveError(null);
      setCopied(null);
    };
  }, [imageId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!image || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await adminApi.updateImage(image.id, { filename, description });
      setImage({ ...image, ...updated });
      onChanged(updated);
    } catch (error) {
      setSaveError(messageOf(error));
    } finally {
      setSaving(false);
    }
  }

  async function move(folderId: number | null) {
    if (!image) return;
    try {
      const updated = await adminApi.updateImage(image.id, { folderId });
      setImage({ ...image, ...updated });
      onChanged(updated);
    } catch (error) {
      setSaveError(messageOf(error));
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`已复制${what}`);
    } catch {
      setCopied("复制失败，请手动选择复制");
    }
  }

  async function remove() {
    if (!image) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      // 确认框里已经列出了引用它的文章，这里直接 force
      await adminApi.deleteImages([image.id], true);
      setConfirmDelete(false);
      onDeleted(image.id);
    } catch (error) {
      setDeleteError(messageOf(error));
    } finally {
      setDeleting(false);
    }
  }

  const dirty = image !== null && (filename !== image.filename || description !== image.description);

  return (
    <Dialog open={imageId !== null} title="图片详情" size="wide" onClose={onClose}>
      {loadError && <Banner title="加载失败">{loadError}</Banner>}
      {!image && !loadError && (
        <p className={styles.placeholder}>
          <Spinner />
          正在加载…
        </p>
      )}
      {image && (
        <div className={styles.detail}>
          <a className={styles.preview} href={image.url} target="_blank" rel="noopener">
            {/* eslint-disable-next-line @next/next/no-img-element -- 预览用较小的尺寸版本 */}
            <img src={thumbnailUrl(image, 1000)} alt={image.description} />
            <span className="visually-hidden">（在新标签页打开原图）</span>
          </a>

          <div className={styles.info}>
            <dl className={styles.facts}>
              <dt>尺寸</dt>
              <dd>{image.width && image.height ? `${image.width} × ${image.height}` : "未知"}</dd>
              <dt>大小</dt>
              <dd>{formatBytes(image.size)}</dd>
              <dt>上传于</dt>
              <dd>
                <time dateTime={image.createdAt}>{formatDateTime(image.createdAt)}</time>
              </dd>
            </dl>

            <div className={styles.copyRow}>
              <Button variant="secondary" onClick={() => void copy(image.url, "地址")}>
                <Copy aria-hidden="true" />
                复制地址
              </Button>
              <Button variant="secondary" onClick={() => void copy(markdownForImage(image, null), " Markdown")}>
                <Copy aria-hidden="true" />
                复制 Markdown
              </Button>
            </div>
            <p role="status" className={styles.hint}>
              {copied}
            </p>

            <form className={styles.form} onSubmit={(event) => void save(event)}>
              <TextField label="文件名" value={filename} onChange={(event) => setFilename(event.target.value)} maxLength={200} />
              <TextField
                label="默认描述"
                hint="插入文章时作为图片描述（alt），读屏软件会读出它；每篇文章里还可以单独修改。"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
              />
              {saveError && <Banner title="保存失败">{saveError}</Banner>}
              <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>
                保存
              </Button>
            </form>

            <label className={styles.selectField}>
              <span>文件夹</span>
              <select value={image.folderId ?? ""} onChange={(event) => void move(event.target.value ? Number(event.target.value) : null)}>
                <option value="">未归类</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>

            <section>
              <h3 className={styles.subheading}>被引用</h3>
              {image.posts.length === 0 ? (
                <p className={styles.hint}>没有文章引用这张图片。</p>
              ) : (
                <ul className={styles.usedBy}>
                  {image.posts.map((post) => (
                    <li key={post.id}>
                      <a href={`/admin/posts/${post.id}`} target="_blank" rel="noopener">
                        {post.title}
                        <ExternalLink className={styles.inlineIcon} aria-hidden="true" />
                        <span className="visually-hidden">（在新标签页编辑）</span>
                      </a>
                      {post.status === "draft" && <span className={styles.hint}>草稿</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Button variant="plainDestructive" className={styles.deleteButton} onClick={() => setConfirmDelete(true)}>
              删除图片
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="删除这张图片？"
        confirmLabel="删除"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      >
        {image && image.posts.length > 0
          ? `以下文章里的这张图会显示不出来：${image.posts.map((p) => `《${p.title}》`).join("、")}。删除后无法恢复。`
          : "文件会从存储里删除，无法恢复。"}
      </ConfirmDialog>
    </Dialog>
  );
}
