"use client";

import { type HighlightedText, localeInfo, type PostSummaryPage, type SearchHit } from "@blog/shared";
import { useSearchParams } from "next/navigation";
import { type ComponentProps, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { PostFeed } from "@/components/PostFeed";
import { PostCard } from "@/components/PostListItem";
import { Banner } from "@/components/ui/Banner";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { splitHighlights } from "@/lib/highlight";
import { useDictionary, useLocale } from "@/lib/i18n/client";
import { contentLang } from "@/lib/i18n/content-lang";
import { localePath } from "@/lib/i18n/paths";
import { POSTS_PER_PAGE } from "@/lib/pagination";
import {
  browsePosts,
  fetchFilterOptions,
  type FilterOptions,
  hasFilters,
  SEARCH_QUERY_MAX_LENGTH,
  SearchError,
  searchErrorText,
  searchPosts,
  type SearchState,
  searchStateFromParams,
  searchStateToParams,
} from "@/lib/search";
import styles from "./SearchView.module.css";

/** 停止输入多久之后才发请求：太短每个字都发一次，太长显得迟钝 */
const DEBOUNCE_MS = 250;

/**
 * 一次请求的结果，key 是发出请求时的条件：
 * - 有关键词：按相关度的前 20 条（带高亮）；
 * - 只有筛选条件：按发布时间倒序的第一页，后面的由 PostFeed 按游标加载。
 */
type Result =
  | { key: string; kind: "hits"; items: SearchHit[] }
  | { key: string; kind: "page"; page: PostSummaryPage }
  | { key: string; kind: "error"; reason: SearchError["reason"] };

function Highlighted({ value }: { value: HighlightedText }) {
  return splitHighlights(value).map((part, i) => (
    <Fragment key={i}>{part.highlighted ? <mark className={styles.mark}>{part.text}</mark> : part.text}</Fragment>
  ));
}

/** 搜索框。SearchView 加载前（Suspense fallback）也渲染同样的输入框，页面不会跳动 */
export function SearchField(props: Omit<ComponentProps<typeof TextField>, "label">) {
  const t = useDictionary().search;
  return (
    <form role="search" className={styles.form} onSubmit={(event) => event.preventDefault()}>
      <TextField
        type="search"
        label={t.fieldLabel}
        hideLabel
        placeholder={t.placeholder}
        hint={t.hint}
        enterKeyHint="search"
        autoComplete="off"
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        {...props}
      />
    </form>
  );
}

/**
 * 边输入边搜：停止输入 250ms 后请求，新请求发出时取消旧的（AbortController），慢的旧响应不会覆盖新结果。
 * 关键词和筛选条件（标签、月份）同步到地址栏（?q=&tags=&from=&to=），刷新、分享链接、从文章页返回都能回到同一个搜索。
 * 没有关键词、只有筛选条件时按条件浏览：走列表接口，按时间倒序，可以加载更多。
 * 组合条件只在这个不被收录的页面里出现，不生成可收录的组合网址（见 CLAUDE.md 的 v4.6）。
 */
export function SearchView() {
  const locale = useLocale();
  const t = useDictionary().search;
  // 地址栏里的参数只用作初始值，之后以页面上的状态为准
  const searchParams = useSearchParams();
  const [state, setState] = useState<SearchState>(() => searchStateFromParams(new URLSearchParams(searchParams.toString())));
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstRun = useRef(true);

  const query = state.q.trim();
  const filtered = hasFilters(state);
  const key = JSON.stringify([query, state.tags, state.from, state.to]);

  useEffect(() => {
    const controller = new AbortController();
    fetchFilterOptions({ locale, signal: controller.signal }).then(setOptions, () => {
      // 选项读不出来时不显示筛选器，关键词搜索照常
      if (!controller.signal.aborted) setOptions({ tags: [], months: [] });
    });
    return () => controller.abort();
  }, [locale]);

  useEffect(() => {
    // 条件从 key 里取：effect 只依赖 key，输入框里加个空格（key 不变）不会重新请求
    const [q, tags, from, to] = JSON.parse(key) as [string, string[], string, string];
    const current: SearchState = { q, tags, from, to };
    // replaceState 而不是 pushState：不为每个字留一条历史记录。Next 会把它同步到 useSearchParams
    const path = localePath(locale, "/search");
    const params = searchStateToParams(current);
    window.history.replaceState(null, "", params.size > 0 ? `${path}?${params}` : path);

    // 带着参数打开页面时立即搜索，之后的改动才防抖
    const immediate = firstRun.current;
    firstRun.current = false;
    if (!q && !hasFilters(current)) return;

    const controller = new AbortController();
    const signal = controller.signal;
    // 到时间才发请求（防抖期间又改了条件，这次就不发了）
    const run = () =>
      q
        ? searchPosts(q, { locale, filter: current, signal }).then((items): Result => ({ key, kind: "hits", items }))
        : browsePosts({ locale, filter: current, limit: POSTS_PER_PAGE, signal }).then((page): Result => ({ key, kind: "page", page }));
    const timer = setTimeout(
      () => {
        run().then(setResult).catch((error: unknown) => {
          if (signal.aborted) return;
          setResult({ key, kind: "error", reason: error instanceof SearchError ? error.reason : "unavailable" });
        });
      },
      immediate ? 0 : DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, locale]);

  const active = query !== "" || filtered;
  const pending = active && result?.key !== key;
  // 等新结果时先保留上一次的结果（变淡），列表不会一闪而空
  const shown = active ? result : null;

  let status = "";
  if (shown && !pending) {
    if (shown.kind === "hits") status = shown.items.length > 0 ? t.found(shown.items.length) : t.nothingFound(query);
    if (shown.kind === "page") status = shown.page.items.length > 0 ? t.filtered : t.nothingFiltered;
  }

  return (
    <>
      <SearchField
        ref={inputRef}
        value={state.q}
        onChange={(event) => setState((prev) => ({ ...prev, q: event.target.value }))}
        onKeyDown={(event) => {
          // 手机上按"搜索"键收起键盘，露出结果
          if (event.key === "Enter") inputRef.current?.blur();
        }}
        // 专门打开搜索页就是为了输入；带着条件进来（比如从文章页返回）时不抢焦点，免得手机弹出键盘挡住结果
        autoFocus={!active}
      />

      {options && (options.tags.length > 0 || options.months.length > 0) && (
        <SearchFilters state={state} options={options} onChange={(next) => setState((prev) => ({ ...prev, ...next }))} />
      )}

      <div className={styles.statusRow}>
        {/* 始终在 DOM 里：role="status" 的内容变化才会被读屏播报 */}
        <p role="status" className={styles.status}>
          {status}
        </p>
        {pending && <Spinner className={styles.spinner} />}
      </div>

      {shown?.kind === "error" && <Banner title={t.errorTitle}>{searchErrorText(t.errors, shown.reason)}</Banner>}

      {shown?.kind === "hits" && shown.items.length > 0 && (
        <ol className={styles.list} aria-busy={pending} data-stale={pending || undefined}>
          {shown.items.map((hit) => (
            <li key={hit.slug} className={styles.item}>
              <PostCard
                slug={hit.slug}
                title={<Highlighted value={hit.title} />}
                excerpt={<Highlighted value={hit.snippet} />}
                publishedAt={hit.publishedAt}
                tags={hit.tags}
                locale={locale}
              />
            </li>
          ))}
        </ol>
      )}

      {shown?.kind === "page" && shown.page.items.length > 0 && (
        <div className={styles.feed} aria-busy={pending} data-stale={pending || undefined}>
          {/* key：条件变了就是一个新的列表，已经加载的后几页作废 */}
          <PostFeed key={shown.key} initial={shown.page} filter={state} />
        </div>
      )}
    </>
  );
}

/** 筛选器：标签（可多选，需全部满足）、起止月份 */
function SearchFilters({ state, options, onChange }: { state: SearchState; options: FilterOptions; onChange: (next: Partial<SearchState>) => void }) {
  const locale = useLocale();
  const t = useDictionary().search.filters;
  const monthFormatter = useMemo(() => new Intl.DateTimeFormat(localeInfo[locale].tag, { year: "numeric", month: "long", timeZone: "UTC" }), [locale]);
  const monthLabel = (key: string) => monthFormatter.format(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 15));

  function toggleTag(slug: string) {
    onChange({ tags: state.tags.includes(slug) ? state.tags.filter((tag) => tag !== slug) : [...state.tags, slug] });
  }

  // 地址里带着、但选项里没有的月份（比如那个月的文章撤回了）也留在下拉框里，否则选中状态会对不上
  const months = (value: string) => (value && !options.months.includes(value) ? [value, ...options.months] : options.months);

  return (
    <fieldset className={styles.filters}>
      <legend className="visually-hidden">{t.label}</legend>
      {options.tags.length > 0 && (
        <div className={styles.filterGroup} role="group" aria-label={t.tags} aria-describedby="search-tags-hint">
          <p id="search-tags-hint" className="visually-hidden">
            {t.tagsHint}
          </p>
          {options.tags.map((tag) => (
            <button
              key={tag.slug}
              type="button"
              className={styles.chip}
              aria-pressed={state.tags.includes(tag.slug)}
              lang={contentLang(tag.locale, locale)}
              onClick={() => toggleTag(tag.slug)}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}
      {options.months.length > 0 && (
        <div className={styles.monthRow}>
          <label className={styles.select}>
            <span className={styles.selectLabel}>{t.from}</span>
            <select value={state.from} onChange={(event) => onChange({ from: event.target.value })}>
              <option value="">{t.anyMonth}</option>
              {months(state.from).map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.select}>
            <span className={styles.selectLabel}>{t.to}</span>
            <select value={state.to} onChange={(event) => onChange({ to: event.target.value })}>
              <option value="">{t.anyMonth}</option>
              {months(state.to).map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {hasFilters(state) && (
        <button type="button" className={styles.clear} onClick={() => onChange({ tags: [], from: "", to: "" })}>
          {t.clear}
        </button>
      )}
    </fieldset>
  );
}
