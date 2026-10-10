"use client";

import type { AdminPost, PostStatus } from "@blog/shared";
import { imageContentTypes } from "@blog/shared";
import { ChevronLeft, ExternalLink, ImagePlus } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { TextArea, TextField } from "@/components/ui/TextField";
import { adminApi, AdminApiError } from "@/lib/admin-api";
import { formatDateTime, formatTime } from "@/lib/admin-format";
import { uploadImage } from "@/lib/image-upload";
import { imageMarkdown, insertBlock, replacePlaceholder, uploadPlaceholder } from "@/lib/markdown-edit";
import {
  buildCreateInput,
  buildUpdateInput,
  emptyPostForm,
  formFromPost,
  hasErrors,
  isFormDirty,
  issuesToFormErrors,
  normalizeSlug,
  type PostFormErrors,
  type PostFormField,
  type PostFormValues,
  suggestSlug,
  validatePostForm,
} from "@/lib/post-form";
import { MarkdownPreview } from "./MarkdownPreview";
import styles from "./PostEditorForm.module.css";
import { StatusBadge } from "./StatusBadge";
import { TagEditor } from "./TagEditor";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; target: PostStatus }
  | { kind: "saved"; at: Date }
  | { kind: "error"; title: string; message?: string };

type View = "edit" | "preview";

const viewOptions = [
  { value: "edit", label: "编辑" },
  { value: "preview", label: "预览" },
] as const;

/** 出错时按页面上的顺序找第一个有错的字段聚焦 */
const fieldOrder: PostFormField[] = ["title", "slug", "tags", "contentMd"];

export function PostEditorForm({ initialPost }: { initialPost: AdminPost | null }) {
  /** 服务器上的最新版本（新建且还没保存过时为 null） */
  const [saved, setSaved] = useState<AdminPost | null>(initialPost);
  const [values, setValues] = useState<PostFormValues>(() => (initialPost ? formFromPost(initialPost) : emptyPostForm));
  const [errors, setErrors] = useState<PostFormErrors>({});
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [view, setView] = useState<View>("edit");
  // 同步的"保存中"标记：state 要等下一次渲染才更新，连按两次 ⌘S 会发出两个请求
  const savingRef = useRef(false);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const tagRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewHeadingId = useId();
  /** 正在上传的图片数；ref 是给 save() 同步判断用的（理由同 savingRef） */
  const [uploading, setUploading] = useState(0);
  const uploadingRef = useRef(0);
  const uploadSeq = useRef(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const baseline = saved ? formFromPost(saved) : emptyPostForm;
  const dirty = isFormDirty(baseline, values);
  const status: PostStatus = saved?.status ?? "draft";
  const isPublished = status === "published";

  const guard = useUnsavedChangesGuard(dirty);

  function setField<K extends PostFormField>(field: K, value: PostFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
    // 用户开始改这个字段了，旧的错误提示不再准确
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function focusFirstError(nextErrors: PostFormErrors) {
    const field = fieldOrder.find((f) => nextErrors[f]);
    if (!field) return;
    if (field === "contentMd" && view === "preview") setView("edit");
    const target = { title: titleRef, slug: slugRef, tags: tagRef, contentMd: contentRef }[field];
    // 等切换视图后的渲染完成，被隐藏的正文框显示出来才能聚焦
    requestAnimationFrame(() => target.current?.focus());
  }

  function fail(nextErrors: PostFormErrors, title: string, message?: string) {
    setErrors(nextErrors);
    setSaveState({ kind: "error", title, message: message ?? nextErrors.form });
    focusFirstError(nextErrors);
  }

  async function save(target: PostStatus) {
    if (savingRef.current) return;
    // 上传中的图片在正文里还是占位符，这时保存会把占位符存进文章
    if (uploadingRef.current > 0) {
      setSaveState({ kind: "error", title: "图片还在上传", message: "请等上传完成后再保存。" });
      return;
    }

    const clientErrors = validatePostForm(values, target);
    if (hasErrors(clientErrors)) {
      fail(clientErrors, "请先修正标出的问题");
      return;
    }

    let request: Promise<AdminPost>;
    if (saved) {
      const input = buildUpdateInput({ ...baseline, status: saved.status }, values, target);
      // 没有改动：PATCH 空对象会被拒绝，也没必要发请求
      if (!input) {
        setSaveState({ kind: "saved", at: new Date() });
        return;
      }
      request = adminApi.updatePost(saved.id, input);
    } else {
      request = adminApi.createPost(buildCreateInput(values, target));
    }

    const sent = values;
    savingRef.current = true;
    setErrors({});
    setSaveState({ kind: "saving", target });
    try {
      const post = await request;
      setSaved(post);
      // 保存期间没有继续输入：换成服务端返回的版本（可能被规范化过，比如去掉标题首尾空格），
      // 否则保留用户新输入的内容，它们仍是"未保存"状态
      setValues((current) => (current === sent ? formFromPost(post) : current));
      setSaveState({ kind: "saved", at: new Date() });
      if (!saved) {
        // 新建成功后地址换成编辑页：刷新页面不会丢，之后的保存走 PATCH。
        // 用 history.replaceState 而不是 router.replace：只改地址栏，不重新挂载编辑器，
        // 光标位置、预览、撤销栈都保留。
        window.history.replaceState(null, "", `/admin/posts/${post.id}`);
      }
    } catch (error) {
      if (!(error instanceof AdminApiError)) {
        fail({}, "保存失败", "出现了意外错误，请稍后重试");
      } else if (error.code === "validation_error") {
        fail(issuesToFormErrors(error.issues), "保存失败：有字段未通过校验", error.issues.length ? undefined : error.message);
      } else if (error.code === "conflict") {
        fail({ slug: "这个 slug 已被其他文章使用，请换一个" }, "保存失败：slug 冲突", error.message);
      } else if (error.code === "not_found") {
        fail({}, "保存失败：这篇文章已不存在", "它可能已在其他地方被删除。复制好正文后再离开本页。");
      } else if (error.code === "unauthorized") {
        fail({}, "登录已过期", "正在跳转到登录页…");
      } else {
        fail({}, "保存失败", error.message);
      }
    } finally {
      savingRef.current = false;
    }
  }

  /** 基于最新的正文修改（上传是异步的，期间作者可能继续打字，不能用发起上传时的旧正文） */
  function updateContent(update: (content: string) => string) {
    setValues((prev) => ({ ...prev, contentMd: update(prev.contentMd) }));
  }

  /**
   * 插入图片：先在光标处为每张图插入占位符，再逐张上传，完成一张替换一张。
   * 逐张而不是并发：顺序和选择的顺序一致，也不会同时占满带宽。
   */
  async function insertImages(files: File[]) {
    if (files.length === 0) return;
    setUploadError(null);
    const textarea = contentRef.current;
    const placeholders = files.map((file) => uploadPlaceholder(String(++uploadSeq.current), file.name));
    const { value, cursor } = insertBlock(
      values.contentMd,
      textarea?.selectionStart ?? values.contentMd.length,
      textarea?.selectionEnd ?? values.contentMd.length,
      placeholders.join("\n\n"),
    );
    setField("contentMd", value);
    if (view === "preview") setView("edit");
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    });

    uploadingRef.current += files.length;
    setUploading(uploadingRef.current);
    for (const [i, file] of files.entries()) {
      const placeholder = placeholders[i] ?? "";
      try {
        const image = await uploadImage(file);
        updateContent((content) => replacePlaceholder(content, placeholder, imageMarkdown(image.url)));
      } catch (error) {
        updateContent((content) => replacePlaceholder(content, placeholder, ""));
        setUploadError(`${file.name || "图片"}：${error instanceof Error ? error.message : "上传失败"}`);
      } finally {
        uploadingRef.current -= 1;
        setUploading(uploadingRef.current);
      }
    }
  }

  /** 粘贴板、拖放里的图片文件（其他文件忽略，交给浏览器默认处理） */
  function imageFiles(list: FileList | null): File[] {
    return [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
  }

  // ⌘S / Ctrl+S：保存（保持当前状态：草稿存草稿，已发布的直接更新）
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
      event.preventDefault(); // 阻止浏览器的"另存为网页"
      void save(status);
    }
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(status);
  }

  const saving = saveState.kind === "saving";
  const statusText =
    saveState.kind === "saving"
      ? saveState.target === "published" && !isPublished
        ? "正在发布…"
        : "正在保存…"
      : saveState.kind === "error"
        ? "保存失败"
        : dirty
          ? "未保存"
          : saveState.kind === "saved"
            ? `已保存 ${formatTime(saveState.at)}`
            : "";

  return (
    <>
      <form className={styles.editor} onSubmit={onSubmit} noValidate>
        <h1 className="visually-hidden">{saved ? "编辑文章" : "新建文章"}</h1>

        {/* 吸顶工具栏：浮层性质，允许毛玻璃 */}
        <div className={styles.toolbar}>
          <Link href="/admin/posts" className={styles.back}>
            <ChevronLeft className={styles.backIcon} aria-hidden="true" />
            <span className={styles.backText}>文章</span>
            <span className="visually-hidden">（返回列表）</span>
          </Link>

          {/* role=status 自带 aria-live="polite"：保存中 / 已保存 / 失败 会被读屏播报 */}
          <p role="status" className={[styles.saveStatus, saveState.kind === "error" && styles.saveStatusError].filter(Boolean).join(" ")}>
            {statusText}
          </p>

          {/*
           * 两个按钮的位置固定，只换文字和行为：同一位置的 <button> 被 React 复用，
           * 点"发布"后按钮变成"更新"，焦点不会丢。
           */}
          <div className={styles.actions}>
            <Button
              type={isPublished ? "button" : "submit"}
              variant={isPublished ? "plain" : "secondary"}
              busy={saving && saveState.target === "draft"}
              onClick={isPublished ? () => void save("draft") : undefined}
              aria-keyshortcuts={isPublished ? undefined : "Meta+S Control+S"}
              title={isPublished ? undefined : "保存草稿（⌘S）"}
            >
              {isPublished ? "撤回为草稿" : "保存草稿"}
            </Button>
            <Button
              type={isPublished ? "submit" : "button"}
              variant="primary"
              busy={saving && saveState.target === "published"}
              onClick={isPublished ? undefined : () => void save("published")}
              aria-keyshortcuts={isPublished ? "Meta+S Control+S" : undefined}
              title={isPublished ? "更新（⌘S）" : undefined}
            >
              {isPublished ? "更新" : "发布"}
            </Button>
          </div>
        </div>

        {saveState.kind === "error" && (
          <Banner title={saveState.title} className={styles.banner}>
            {saveState.message}
          </Banner>
        )}

        <div className={styles.meta}>
          <p className={styles.postInfo}>
            <StatusBadge status={status} />
            {saved?.publishedAt && (
              <span>
                首次发布于 <time dateTime={saved.publishedAt}>{formatDateTime(saved.publishedAt)}</time>
              </span>
            )}
            {saved && (
              <span>
                更新于 <time dateTime={saved.updatedAt}>{formatDateTime(saved.updatedAt)}</time>
              </span>
            )}
            {saved?.status === "published" && (
              <a href={`/posts/${saved.slug}`} target="_blank" rel="noopener" className={styles.viewLink}>
                查看文章
                <ExternalLink className={styles.viewIcon} aria-hidden="true" />
                <span className="visually-hidden">（在新标签页打开）</span>
              </a>
            )}
          </p>

          {/*
           * 标题用会自动长高的单行 textarea 而不是 <input>：中文长标题在手机上能完整看到，
           * 不会被截断在一行里横向滚动。回车不换行，而是像输入框一样提交（保存）。
           */}
          <TextArea
            ref={titleRef}
            label="标题"
            rows={1}
            value={values.title}
            onChange={(event) => setField("title", event.target.value.replace(/[\r\n]+/g, " "))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            error={errors.title}
            maxLength={200}
            className={styles.titleField}
            inputClassName={styles.titleInput}
            autoComplete="off"
            enterKeyHint="done"
          />

          <TextField
            ref={slugRef}
            className={styles.slugField}
            label="Slug"
            value={values.slug}
            onChange={(event) => setField("slug", event.target.value)}
            // 失焦时整理成合法形式（大写转小写、空格转连字符），打字时不干预
            onBlur={() => {
              const normalized = normalizeSlug(values.slug);
              if (normalized !== values.slug && normalized !== "") setField("slug", normalized);
            }}
            error={errors.slug}
            hint={
              <>
                文章地址 /posts/{values.slug || "…"}。中文标题请用英文概括，如 hello-world。
              </>
            }
            maxLength={200}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            accessory={
              <Button
                variant="secondary"
                onClick={() => setField("slug", suggestSlug(values.title))}
                disabled={values.title.trim() === ""}
                title="提取标题里的英文和数字；没有时用今天的日期"
              >
                从标题生成
              </Button>
            }
          />

          <div className={styles.tagsField}>
            <TagEditor tags={values.tags} onChange={(tags) => setField("tags", tags)} error={errors.tags} inputRef={tagRef} />
          </div>
        </div>

        {/* 窄屏：编辑和预览二选一；宽屏左右分栏，切换控件隐藏 */}
        <SegmentedControl className={styles.viewSwitch} label="显示" options={viewOptions} value={view} onChange={setView} />

        <div className={styles.split} data-view={view}>
          <div className={`${styles.pane} ${styles.editPane}`}>
            <TextArea
              ref={contentRef}
              label="正文"
              hint="支持 Markdown（GFM）"
              value={values.contentMd}
              onChange={(event) => setField("contentMd", event.target.value)}
              error={errors.contentMd}
              className={styles.contentField}
              inputClassName={styles.contentInput}
              maxLength={200_000}
              onPaste={(event) => {
                const files = imageFiles(event.clipboardData.files);
                if (files.length === 0) return;
                event.preventDefault();
                void insertImages(files);
              }}
              onDragOver={(event) => {
                // 拖着文件经过时允许放下（默认行为是浏览器打开这个文件）
                if (event.dataTransfer.types.includes("Files")) event.preventDefault();
              }}
              onDrop={(event) => {
                const files = imageFiles(event.dataTransfer.files);
                if (files.length === 0) return;
                event.preventDefault();
                void insertImages(files);
              }}
            />
            <div className={styles.contentTools}>
              <Button variant="plain" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus className={styles.toolIcon} aria-hidden="true" />
                插入图片
              </Button>
              <p role="status" className={styles.uploadStatus}>
                {uploading > 0 ? `正在上传 ${uploading} 张图片…` : "也可以直接粘贴或拖入图片"}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={imageContentTypes.join(",")}
                multiple
                hidden
                onChange={(event) => {
                  void insertImages(imageFiles(event.currentTarget.files));
                  // 清空，否则再次选择同一个文件不会触发 change
                  event.currentTarget.value = "";
                }}
              />
            </div>
            {uploadError && (
              <Banner title="图片上传失败" className={styles.uploadBanner}>
                {uploadError}
              </Banner>
            )}
          </div>
          <section className={`${styles.pane} ${styles.previewPane}`} aria-labelledby={previewHeadingId}>
            <h2 id={previewHeadingId} className={styles.paneTitle}>
              预览
            </h2>
            <div className={styles.previewBody}>
              <MarkdownPreview markdown={values.contentMd} />
            </div>
          </section>
        </div>
      </form>

      <ConfirmDialog
        open={guard.pendingHref !== null}
        title="放弃未保存的更改？"
        confirmLabel="放弃更改"
        cancelLabel="继续编辑"
        destructive
        onConfirm={guard.confirmLeave}
        onCancel={guard.cancelLeave}
      >
        离开后，这次的修改将会丢失。
      </ConfirmDialog>
    </>
  );
}
