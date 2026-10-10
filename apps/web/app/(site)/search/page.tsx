import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLayout } from "@/components/PageLayout";
import { SearchField, SearchView } from "@/components/search/SearchView";
import styles from "./page.module.css";

// 搜索结果页没有独立内容，不让搜索引擎收录
export const metadata: Metadata = { title: "搜索", robots: { index: false } };

/**
 * 页面本身是静态的（构建时生成），搜索在浏览器里进行。
 * SearchView 读取地址栏的 ?q=，构建时不知道它的值，所以要包在 Suspense 里：
 * 预渲染时输出 fallback（一个同样的输入框），浏览器里再换成真正的组件。
 */
export default function SearchPage() {
  return (
    <PageLayout>
      <header className={styles.header}>
        <h1 className={styles.title}>搜索</h1>
      </header>
      <Suspense fallback={<SearchField disabled />}>
        <SearchView />
      </Suspense>
    </PageLayout>
  );
}
