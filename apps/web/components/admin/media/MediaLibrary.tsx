"use client";

import { type AdminImage, imageContentTypes, type MediaFolder } from "@blog/shared";
import { FolderPlus, ImagePlus, Images, Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { adminApi, AdminApiError } from "@/lib/admin-api";
import { uploadImage } from "@/lib/image-upload";
import { ImageDetailDialog } from "./ImageDetailDialog";
import { MediaGrid } from "./MediaGrid";
import styles from "./MediaLibrary.module.css";

type Folder = "all" | "none" | number;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : "出现了意外错误，请稍后重试");

/** 搜索框防抖：停止输入 300ms 后再查 */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * 媒体库：全站图片集中管理。图片可以被多篇文章重复引用，所以不属于任何一篇文章；
 * "被哪些文章引用"由 API 从正文推导（保存文章时重建），这里只负责展示和据此提醒。
 */
export function MediaLibrary() {
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [folder, setFolder] = useState<Folder>("all");
  const [query, setQuery] = useState("");
  const [unused, setUnused] = useState(false);
  const q = useDebounced(query.trim());
  const [images, setImages] = useState<AdminImage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openId, setOpenId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  const [folderDialog, setFolderDialog] = useState<{ mode: "create" } | { mode: "rename"; folder: MediaFolder } | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState<string>();
  const [deletingFolder, setDeletingFolder] = useState<MediaFolder | null>(null);

  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    let ignore = false;
    adminApi.listFolders().then(
      (list) => !ignore && setFolders(list),
      () => {
        // 文件夹列表加载失败不影响看图片
      },
    );
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let ignore = false;
    adminApi.listImages({ folder, ...(q && { q }), ...(unused && { unused: "1" as const }) }).then(
      (list) => {
        if (ignore) return;
        setImages(list);
        setLoadError(null);
        // 换了筛选条件，已经看不到的图片不应该还处于选中状态
        setSelected((prev) => new Set([...prev].filter((id) => list.some((image) => image.id === id))));
      },
      (error: unknown) => !ignore && setLoadError(messageOf(error)),
    );
    return () => {
      ignore = true;
    };
  }, [folder, q, unused, reloadKey]);

  function toggle(image: AdminImage) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(image.id)) next.delete(image.id);
      else next.add(image.id);
      return next;
    });
  }

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setActionError(null);
    setUploading((n) => n + files.length);
    const failures: string[] = [];
    // 逐张上传：顺序和选择的顺序一致，也不会同时占满带宽
    for (const file of files) {
      try {
        await uploadImage(file, { folderId: typeof folder === "number" ? folder : null });
      } catch (error) {
        failures.push(`${file.name}：${messageOf(error)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (failures.length > 0) setActionError(failures.join("\n"));
    setNotice(`上传完成：${files.length - failures.length} 张成功${failures.length ? `，${failures.length} 张失败` : ""}`);
    reload();
  }

  async function moveSelected(target: number | null) {
    setActionError(null);
    try {
      await adminApi.moveImages([...selected], target);
      setNotice(`已移动 ${selected.size} 张图片`);
      setSelected(new Set());
      reload();
    } catch (error) {
      setActionError(messageOf(error));
    }
  }

  async function deleteSelected() {
    setDeleting(true);
    setDeleteError(undefined);
    try {
      // 确认框里已经说明了引用情况，这里直接 force
      const count = await adminApi.deleteImages([...selected], true);
      setNotice(`已删除 ${count} 张图片`);
      setSelected(new Set());
      setConfirmDelete(false);
      reload();
    } catch (error) {
      setDeleteError(messageOf(error));
    } finally {
      setDeleting(false);
    }
  }

  async function saveFolder(event: FormEvent) {
    event.preventDefault();
    if (!folderDialog) return;
    setFolderError(undefined);
    try {
      if (folderDialog.mode === "create") {
        const created = await adminApi.createFolder(folderName);
        setFolder(created.id);
      } else {
        await adminApi.renameFolder(folderDialog.folder.id, folderName);
      }
      setFolderDialog(null);
      reload();
    } catch (error) {
      setFolderError(error instanceof AdminApiError && error.code === "conflict" ? "已经有同名的文件夹了" : messageOf(error));
    }
  }

  async function removeFolder() {
    if (!deletingFolder) return;
    try {
      await adminApi.deleteFolder(deletingFolder.id);
      if (folder === deletingFolder.id) setFolder("all");
      setDeletingFolder(null);
      reload();
    } catch (error) {
      setActionError(messageOf(error));
      setDeletingFolder(null);
    }
  }

  const selectedImages = images?.filter((image) => selected.has(image.id)) ?? [];
  const referenced = selectedImages.filter((image) => image.usage > 0);
  const currentFolder = typeof folder === "number" ? folders.find((f) => f.id === folder) : undefined;
  const folderLabel = folder === "all" ? "全部图片" : folder === "none" ? "未归类" : (currentFolder?.name ?? "文件夹");

  const folderButton = (value: Folder, text: string, count?: number) => (
    <button type="button" className={styles.folder} aria-current={folder === value ? "true" : undefined} onClick={() => setFolder(value)}>
      <span>{text}</span>
      {count !== undefined && <span className={styles.folderCount}>{count}</span>}
    </button>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>媒体</h1>
        <Button variant="primary" busy={uploading > 0} onClick={() => fileInputRef.current?.click()}>
          <ImagePlus aria-hidden="true" />
          上传图片
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={imageContentTypes.join(",")}
          multiple
          hidden
          onChange={(event) => {
            void upload([...(event.currentTarget.files ?? [])]);
            event.currentTarget.value = "";
          }}
        />
      </header>

      <div className={styles.layout}>
        <nav className={styles.folders} aria-label="文件夹">
          <ul>
            <li>{folderButton("all", "全部图片")}</li>
            <li>{folderButton("none", "未归类")}</li>
            {folders.map((f) => (
              <li key={f.id} className={styles.folderRow}>
                {folderButton(f.id, f.name, f.imageCount)}
                {folder === f.id && (
                  <span className={styles.folderActions}>
                    <Button
                      variant="plain"
                      iconOnly
                      aria-label={`重命名文件夹“${f.name}”`}
                      onClick={() => {
                        setFolderName(f.name);
                        setFolderError(undefined);
                        setFolderDialog({ mode: "rename", folder: f });
                      }}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button variant="plainDestructive" iconOnly aria-label={`删除文件夹“${f.name}”`} onClick={() => setDeletingFolder(f)}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <Button
            variant="plain"
            onClick={() => {
              setFolderName("");
              setFolderError(undefined);
              setFolderDialog({ mode: "create" });
            }}
          >
            <FolderPlus aria-hidden="true" />
            新建文件夹
          </Button>
        </nav>

        <section className={styles.main} aria-label={folderLabel}>
          <div className={styles.toolbar}>
            <TextField
              className={styles.search}
              type="search"
              label="搜索图片"
              hideLabel
              placeholder="按文件名或描述搜索"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <label className={styles.toggle}>
              <input type="checkbox" checked={unused} onChange={(event) => setUnused(event.target.checked)} />
              只看未被引用的
            </label>
          </div>

          {selected.size > 0 && (
            <div className={styles.selectionBar} role="region" aria-label="批量操作">
              <span>已选 {selected.size} 张</span>
              <label className={styles.selectField}>
                <span className="visually-hidden">移动到文件夹</span>
                <select
                  value=""
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value) void moveSelected(value === "none" ? null : Number(value));
                  }}
                >
                  <option value="">移动到…</option>
                  <option value="none">未归类</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="plainDestructive" onClick={() => (setDeleteError(undefined), setConfirmDelete(true))}>
                删除
              </Button>
              <Button variant="plain" onClick={() => setSelected(new Set())}>
                取消选择
              </Button>
            </div>
          )}

          <p role="status" className={styles.hint}>
            {uploading > 0 ? `正在上传，还剩 ${uploading} 张…` : notice}
          </p>
          {actionError && (
            <Banner title="操作失败" className={styles.banner}>
              <span className={styles.preLine}>{actionError}</span>
            </Banner>
          )}
          {loadError && <Banner title="图片加载失败">{loadError}</Banner>}
          {!images && !loadError && (
            <p className={styles.placeholder}>
              <Spinner />
              正在加载…
            </p>
          )}
          {images && images.length === 0 && (
            <div className={styles.empty}>
              <Images className={styles.emptyIcon} aria-hidden="true" />
              <p>{q || unused ? "没有符合条件的图片。" : "这里还没有图片。点「上传图片」，或者在编辑文章时粘贴、拖入图片。"}</p>
            </div>
          )}
          {images && images.length > 0 && (
            <MediaGrid images={images} mode="manage" selected={selected} onToggle={toggle} onOpen={(image) => setOpenId(image.id)} />
          )}
        </section>
      </div>

      <ImageDetailDialog
        imageId={openId}
        folders={folders}
        onClose={() => setOpenId(null)}
        onChanged={(updated) => setImages((prev) => prev?.map((image) => (image.id === updated.id ? updated : image)) ?? prev)}
        onDeleted={(id) => {
          setOpenId(null);
          setNotice("已删除 1 张图片");
          setImages((prev) => prev?.filter((image) => image.id !== id) ?? prev);
          reload();
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`删除选中的 ${selected.size} 张图片？`}
        confirmLabel="删除"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void deleteSelected()}
        onCancel={() => setConfirmDelete(false)}
      >
        {referenced.length > 0
          ? `其中 ${referenced.length} 张仍被文章引用，删除后那些文章里的图片会显示不出来。删除后无法恢复。`
          : "这些图片都没有被文章引用。文件会从存储里删除，无法恢复。"}
      </ConfirmDialog>

      <ConfirmDialog
        open={deletingFolder !== null}
        title={`删除文件夹“${deletingFolder?.name ?? ""}”？`}
        confirmLabel="删除文件夹"
        destructive
        onConfirm={() => void removeFolder()}
        onCancel={() => setDeletingFolder(null)}
      >
        里面的图片不会被删除，会回到“未归类”。
      </ConfirmDialog>

      <Dialog
        open={folderDialog !== null}
        title={folderDialog?.mode === "rename" ? "重命名文件夹" : "新建文件夹"}
        onClose={() => setFolderDialog(null)}
      >
        <form className={styles.form} onSubmit={(event) => void saveFolder(event)}>
          <TextField label="名称" value={folderName} onChange={(event) => setFolderName(event.target.value)} error={folderError} maxLength={50} autoFocus />
          <Button type="submit" variant="primary" disabled={folderName.trim() === ""}>
            {folderDialog?.mode === "rename" ? "保存" : "创建"}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
