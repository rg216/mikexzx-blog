import { isLocale, locales, slugSchema } from "@blog/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/PageLayout";
import { PostFeed } from "@/components/PostFeed";
import { SidebarSection } from "@/components/SidebarSection";
import { TagSummary } from "@/components/TagSummary";
import { getDictionary } from "@/lib/i18n";
import { tagAlternates } from "@/lib/i18n/alternates";
import { contentLang } from "@/lib/i18n/content-lang";
import { requireLocale } from "@/lib/i18n/params";
import { localePath } from "@/lib/i18n/paths";
import { emptySearchState } from "@/lib/search";
import { getFirstPage, listTags } from "@/lib/posts";
import styles from "./page.module.css";

type Props = PageProps<"/[lang]/tags/[slug]">;

/*
 * 标签页（ISR）：该语言下带这个标签的文章，第一页进页面，后面的由浏览器按游标加载。
 * 某种语言下这个标签没有可见文章（比如文章都还没有日文译文）时 404——不生成空页面让搜索引擎收录，
 * 和"没有译文的文章不进该语言列表"一致。数据和首页侧栏的标签统计是同一份（listTags），缓存一起失效。
 */

export async function generateStaticParams({ params }: { params: { lang: string } }) {
  if (!isLocale(params.lang)) return [];
  return (await listTags(params.lang)).map((tag) => ({ slug: tag.slug }));
}

/** 该语言下的这个标签；格式不合法或没有可见文章时 null（不合法的 slug 不请求 API） */
async function findTag(slug: string, locale: Parameters<typeof listTags>[0]) {
  if (!slugSchema.safeParse(slug).success) return null;
  return (await listTags(locale)).find((tag) => tag.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  const locale = requireLocale(lang);
  const tag = await findTag(slug, locale);
  if (!tag) return {};
  // hreflang 只列这个标签有文章的语言
  const visibleIn = (await Promise.all(locales.map(async (l) => ((await findTag(slug, l)) ? l : null)))).filter((l) => l !== null);
  return { title: tag.name, description: getDictionary(locale).tags.description(tag.name), alternates: tagAlternates(locale, slug, visibleIn) };
}

export default async function TagPage({ params }: Props) {
  const { lang, slug } = await params;
  const locale = requireLocale(lang);
  const [tags, firstPage] = await Promise.all([listTags(locale), getFirstPage({ locale, tag: slug })]);
  const tag = slugSchema.safeParse(slug).success ? tags.find((t) => t.slug === slug) : undefined;
  if (!tag || firstPage.items.length === 0) notFound();

  const t = getDictionary(locale);
  const others = tags.filter((other) => other.slug !== slug);
  const aside =
    others.length > 0 ? (
      <SidebarSection title={t.tags.allTags}>
        <TagSummary tags={others} locale={locale} />
        <Link href={localePath(locale, "/tags")} className={styles.asideLink}>
          {t.tags.allTags}
        </Link>
      </SidebarSection>
    ) : undefined;

  return (
    <PageLayout aside={aside} asideLabel={t.tags.allTags}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{t.tags.eyebrow}</p>
        {/* 还没有译名的标签显示原文名称：标上它的语言 */}
        <h1 className={styles.title} lang={contentLang(tag.locale, locale)}>
          {tag.name}
        </h1>
        <p className={styles.count}>{t.tags.postCount(tag.count)}</p>
      </header>
      <PostFeed initial={firstPage} filter={{ ...emptySearchState, tags: [slug] }} />
    </PageLayout>
  );
}
