import type { Metadata } from "next";
import Link from "next/link";
import { formatArchiveDay, groupArchive } from "@/lib/archive";
import { getDictionary } from "@/lib/i18n";
import { pageAlternates } from "@/lib/i18n/alternates";
import { contentLang } from "@/lib/i18n/content-lang";
import { requireLocale } from "@/lib/i18n/params";
import { postPath } from "@/lib/i18n/paths";
import { listArchive } from "@/lib/posts";
import styles from "./page.module.css";

export async function generateMetadata({ params }: PageProps<"/[lang]/archive">): Promise<Metadata> {
  const locale = requireLocale((await params).lang);
  return { title: getDictionary(locale).archive.title, alternates: pageAlternates(locale, "/archive") };
}

/**
 * 归档（ISR）：该语言下的全部文章，按年、月分组，一页列完。
 * 列表页只有"加载更多"、没有页码网址，搜索引擎靠这一页和标签页发现所有文章。
 */
export default async function ArchivePage({ params }: PageProps<"/[lang]/archive">) {
  const locale = requireLocale((await params).lang);
  const t = getDictionary(locale).archive;
  const items = await listArchive(locale);
  const years = groupArchive(items, locale);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.title}</h1>
        <p className={styles.intro}>{items.length > 0 ? t.intro(items.length) : t.empty}</p>
      </header>
      {years.map((year) => (
        <section key={year.year} className={styles.year} aria-labelledby={`year-${year.year}`}>
          <h2 id={`year-${year.year}`} className={styles.yearTitle}>
            {year.label}
          </h2>
          {year.months.map((month) => (
            <section key={month.key} className={styles.month} aria-labelledby={`month-${month.key}`}>
              <h3 id={`month-${month.key}`} className={styles.monthTitle}>
                {month.label}
                <span className={styles.monthCount}>{t.monthCount(month.items.length)}</span>
              </h3>
              <ol className={styles.list}>
                {month.items.map((item) => (
                  <li key={item.slug} className={styles.item}>
                    <time dateTime={item.publishedAt} className={styles.day}>
                      {formatArchiveDay(item.publishedAt, locale)}
                    </time>
                    {/* 文章在这种语言下的版本；用原文时（原文语言就是页面语言）lang 不变 */}
                    <Link href={postPath(locale, item.slug)} className={styles.link} lang={contentLang(item.locale, locale)}>
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </section>
      ))}
    </div>
  );
}
