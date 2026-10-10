"use client";

import type { HighlightedText, SearchHit } from "@blog/shared";
import { useSearchParams } from "next/navigation";
import { type ComponentProps, Fragment, useEffect, useRef, useState } from "react";
import { PostCard } from "@/components/PostListItem";
import { Banner } from "@/components/ui/Banner";
import { Spinner } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { splitHighlights } from "@/lib/highlight";
import { SearchError, searchPosts } from "@/lib/search";
import styles from "./SearchView.module.css";

/** 停止输入多久之后才发请求：太短每个字都发一次，太长显得迟钝 */
const DEBOUNCE_MS = 250;

type Result = { query: string; items: SearchHit[] } | { query: string; error: string };

function Highlighted({ value }: { value: HighlightedText }) {
  return splitHighlights(value).map((part, i) => (
    <Fragment key={i}>{part.highlighted ? <mark className={styles.mark}>{part.text}</mark> : part.text}</Fragment>
  ));
}

/** 搜索框。SearchView 加载前（Suspense fallback）也渲染同样的输入框，页面不会跳动 */
export function SearchField(props: Omit<ComponentProps<typeof TextField>, "label">) {
  return (
    <form role="search" className={styles.form} onSubmit={(event) => event.preventDefault()}>
      <TextField
        type="search"
        label="搜索文章"
        hideLabel
        placeholder="搜索文章"
        hint="匹配标题、正文和标签"
        enterKeyHint="search"
        autoComplete="off"
        {...props}
      />
    </form>
  );
}

/**
 * 边输入边搜：停止输入 250ms 后请求，新请求发出时取消旧的（AbortController），慢的旧响应不会覆盖新结果。
 * 查询词同步到地址栏（?q=），刷新、分享链接、从文章页返回都能回到同一个搜索。
 */
export function SearchView() {
  // 地址栏里的 q 只用作输入框的初始值，之后以输入框为准
  const initialQuery = useSearchParams().get("q") ?? "";
  const [input, setInput] = useState(initialQuery);
  const [result, setResult] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstRun = useRef(true);
  const query = input.trim();

  useEffect(() => {
    // replaceState 而不是 pushState：不为每个字留一条历史记录。Next 会把它同步到 useSearchParams
    window.history.replaceState(null, "", query ? `/search?${new URLSearchParams({ q: query })}` : "/search");

    // 带着 ?q= 打开页面时立即搜索，之后的输入才防抖
    const immediate = firstRun.current;
    firstRun.current = false;
    if (!query) return;

    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        searchPosts(query, { signal: controller.signal })
          .then((items) => setResult({ query, items }))
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            setResult({ query, error: error instanceof SearchError ? error.message : "搜索暂时不可用，请稍后重试" });
          });
      },
      immediate ? 0 : DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const pending = query !== "" && result?.query !== query;
  // 等新结果时先保留上一次的结果（变淡），列表不会一闪而空
  const shown = query ? result : null;
  const status = shown && !pending && "items" in shown ? (shown.items.length > 0 ? `找到 ${shown.items.length} 篇文章` : `没有找到与“${query}”相关的文章`) : "";

  return (
    <>
      <SearchField
        ref={inputRef}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          // 手机上按"搜索"键收起键盘，露出结果
          if (event.key === "Enter") inputRef.current?.blur();
        }}
        // 专门打开搜索页就是为了输入；带着查询词进来（比如从文章页返回）时不抢焦点，免得手机弹出键盘挡住结果
        autoFocus={input === ""}
      />

      <div className={styles.statusRow}>
        {/* 始终在 DOM 里：role="status" 的内容变化才会被读屏播报 */}
        <p role="status" className={styles.status}>
          {status}
        </p>
        {pending && <Spinner className={styles.spinner} />}
      </div>

      {shown && "error" in shown && <Banner title="搜索失败">{shown.error}</Banner>}

      {shown && "items" in shown && shown.items.length > 0 && (
        <ol className={styles.list} aria-busy={pending} data-stale={pending || undefined}>
          {shown.items.map((hit) => (
            <li key={hit.slug} className={styles.item}>
              <PostCard
                slug={hit.slug}
                title={<Highlighted value={hit.title} />}
                excerpt={<Highlighted value={hit.snippet} />}
                publishedAt={hit.publishedAt}
                tags={hit.tags}
              />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
