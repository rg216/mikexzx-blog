"use client";

import { type AdminTag, missingTagTranslations, type TranslationConfig, tagSourceLocale, tagTranslationLocales } from "@blog/shared";
import { Merge, Pencil, Plus, Sparkles, Tags, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { adminApi, AdminApiError } from "@/lib/admin-api";
import { normalizeSlug } from "@/lib/post-form";
import { adminLanguageName, type TagFormErrors, type TagFormValues, tagFormValues, validateTagForm } from "@/lib/tag-form";
import { modelDisplayName } from "@/lib/translation-form";
import { unavailableReasonNotes } from "@/lib/translation-generation";
import { PostSectionTabs } from "./PostSectionTabs";
import styles from "./TagManager.module.css";

type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; tags: AdminTag[] };

function messageOf(error: unknown): string {
  return error instanceof AdminApiError ? error.message : "出现了意外错误，请稍后重试";
}

/** "3 篇，已发布 2 篇"：草稿也算，因为删除、合并会影响它们 */
function usageText(tag: AdminTag): string {
  if (tag.postCount === 0) return "没有文章使用";
  if (tag.publishedCount === tag.postCount) return `${tag.postCount} 篇文章`;
  return `${tag.postCount} 篇文章，已发布 ${tag.publishedCount} 篇`;
}

/** 列表里每个标签的各语言名称；缺译名时提示（旧标签，编辑时补上） */
function TagTranslationsLine({ tag }: { tag: AdminTag }) {
  const missing = missingTagTranslations(tag);
  const present = tagTranslationLocales.filter((locale) => !missing.includes(locale));
  return (
    <span className={styles.translationNames}>
      {present.map((locale) => (
        <span key={locale} lang={locale}>
          {tag.translations[locale]}
        </span>
      ))}
      {missing.length > 0 && <span className={styles.missing}>缺{missing.map(adminLanguageName).join("、")}名称</span>}
    </span>
  );
}

/**
 * 标签管理：新建、改名（名称 / slug / 各语言名称）、合并、删除。编辑文章时只能从这里已有的标签里选。
 * 改名、合并、删除后，API 会重建相关文章的搜索索引并刷新前台页面。
 */
export function TagManager() {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 新建 / 编辑
  const [editing, setEditing] = useState<{ mode: "create" } | { mode: "edit"; tag: AdminTag } | null>(null);
  const [values, setValues] = useState<TagFormValues>(tagFormValues());
  const [formErrors, setFormErrors] = useState<TagFormErrors & { form?: string }>({});
  const [saving, setSaving] = useState(false);

  // 大模型翻译标签名：配置（能不能用、用哪个模型）在页面打开时读一次
  const [translationConfig, setTranslationConfig] = useState<TranslationConfig | null>(null);
  const [configError, setConfigError] = useState<string>();
  const [translating, setTranslating] = useState(false);
  const [translateStatus, setTranslateStatus] = useState<{ kind: "done" | "error"; text: string } | null>(null);
  const translateControllerRef = useRef<AbortController | null>(null);

  // 合并
  const [merging, setMerging] = useState<AdminTag | null>(null);
  const [mergeInto, setMergeInto] = useState("");
  const [mergeError, setMergeError] = useState<string>();
  const [mergeBusy, setMergeBusy] = useState(false);

  // 删除
  const [deleting, setDeleting] = useState<AdminTag | null>(null);
  const [deleteError, setDeleteError] = useState<string>();
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    adminApi.listTags().then(
      (tags) => !ignore && setState({ kind: "ready", tags }),
      (error: unknown) => !ignore && setState({ kind: "error", message: messageOf(error) }),
    );
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let ignore = false;
    adminApi.getTranslationConfig().then(
      (config) => !ignore && setTranslationConfig(config),
      // 读不到配置：按钮保持禁用，手工填写不受影响
      (error: unknown) => !ignore && setConfigError(`读取翻译配置失败：${messageOf(error)}`),
    );
    return () => {
      ignore = true;
    };
  }, []);

  // 离开页面时中止进行中的翻译请求
  useEffect(() => () => translateControllerRef.current?.abort(), []);

  const tags = state.kind === "ready" ? state.tags : [];
  const reload = () => setReloadKey((key) => key + 1);

  function openEditor(target: { mode: "create" } | { mode: "edit"; tag: AdminTag }) {
    setEditing(target);
    setValues(tagFormValues(target.mode === "edit" ? target.tag : undefined));
    setFormErrors({});
    setTranslateStatus(null);
  }

  function closeEditor() {
    translateControllerRef.current?.abort();
    setEditing(null);
  }

  function setField(field: "name" | "slug", value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setFormErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function setTranslation(locale: (typeof tagTranslationLocales)[number], value: string) {
    setValues((prev) => ({ ...prev, translations: { ...prev.translations, [locale]: value } }));
    setFormErrors((prev) => ({ ...prev, translations: { ...prev.translations, [locale]: undefined } }));
  }

  /** 请大模型起译名，填进各语言的输入框（会替换已有内容），作者检查、保存后才生效 */
  async function translate() {
    const name = values.name.trim();
    if (!name || translating) return;
    const controller = new AbortController();
    translateControllerRef.current = controller;
    setTranslating(true);
    setTranslateStatus(null);
    try {
      const slug = normalizeSlug(values.slug);
      const result = await adminApi.translateTag({ name, slug }, controller.signal);
      setValues((prev) => ({ ...prev, translations: { ...prev.translations, ...result.translations } }));
      setFormErrors((prev) => ({ ...prev, translations: undefined }));
      setTranslateStatus({ kind: "done", text: `已由 ${modelDisplayName(result.model)} 生成，请检查后保存` });
    } catch (error) {
      if (controller.signal.aborted) return;
      setTranslateStatus({ kind: "error", text: messageOf(error) });
    } finally {
      if (translateControllerRef.current === controller) translateControllerRef.current = null;
      setTranslating(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || saving) return;
    const { data, errors } = validateTagForm(values, tags, editing.mode === "edit" ? editing.tag.id : undefined);
    if (!data) {
      setFormErrors(errors);
      return;
    }
    setSaving(true);
    setFormErrors({});
    try {
      if (editing.mode === "create") {
        await adminApi.createTag(data);
        setAnnouncement(`已新建标签 ${data.name}`);
      } else {
        // 只发改动的字段：没改 slug 就不碰它；译名整体发送（给了就必须是全部语言）
        const { tag } = editing;
        const translationsChanged = tagTranslationLocales.some((locale) => data.translations[locale] !== tag.translations[locale]);
        const changes = {
          ...(data.name !== tag.name && { name: data.name }),
          ...(data.slug !== tag.slug && { slug: data.slug }),
          ...(translationsChanged && { translations: data.translations }),
        };
        if (Object.keys(changes).length > 0) await adminApi.updateTag(tag.id, changes);
        setAnnouncement(`已保存标签 ${data.name}`);
      }
      setEditing(null);
      reload();
    } catch (error) {
      setFormErrors({ form: messageOf(error) });
    } finally {
      setSaving(false);
    }
  }

  function openMerge(tag: AdminTag) {
    setMerging(tag);
    setMergeInto("");
    setMergeError(undefined);
  }

  async function merge(event: FormEvent) {
    event.preventDefault();
    if (!merging || !mergeInto || mergeBusy) return;
    setMergeBusy(true);
    setMergeError(undefined);
    try {
      const target = await adminApi.mergeTag(merging.id, Number(mergeInto));
      setAnnouncement(`已把 ${merging.name} 合并到 ${target.name}`);
      setMerging(null);
      reload();
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (error) {
      setMergeError(messageOf(error));
    } finally {
      setMergeBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(undefined);
    try {
      await adminApi.deleteTag(deleting.id);
    } catch (error) {
      // 已经被删掉了（比如在另一个标签页）：结果和成功一样
      if (!(error instanceof AdminApiError && error.code === "not_found")) {
        setDeleteError(messageOf(error));
        setDeleteBusy(false);
        return;
      }
    }
    setAnnouncement(`已删除标签 ${deleting.name}`);
    setDeleting(null);
    setDeleteBusy(false);
    reload();
    // 触发删除的按钮随这一行一起消失了，焦点交给页面标题
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  const suggestedSlug = normalizeSlug(values.name);
  const mergeTargets = merging ? tags.filter((tag) => tag.id !== merging.id) : [];
  const mergeTarget = mergeTargets.find((tag) => String(tag.id) === mergeInto);

  return (
    <div className={styles.page}>
      <PostSectionTabs />
      <header className={styles.header}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          标签
        </h1>
        <Button variant="primary" onClick={() => openEditor({ mode: "create" })}>
          <Plus aria-hidden="true" />
          新建标签
        </Button>
      </header>
      <p className={styles.intro}>编辑文章时只能从这里的标签中选择。改名、合并、删除会同步到所有用到它的文章。</p>

      <p role="status" className="visually-hidden">
        {announcement}
      </p>

      {state.kind === "loading" && (
        <p className={styles.placeholder}>
          <Spinner />
          正在加载标签…
        </p>
      )}

      {state.kind === "error" && (
        <Banner
          title="标签加载失败"
          action={
            <Button variant="secondary" onClick={reload}>
              重试
            </Button>
          }
        >
          {state.message}
        </Banner>
      )}

      {state.kind === "ready" && state.tags.length === 0 && (
        <div className={styles.empty}>
          <Tags className={styles.emptyIcon} aria-hidden="true" />
          <p className={styles.emptyTitle}>还没有标签</p>
          <p className={styles.emptyText}>新建的标签可以在编辑文章时选用。</p>
        </div>
      )}

      {state.kind === "ready" && state.tags.length > 0 && (
        <ul className={styles.list} aria-label="全部标签">
          {state.tags.map((tag) => (
            <li key={tag.id} className={styles.row}>
              <div className={styles.main}>
                <span className={styles.name}>{tag.name}</span>
                <span className={styles.slug}>{tag.slug}</span>
                <TagTranslationsLine tag={tag} />
              </div>
              <span className={styles.usage}>{usageText(tag)}</span>
              <div className={styles.actions}>
                <Button variant="plain" iconOnly aria-label={`编辑标签 ${tag.name}`} onClick={() => openEditor({ mode: "edit", tag })}>
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  variant="plain"
                  iconOnly
                  aria-label={`把标签 ${tag.name} 合并到其他标签`}
                  disabled={state.tags.length < 2}
                  onClick={() => openMerge(tag)}
                >
                  <Merge aria-hidden="true" />
                </Button>
                <Button
                  variant="plainDestructive"
                  iconOnly
                  aria-label={`删除标签 ${tag.name}`}
                  onClick={() => {
                    setDeleteError(undefined);
                    setDeleting(tag);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} title={editing?.mode === "edit" ? "编辑标签" : "新建标签"} onClose={closeEditor}>
        <form className={styles.form} onSubmit={(event) => void save(event)} noValidate>
          <TextField
            label={`${adminLanguageName(tagSourceLocale)}名称`}
            hint="标签的原文名称，后台和中文页面上显示它"
            value={values.name}
            maxLength={50}
            onChange={(event) => setField("name", event.target.value)}
            error={formErrors.name}
            autoFocus
          />
          <TextField
            label="slug"
            hint={
              editing?.mode === "edit"
                ? editing.tag.slug !== normalizeSlug(values.slug) && values.slug.trim() !== ""
                  ? `改了 slug 之后，旧的标签页网址 /tags/${editing.tag.slug} 会失效（不会自动跳转）`
                  : `标签页的网址 /tags/${editing.tag.slug}：小写字母、数字和连字符`
                : "标签页的网址：小写字母、数字和连字符；英文名称留空会自动生成"
            }
            value={values.slug}
            placeholder={suggestedSlug || "如 frontend"}
            maxLength={200}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setField("slug", event.target.value)}
            onBlur={() => setValues((prev) => ({ ...prev, slug: normalizeSlug(prev.slug) }))}
            error={formErrors.slug}
          />
          <fieldset className={styles.translations}>
            <legend className={styles.translationsLegend}>其他语言的名称</legend>
            <p className={styles.note}>前台各语言的页面显示对应的名称，每种语言都要填。</p>
            <div className={styles.translateRow}>
              <Button variant="secondary" busy={translating} disabled={!translationConfig?.available || values.name.trim() === ""} onClick={() => void translate()}>
                <Sparkles aria-hidden="true" />
                {translationConfig?.available ? `用 ${modelDisplayName(translationConfig.tagModel)} 翻译` : "自动翻译"}
              </Button>
              <p role="status" className={translateStatus?.kind === "error" ? styles.translateError : styles.note}>
                {translateStatus?.text ??
                  configError ??
                  (translationConfig && !translationConfig.available ? unavailableReasonNotes[translationConfig.reason] : "")}
              </p>
            </div>
            {tagTranslationLocales.map((locale) => (
              <TextField
                key={locale}
                label={`${adminLanguageName(locale)}名称`}
                lang={locale}
                value={values.translations[locale] ?? ""}
                maxLength={50}
                readOnly={translating}
                onChange={(event) => setTranslation(locale, event.target.value)}
                error={formErrors.translations?.[locale]}
              />
            ))}
          </fieldset>
          {editing?.mode === "edit" && editing.tag.publishedCount > 0 && (
            <p className={styles.note}>保存后会刷新用到它的 {editing.tag.publishedCount} 篇已发布文章。</p>
          )}
          {formErrors.form && <Banner title="保存失败">{formErrors.form}</Banner>}
          <Button type="submit" variant="primary" busy={saving}>
            {editing?.mode === "edit" ? "保存" : "创建"}
          </Button>
        </form>
      </Dialog>

      <Dialog open={merging !== null} title={`合并标签「${merging?.name ?? ""}」`} onClose={() => setMerging(null)}>
        <form className={styles.form} onSubmit={(event) => void merge(event)}>
          <label className={styles.selectField}>
            <span className={styles.selectLabel}>合并到</span>
            <select value={mergeInto} onChange={(event) => setMergeInto(event.target.value)} required>
              <option value="" disabled>
                选择一个标签
              </option>
              {mergeTargets.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}（{tag.slug}）
                </option>
              ))}
            </select>
          </label>
          <p className={styles.note}>
            {merging && merging.postCount > 0
              ? `用到「${merging.name}」的 ${merging.postCount} 篇文章会改用${mergeTarget ? `「${mergeTarget.name}」` : "所选标签"}，然后删除「${merging.name}」。`
              : `「${merging?.name ?? ""}」没有文章使用，合并等于直接删除它。`}
          </p>
          {mergeError && <Banner title="合并失败">{mergeError}</Banner>}
          <Button type="submit" variant="primary" busy={mergeBusy} disabled={!mergeInto}>
            合并
          </Button>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title={`删除标签「${deleting?.name ?? ""}」？`}
        confirmLabel="删除"
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      >
        {deleting && deleting.postCount > 0
          ? `它会从 ${deleting.postCount} 篇文章上移除，文章本身不受影响。想换成别的标签请用“合并”。`
          : "没有文章使用这个标签。"}
      </ConfirmDialog>
    </div>
  );
}
