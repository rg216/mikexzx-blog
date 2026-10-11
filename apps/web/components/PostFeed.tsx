"use client";

import type { PostSummary, PostSummaryPage } from "@blog/shared";
import { useRef, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { useDictionary, useLocale } from "@/lib/i18n/client";
import { POSTS_PER_PAGE } from "@/lib/pagination";
import { browsePosts, emptySearchState, SearchError, type SearchState, searchErrorText } from "@/lib/search";
import styles from "./PostFeed.module.css";
import { PostListItem } from "./PostListItem";

type Props = {
  /** 第一页：服务端渲染进 ISR 页面（首页、标签页），或者搜索页刚查到的 */
  initial: PostSummaryPage;
  /** 加载后面几页时带的条件（标签页是那个标签，搜索页是用户选的条件） */
  filter?: SearchState;
  /** 列表的无障碍名称 */
  label?: string;
};

/**
 * 文章列表 + "加载更多"。为什么不做 /page/2 这样的页码网址：
 * - 页码网址会随新文章发布整体错位（第 2 页的内容每发一篇就变），对读者、对搜索引擎都不稳定；
 * - 搜索引擎要发现全部文章，靠的是归档页（/archive 一页列出所有文章）和每个标签页的第一页，不靠翻页；
 * - 游标分页在 API 里已经有了，数据库查询也比 OFFSET 便宜（沿索引直接定位，不用数过前面的行）。
 * 代价：第 2 页以后没有可以分享的网址。对个人博客，分享的是文章，不是列表的某一页。
 */
export function PostFeed({ initial, filter = emptySearchState, label }: Props) {
  const locale = useLocale();
  const dictionary = useDictionary();
  const t = dictionary.feed;
  const [items, setItems] = useState<PostSummary[]>(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "error"; reason: SearchError["reason"] }>({ kind: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  async function loadMore() {
    if (!cursor || state.kind === "loading") return;
    setState({ kind: "loading" });
    try {
      const page = await browsePosts({ locale, filter, cursor, limit: POSTS_PER_PAGE });
      const firstNew = items.length;
      // 和已显示的去重：两次加载之间发布或撤回了文章时，游标前后可能有重叠
      const shown = new Set(items.map((post) => post.slug));
      setItems([...items, ...page.items.filter((post) => !shown.has(post.slug))]);
      setCursor(page.nextCursor);
      setState({ kind: "idle" });
      setAnnouncement(t.loaded(page.items.length));
      // 键盘用户接着读新加载的第一篇（按钮可能随最后一页消失，焦点不能丢回 <body>）
      requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLAnchorElement>("li a")[firstNew]?.focus());
    } catch (error) {
      setState({ kind: "error", reason: error instanceof SearchError ? error.reason : "unavailable" });
    }
  }

  return (
    <>
      <ol ref={listRef} className={styles.list} aria-label={label}>
        {items.map((post) => (
          <li key={post.slug} className={styles.item}>
            <PostListItem post={post} locale={locale} />
          </li>
        ))}
      </ol>
      {state.kind === "error" && <Banner title={t.errorTitle}>{searchErrorText(dictionary.search.errors, state.reason)}</Banner>}
      {cursor && (
        <div className={styles.more}>
          <Button variant="secondary" busy={state.kind === "loading"} onClick={() => void loadMore()}>
            {state.kind === "error" ? t.retry : t.loadMore}
          </Button>
        </div>
      )}
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
    </>
  );
}
