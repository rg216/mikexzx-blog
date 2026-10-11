"use client";

import { type AdminPost, type AdminTranslation, type Locale, localeInfo } from "@blog/shared";
import { ChevronLeft, Copy, ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Spinner } from "@/components/ui/Spinner";
import { TextArea } from "@/components/ui/TextField";
import { adminApi, AdminApiError } from "@/lib/admin-api";
import { adminLocaleName, formatDateTime, formatTime } from "@/lib/admin-format";
import { postPath } from "@/lib/i18n/paths";
import { hasErrors } from "@/lib/post-form";
import {
  buildTranslationInput,
  canTranslateTo,
  checkUntranslated,
  emptyTranslationForm,
  formFromSource,
  formFromTranslation,
  isTranslationDirty,
  issuesToTranslationErrors,
  needsSave,
  originLabel,
  type TranslationFormErrors,
  type TranslationFormField,
  type TranslationFormValues,
  translationSaveHint,
  translationState,
  validateTranslationForm,
} from "@/lib/translation-form";
import { MarkdownImageTools } from "./MarkdownImageTools";
import { MarkdownPreview } from "./MarkdownPreview";
import { MediaPicker } from "./media/MediaPicker";
import loader from "./PostEditor.module.css";
// 工具栏、标题框、正文框的样式和文章编辑器完全相同，直接复用；分栏（多了"原文"一栏）在自己的模块里
import editor from "./PostEditorForm.module.css";
import styles from "./TranslationEditor.module.css";
import { TranslationStateBadge } from "./TranslationStateBadge";
import { useMarkdownImages } from "./useMarkdownImages";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string; notFound: boolean }
  | { kind: "ready"; post: AdminPost; translation: AdminTranslation | null };

/** 译文编辑页入口：先加载文章，有这种语言的译文再加载译文，然后交给表单。 */
export function TranslationEditor({ postId, locale }: { postId: number; locale: Locale }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function load(): Promise<LoadState> {
      const post = await adminApi.getPost(postId);
      // 文章的译文概要里没有这种语言，就是还没有译文，不用再请求（GET 译文的 404 和"文章不存在"分不开）
      if (!post.translations.some((t) => t.locale === locale)) return { kind: "ready", post, translation: null };
      try {
        return { kind: "ready", post, translation: await adminApi.getTranslation(postId, locale) };
      } catch (error) {
        // 两次请求之间译文被删掉了（另一个标签页）：当作还没有译文
        if (error instanceof AdminApiError && error.code === "not_found") return { kind: "ready", post, translation: null };
        throw error;
      }
    }
    load().then(
      (next) => {
        if (!ignore) setState(next);
      },
      (error: unknown) => {
        if (ignore) return;
        const notFound = error instanceof AdminApiError && error.code === "not_found";
        const message = error instanceof AdminApiError ? error.message : "出现了意外错误，请稍后重试";
        setState({ kind: "error", message, notFound });
      },
    );
    return () => {
      ignore = true;
    };
  }, [postId, locale, reloadKey]);

  if (state.kind === "ready" && canTranslateTo(state.post, locale)) {
    return <TranslationEditorForm post={state.post} locale={locale} initialTranslation={state.translation} />;
  }

  // 原文语言没有"译文"可编辑：和找不到文章一样显示 404 风格的说明，给出回原文的链接
  const isSourceLocale = state.kind === "ready";
  const notFound = state.kind === "error" && state.notFound;

  return (
    <div className={loader.status}>
      <h1 className={notFound || isSourceLocale ? loader.title : "visually-hidden"}>
        {notFound ? "找不到这篇文章" : isSourceLocale ? `这篇文章的原文就是${adminLocaleName(locale)}` : "编辑译文"}
      </h1>

      {state.kind === "loading" && (
        <p className={loader.loading}>
          <Spinner />
          正在加载…
        </p>
      )}

      {notFound && <p className={loader.text}>它可能已经被删除了。</p>}
      {isSourceLocale && <p className={loader.text}>原文语言不需要译文，请直接编辑原文。</p>}

      {state.kind === "error" && !state.notFound && (
        <Banner
          title="加载失败"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setState({ kind: "loading" });
                setReloadKey((key) => key + 1);
              }}
            >
              重试
            </Button>
          }
        >
          {state.message}
        </Banner>
      )}

      {(state.kind === "error" || isSourceLocale) && (
        <Link href={isSourceLocale ? `/admin/posts/${postId}` : "/admin/posts"} className={loader.back}>
          <ChevronLeft aria-hidden="true" className={loader.backIcon} />
          {isSourceLocale ? "返回原文" : "返回文章列表"}
        </Link>
      )}
    </div>
  );
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "deleted" }
  | { kind: "error"; title: string; message?: string };

/*
 * 窄屏三选一；宽屏左边固定是编辑框，右栏在"预览 / 原文"之间切换。
 * 右栏显示什么（sideView）和窄屏是否在编辑（narrowEditing）分成两个状态：插入图片、正文校验出错时
 * 窄屏要切回编辑框，但不能顺带把宽屏右栏从"原文"换成"预览"——作者正对照着原文。
 */
type SideView = "preview" | "source";
type View = "edit" | SideView;

const narrowViewOptions = [
  { value: "edit", label: "编辑" },
  { value: "preview", label: "预览" },
  { value: "source", label: "原文" },
] as const;

const wideViewOptions = [
  { value: "preview", label: "预览" },
  { value: "source", label: "原文" },
] as const;

const fieldOrder: TranslationFormField[] = ["title", "contentMd"];
const fieldLabels: Record<TranslationFormField, string> = { title: "标题", contentMd: "正文" };

type FormProps = {
  /** 加载时的原文。保存译文时传它的 sourceHash：译文是对着这一版原文写的 */
  post: AdminPost;
  locale: Locale;
  initialTranslation: AdminTranslation | null;
};

function TranslationEditorForm({ post, locale, initialTranslation }: FormProps) {
  /**
   * 对照的原文：加载时的版本，只在作者点"载入最新原文"时更新——不自动刷新，作者正在对照的内容不会在眼前变掉，
   * 保存时传的 sourceHash 也始终是作者看到的那一版
   */
  const [source, setSource] = useState(post);
  const [refreshingSource, setRefreshingSource] = useState(false);
  /** 服务器上的译文（还没有译文、或刚删除时为 null） */
  const [saved, setSaved] = useState<AdminTranslation | null>(initialTranslation);
  const [values, setValues] = useState<TranslationFormValues>(() => (initialTranslation ? formFromTranslation(initialTranslation) : emptyTranslationForm));
  const [errors, setErrors] = useState<TranslationFormErrors>({});
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [sideView, setSideView] = useState<SideView>("preview");
  const [narrowEditing, setNarrowEditing] = useState(true);
  const narrowView: View = narrowEditing ? "edit" : sideView;
  // 同步的"保存中"标记：连按两次 ⌘S 不发两个请求（理由同 PostEditorForm）
  const savingRef = useRef(false);
  // 同理，同步的"删除中"标记：保存和删除不能同时进行，否则两个请求谁先落库、界面停在哪个状态都说不准
  const deletingRef = useRef(false);
  /** 只有一项还是原文时，等作者确认的字段 */
  const [confirmingUntranslated, setConfirmingUntranslated] = useState<TranslationFormField[] | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const sideHeadingId = useId();

  const info = localeInfo[locale];
  const sourceInfo = localeInfo[source.sourceLocale];
  // 后台的语言名用中文（英语 / 日语），见 adminLocaleName；lang 属性仍用 localeInfo 的完整标签
  const name = adminLocaleName(locale);
  const sourceName = adminLocaleName(source.sourceLocale);
  const baseline = saved ? formFromTranslation(saved) : emptyTranslationForm;
  const dirty = isTranslationDirty(baseline, values);
  const state = translationState(saved);
  const guard = useUnsavedChangesGuard(dirty);

  function setField<K extends TranslationFormField>(field: K, value: TranslationFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  const images = useMarkdownImages({
    textareaRef: contentRef,
    value: values.contentMd,
    onChange: (value) => setField("contentMd", value),
    onUpdate: (update) => setValues((prev) => ({ ...prev, contentMd: update(prev.contentMd) })),
    // 窄屏处在预览 / 原文时切回编辑框；宽屏编辑框一直可见，右栏不受影响
    onBeforeInsert: () => setNarrowEditing(true),
  });

  function fail(nextErrors: TranslationFormErrors, title: string, message?: string) {
    setErrors(nextErrors);
    setSaveState({ kind: "error", title, message: message ?? nextErrors.form });
    const field = fieldOrder.find((f) => nextErrors[f]);
    if (!field) return;
    if (field === "contentMd") setNarrowEditing(true);
    const target = field === "title" ? titleRef : contentRef;
    requestAnimationFrame(() => target.current?.focus());
  }

  async function save({ allowUntranslated = false } = {}) {
    if (savingRef.current || deletingRef.current) return;
    if (images.isUploading()) {
      setSaveState({ kind: "error", title: "图片还在上传", message: "请等上传完成后再保存。" });
      return;
    }

    const clientErrors = validateTranslationForm(values, source.sourceHash);
    if (hasErrors(clientErrors)) {
      fail(clientErrors, "请先修正标出的问题");
      return;
    }
    // 还是原文就不能当译文发布（见 checkUntranslated）
    if (!allowUntranslated) {
      const check = checkUntranslated(values, source, saved ? formFromTranslation(saved) : null);
      if (check.kind === "refuse") {
        const sameAsSource = "和原文完全相同";
        fail(
          { title: sameAsSource, contentMd: source.contentMd.trim() ? sameAsSource : undefined },
          "标题和正文还是原文",
          `翻译之后再保存（${translationSaveHint(source.status)}）。`,
        );
        return;
      }
      if (check.kind === "confirm") {
        setConfirmingUntranslated(check.fields);
        return;
      }
    }
    if (!needsSave(saved, dirty, source.sourceHash)) {
      setSaveState({ kind: "saved", at: new Date() });
      return;
    }

    const sent = values;
    savingRef.current = true;
    setErrors({});
    setSaveState({ kind: "saving" });
    try {
      const translation = await adminApi.saveTranslation(source.id, locale, buildTranslationInput(values, source.sourceHash));
      setSaved(translation);
      // 保存期间没有继续输入：换成服务端返回的版本（标题可能被去掉首尾空格）；否则保留新输入，它们仍未保存
      setValues((current) => (current === sent ? formFromTranslation(translation) : current));
      setSaveState({ kind: "saved", at: new Date() });
    } catch (error) {
      if (!(error instanceof AdminApiError)) {
        fail({}, "保存失败", "出现了意外错误，请稍后重试");
      } else if (error.code === "validation_error") {
        fail(issuesToTranslationErrors(error.issues), "保存失败：有字段未通过校验", error.issues.length ? undefined : error.message);
      } else if (error.code === "not_found") {
        fail({}, "保存失败：这篇文章已不存在", "它可能已在其他地方被删除。复制好译文后再离开本页。");
      } else if (error.code === "unauthorized") {
        fail({}, "登录已过期", "正在跳转到登录页…");
      } else {
        fail({}, "保存失败", error.message);
      }
    } finally {
      savingRef.current = false;
    }
  }

  async function confirmDelete() {
    if (deletingRef.current || savingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await adminApi.deleteTranslation(source.id, locale);
    } catch (error) {
      // 已经被删掉了（另一个标签页）：结果和成功一样
      if (!(error instanceof AdminApiError && error.code === "not_found")) {
        setDeleteError(error instanceof AdminApiError ? error.message : "出现了意外错误，请稍后重试");
        deletingRef.current = false;
        setDeleting(false);
        return;
      }
    }
    // 留在本页、回到"还没有译文"的状态：可以马上重新开始，也能看到"复制原文"入口
    setSaved(null);
    setValues(emptyTranslationForm);
    setErrors({});
    setSaveState({ kind: "deleted" });
    deletingRef.current = false;
    setDeleting(false);
    setConfirmingDelete(false);
    // 删除按钮随译文一起消失了，焦点交给标题框。等对话框关闭、页面不再 inert 后才聚焦得上
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  /** 原文在本页打开后又被改过：译文按打开时的原文保存，所以保存后仍是过时，再按保存也没用 */
  const sourceChangedSinceLoad = saved !== null && saved.outdated && saved.sourceHash === source.sourceHash;

  async function reloadSource() {
    if (refreshingSource) return;
    setRefreshingSource(true);
    try {
      setSource(await adminApi.getPost(source.id));
      setSaveState({ kind: "idle" });
    } catch (error) {
      setSaveState({ kind: "error", title: "载入最新原文失败", message: error instanceof AdminApiError ? error.message : "出现了意外错误，请稍后重试" });
    } finally {
      setRefreshingSource(false);
    }
  }

  // ⌘S / Ctrl+S：保存。对话框开着（删除确认、"还是原文"确认）时不保存，只拦下浏览器的"保存网页"
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (confirmingDelete || deleting || confirmingUntranslated !== null) return;
      void save();
    }
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  const statusText =
    saveState.kind === "saving"
      ? "正在保存…"
      : saveState.kind === "error"
        ? "保存失败"
        : dirty
          ? "未保存"
          : saveState.kind === "saved"
            ? `已保存 ${formatTime(saveState.at)}`
            : saveState.kind === "deleted"
              ? "已删除译文"
              : "";

  const isPublished = source.status === "published";
  const formEmpty = values.title === "" && values.contentMd === "";

  return (
    <>
      <form className={editor.editor} onSubmit={onSubmit} noValidate>
        <h1 className="visually-hidden">
          编辑{name}译文：{source.title}
        </h1>

        <div className={editor.toolbar}>
          <Link href={`/admin/posts/${source.id}`} className={editor.back}>
            <ChevronLeft className={editor.backIcon} aria-hidden="true" />
            <span className={editor.backText}>原文</span>
            <span className="visually-hidden">（返回原文编辑）</span>
          </Link>

          <p role="status" className={[editor.saveStatus, saveState.kind === "error" && editor.saveStatusError].filter(Boolean).join(" ")}>
            {statusText}
          </p>

          <div className={editor.actions}>
            {saved && (
              <Button
                variant="plainDestructive"
                iconOnly
                aria-label="删除译文"
                title="删除译文"
                // 保存中不能删除：两个请求同时进行，结果取决于谁后落库
                disabled={saveState.kind === "saving"}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            )}
            <Button type="submit" variant="primary" busy={saveState.kind === "saving"} aria-keyshortcuts="Meta+S Control+S" title="保存（⌘S）">
              保存
            </Button>
          </div>
        </div>

        {saveState.kind === "error" && (
          <Banner title={saveState.title} className={editor.banner}>
            {saveState.message}
          </Banner>
        )}

        <div className={styles.meta}>
          <p className={editor.postInfo}>
            <span className={styles.language}>{name}</span>
            <TranslationStateBadge state={state} />
            {saved && (
              <span>
                {originLabel(saved.origin, saved.model)} · {saved.origin === "machine" ? "生成于" : "保存于"} <time dateTime={saved.translatedAt}>{formatDateTime(saved.translatedAt)}</time>
              </span>
            )}
            {saved && isPublished && (
              <a href={postPath(locale, source.slug)} target="_blank" rel="noopener" className={editor.viewLink}>
                查看译文
                <ExternalLink className={editor.viewIcon} aria-hidden="true" />
                <span className="visually-hidden">（在新标签页打开）</span>
              </a>
            )}
          </p>

          <p className={styles.note}>
            原文《{source.title}》· {translationSaveHint(source.status)}
          </p>

          {/* 过时提示：醒目（黄色标记 + 正文色文字），但不是错误——过时的译文读者仍能读 */}
          {saved?.outdated &&
            (sourceChangedSinceLoad ? (
              // 本页显示的原文已经不是最新的：不显示加载时的"最近一次更新"时间（会早于译文的保存时间，读起来自相矛盾）
              <p className={styles.outdated}>
                原文在本页打开之后又被修改过，译文是按打开时的原文保存的。载入最新原文、对照修改后再保存，即标记为已同步。{" "}
                <Button variant="secondary" busy={refreshingSource} onClick={() => void reloadSource()}>
                  载入最新原文
                </Button>
              </p>
            ) : (
              <p className={styles.outdated}>
                原文在译文保存（{formatDateTime(saved.translatedAt)}）之后更新过，最近一次更新于{" "}
                <time dateTime={source.updatedAt}>{formatDateTime(source.updatedAt)}</time>。对照原文修改后保存，即标记为已同步。
              </p>
            ))}

          {!saved && formEmpty && (
            <div className={styles.copySource}>
              <Button variant="secondary" onClick={() => setValues(formFromSource(source))}>
                <Copy aria-hidden="true" />
                复制原文作为起点
              </Button>
              <p className={styles.note}>代码块、图片和链接地址原样保留，再逐段替换成译文；全文翻译完再保存{isPublished ? "，保存后读者立即可见" : ""}。</p>
            </div>
          )}

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
            className={editor.titleField}
            inputClassName={editor.titleInput}
            autoComplete="off"
            enterKeyHint="done"
            // 标注输入内容的语言：拼写检查按目标语言，中日文字形也随之正确
            lang={info.tag}
          />
        </div>

        <SegmentedControl
          className={styles.narrowSwitch}
          label="显示"
          options={narrowViewOptions}
          value={narrowView}
          onChange={(next) => {
            setNarrowEditing(next === "edit");
            if (next !== "edit") setSideView(next);
          }}
        />

        <div className={styles.split} data-view={narrowView}>
          <div className={`${editor.pane} ${styles.editPane}`}>
            <TextArea
              ref={contentRef}
              label="正文"
              hint="支持 Markdown（GFM）"
              value={values.contentMd}
              onChange={(event) => setField("contentMd", event.target.value)}
              error={errors.contentMd}
              className={editor.contentField}
              inputClassName={editor.contentInput}
              maxLength={200_000}
              lang={info.tag}
              {...images.textareaHandlers}
            />
            <MarkdownImageTools images={images} />
          </div>

          <section className={`${editor.pane} ${styles.sidePane}`} aria-labelledby={sideHeadingId}>
            <div className={styles.sideHeader}>
              <h2 id={sideHeadingId} className={styles.sideTitle}>
                {sideView === "source" ? `原文（${sourceName}）` : "预览"}
              </h2>
              <SegmentedControl
                className={styles.wideSwitch}
                label="右栏显示"
                options={wideViewOptions}
                value={sideView}
                onChange={setSideView}
              />
            </div>
            {/* 原文只读：用和文章页同样的渲染对照着看，比看 Markdown 源码更容易找到对应段落 */}
            {sideView === "source" ? (
              <div className={editor.previewBody} lang={sourceInfo.tag}>
                <p className={styles.sourceTitle}>{source.title}</p>
                <MarkdownPreview markdown={source.contentMd} locale={source.sourceLocale} />
              </div>
            ) : (
              <div className={editor.previewBody} lang={info.tag}>
                <MarkdownPreview markdown={values.contentMd} locale={locale} />
              </div>
            )}
          </section>
        </div>
      </form>

      <MediaPicker open={images.pickerOpen} onClose={images.closePicker} onInsert={images.insertMarkdown} />

      <ConfirmDialog
        open={confirmingDelete}
        title={`删除${name}译文？`}
        confirmLabel="删除"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirmingDelete(false)}
      >
        {isPublished ? `读者访问${name}版本时将看到原文。` : ""}
        删除后无法恢复{dirty ? "，未保存的修改也会一并丢弃" : ""}。
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingUntranslated !== null}
        title={`${(confirmingUntranslated ?? []).map((f) => fieldLabels[f]).join("和")}还是原文，仍然保存？`}
        confirmLabel="仍然保存"
        onConfirm={() => {
          setConfirmingUntranslated(null);
          void save({ allowUntranslated: true });
        }}
        onCancel={() => setConfirmingUntranslated(null)}
      >
        {(confirmingUntranslated ?? []).map((f) => fieldLabels[f]).join("和")}和原文完全相同。
        {isPublished ? "文章已发布，保存后读者立即可见。" : "文章发布后，读者会看到这些内容。"}
      </ConfirmDialog>

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
