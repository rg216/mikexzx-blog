import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLayout } from "@/components/PageLayout";
import { SearchField, SearchView } from "@/components/search/SearchView";
import { getDictionary } from "@/lib/i18n";
import { pageAlternates } from "@/lib/i18n/alternates";
import { requireLocale } from "@/lib/i18n/params";
import styles from "./page.module.css";

export async function generateMetadata({ params }: PageProps<"/[lang]/search">): Promise<Metadata> {
  const locale = requireLocale((await params).lang);
  // 搜索结果页没有独立内容，不让搜索引擎收录；各语言版本仍互相标注
  return { title: getDictionary(locale).search.title, robots: { index: false }, alternates: pageAlternates(locale, "/search") };
}

/**
 * 页面本身是静态的（构建时每种语言各生成一份），搜索在浏览器里进行，搜的是当前语言的索引。
 * SearchView 读取地址栏的 ?q=，构建时不知道它的值，所以要包在 Suspense 里：
 * 预渲染时输出 fallback（一个同样的输入框），浏览器里再换成真正的组件。
 */
export default async function SearchPage({ params }: PageProps<"/[lang]/search">) {
  const t = getDictionary(requireLocale((await params).lang)).search;
  return (
    <PageLayout>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.title}</h1>
      </header>
      <Suspense fallback={<SearchField disabled />}>
        <SearchView />
      </Suspense>
    </PageLayout>
  );
}
