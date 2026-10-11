import type { Metadata } from "next";
import { TagSummary } from "@/components/TagSummary";
import { getDictionary } from "@/lib/i18n";
import { pageAlternates } from "@/lib/i18n/alternates";
import { requireLocale } from "@/lib/i18n/params";
import { listTags } from "@/lib/posts";
import styles from "./page.module.css";

export async function generateMetadata({ params }: PageProps<"/[lang]/tags">): Promise<Metadata> {
  const locale = requireLocale((await params).lang);
  const t = getDictionary(locale).tags;
  return { title: t.title, description: t.intro, alternates: pageAlternates(locale, "/tags") };
}

/** 标签总览：该语言下有可见文章的标签及篇数（和首页侧栏同一份数据，按篇数排序） */
export default async function TagsPage({ params }: PageProps<"/[lang]/tags">) {
  const locale = requireLocale((await params).lang);
  const t = getDictionary(locale).tags;
  const tags = await listTags(locale);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.title}</h1>
        <p className={styles.intro}>{t.intro}</p>
      </header>
      {tags.length === 0 ? <p className={styles.empty}>{t.empty}</p> : <TagSummary tags={tags} locale={locale} />}
    </div>
  );
}
