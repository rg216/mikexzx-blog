import type { Metadata } from "next";
import Link from "next/link";
import { PageLayout } from "@/components/PageLayout";
import { PostFeed } from "@/components/PostFeed";
import { SidebarSection } from "@/components/SidebarSection";
import { TagSummary } from "@/components/TagSummary";
import { getDictionary } from "@/lib/i18n";
import { pageAlternates } from "@/lib/i18n/alternates";
import { requireLocale } from "@/lib/i18n/params";
import { localePath } from "@/lib/i18n/paths";
import { getFirstPage, listTags } from "@/lib/posts";
import styles from "./page.module.css";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  const locale = requireLocale((await params).lang);
  return { alternates: pageAlternates(locale, "/") };
}

/** 首页：该语言下可见的文章（原文是该语言的，或者有该语言译文的）。第一页进 ISR 页面，后面的由浏览器加载 */
export default async function HomePage({ params }: PageProps<"/[lang]">) {
  const locale = requireLocale((await params).lang);
  const t = getDictionary(locale);
  const [firstPage, tags] = await Promise.all([getFirstPage({ locale }), listTags(locale)]);

  const aside = (
    <>
      <SidebarSection title={t.home.about}>
        <p className={styles.about}>{t.site.description}</p>
        <Link href={localePath(locale, "/about")} className={styles.aboutLink}>
          {t.home.learnMore}
        </Link>
      </SidebarSection>
      {tags.length > 0 && (
        <SidebarSection title={t.home.tags}>
          <TagSummary tags={tags} locale={locale} />
          <Link href={localePath(locale, "/tags")} className={styles.asideLink}>
            {t.home.allTags}
          </Link>
        </SidebarSection>
      )}
      {firstPage.items.length > 0 && (
        <SidebarSection title={t.home.archive}>
          <Link href={localePath(locale, "/archive")} className={styles.asideLink}>
            {t.home.archiveLink}
          </Link>
        </SidebarSection>
      )}
    </>
  );

  return (
    <PageLayout aside={aside} asideLabel={t.home.asideLabel}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.home.title}</h1>
      </header>

      {firstPage.items.length === 0 ? <p className={styles.empty}>{t.home.empty}</p> : <PostFeed initial={firstPage} />}
    </PageLayout>
  );
}
