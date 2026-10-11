"use client";

import { type AdminTag, MAX_POST_TAGS, type Tag } from "@blog/shared";
import { CircleAlert, ExternalLink, Plus, X } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { adminApi, AdminApiError } from "@/lib/admin-api";
import { tagSuggestions } from "@/lib/tag-form";
import styles from "./TagPicker.module.css";

/** 没有输入筛选词时最多列出的候选标签数 */
const SUGGESTION_LIMIT = 24;

type Props = {
  tags: Tag[];
  onChange: (tags: Tag[]) => void;
  /** 服务端 / 提交前校验返回的错误 */
  error?: string;
  /** 指向筛选输入框，提交出错时用来聚焦 */
  inputRef?: RefObject<HTMLInputElement | null>;
};

/**
 * 文章的标签：只能从已有标签里选（新建、改名在 /admin/posts/tags 做——不随手造标签）。
 * 已选的显示成一排可移除的小块，下面是筛选框和可添加的标签；在筛选框里按回车添加第一个匹配项。
 */
export function TagPicker({ tags, onChange, error, inputRef }: Props) {
  const [all, setAll] = useState<AdminTag[] | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [limitError, setLimitError] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const ownRef = useRef<HTMLInputElement>(null);
  const filterRef = inputRef ?? ownRef;
  const errorId = useId();

  useEffect(() => {
    let ignore = false;
    adminApi.listTags().then(
      (list) => {
        if (ignore) return;
        setAll(list);
        setLoadError(undefined);
      },
      (err: unknown) => !ignore && setLoadError(err instanceof AdminApiError ? err.message : "标签加载失败"),
    );
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  // 在新标签页的标签管理里建好标签、切回来时重新取一次，不用刷新编辑器（会丢掉没保存的内容）
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setReloadKey((key) => key + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const selectedSlugs = tags.map((tag) => tag.slug);
  const suggestions = all ? tagSuggestions(all, selectedSlugs, query, SUGGESTION_LIMIT) : [];
  const typed = query.trim();
  // 没输入时只列常用的一部分，告诉用户还有多少没列出
  const hiddenCount = all && !typed ? all.filter((tag) => !selectedSlugs.includes(tag.slug)).length - suggestions.length : 0;

  function add(tag: AdminTag) {
    if (tags.length >= MAX_POST_TAGS) {
      setLimitError(`最多 ${MAX_POST_TAGS} 个标签`);
      return;
    }
    onChange([...tags, { slug: tag.slug, name: tag.name }]);
    setQuery("");
    setLimitError(undefined);
    setAnnouncement(`已添加标签 ${tag.name}`);
    filterRef.current?.focus();
  }

  function remove(target: Tag) {
    onChange(tags.filter((tag) => tag.slug !== target.slug));
    setLimitError(undefined);
    setAnnouncement(`已移除标签 ${target.name}`);
    // 被点的按钮随标签一起消失了，焦点回到输入框
    filterRef.current?.focus();
  }

  /** 在输入框里按回车 = 添加第一个匹配的标签，而不是提交整个表单 */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const [first] = suggestions;
      if (first && typed) add(first);
    }
  }

  const manageLink = (
    <a href="/admin/posts/tags" target="_blank" rel="noopener" className={styles.manage}>
      管理标签
      <ExternalLink className={styles.manageIcon} aria-hidden="true" />
      <span className="visually-hidden">（在新标签页打开）</span>
    </a>
  );

  return (
    <fieldset className={styles.fieldset} aria-describedby={error ? errorId : undefined}>
      <legend className={styles.legend}>标签</legend>

      {tags.length > 0 ? (
        <ul className={styles.tags} aria-label="已添加的标签">
          {tags.map((tag) => (
            <li key={tag.slug} className={styles.tag}>
              <span className={styles.tagName}>{tag.name}</span>
              <Button variant="plain" iconOnly className={styles.remove} aria-label={`移除标签 ${tag.name}`} onClick={() => remove(tag)}>
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.none}>还没有标签。</p>
      )}

      <TextField
        ref={filterRef}
        type="search"
        label="筛选标签"
        hideLabel
        placeholder="筛选标签，回车添加第一个"
        value={query}
        maxLength={50}
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        error={limitError}
        enterKeyHint="done"
        accessory={manageLink}
      />

      {!all && !loadError && (
        <p className={styles.none}>
          <Spinner />
          正在加载标签…
        </p>
      )}
      {loadError && (
        <p className={styles.error}>
          <CircleAlert className={styles.errorIcon} aria-hidden="true" />
          {loadError}
          <Button variant="plain" onClick={() => setReloadKey((key) => key + 1)}>
            重试
          </Button>
        </p>
      )}
      {suggestions.length > 0 && (
        <ul className={styles.suggestions} aria-label="可添加的标签">
          {suggestions.map((tag) => (
            <li key={tag.id}>
              <button type="button" className={styles.suggestion} onClick={() => add(tag)}>
                <Plus className={styles.suggestionIcon} aria-hidden="true" />
                <span className="visually-hidden">添加标签 </span>
                {tag.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 && <p className={styles.none}>还有 {hiddenCount} 个不常用的标签，输入名称筛选。</p>}
      {all && all.length === 0 && <p className={styles.none}>还没有任何标签，先在“管理标签”里新建。</p>}
      {all && all.length > 0 && typed && suggestions.length === 0 && (
        <p className={styles.none}>没有叫“{typed}”的标签。需要的话先在“管理标签”里新建。</p>
      )}

      {error && (
        <p id={errorId} className={styles.error}>
          <CircleAlert className={styles.errorIcon} aria-hidden="true" />
          {error}
        </p>
      )}

      <p role="status" className="visually-hidden">
        {announcement}
      </p>
    </fieldset>
  );
}
