import { isLocale, localeInfo, slugSchema, type Locale } from "@blog/shared";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/PageLayout";
import { RecentPosts } from "@/components/RecentPosts";
import { SidebarSection } from "@/components/SidebarSection";
import { Comments } from "@/components/comments/Comments";
import { CoverHero } from "@/components/CoverImage";
import { TagList } from "@/components/TagList";
import { TranslationNotice } from "@/components/TranslationNotice";
import { ViewCounter } from "@/components/ViewCounter";
import { ogImageOf } from "@/lib/cover";
import { formatDate } from "@/lib/format";
import { getDictionary } from "@/lib/i18n";
import { postAlternates } from "@/lib/i18n/alternates";
import { contentLang } from "@/lib/i18n/content-lang";
import { requireLocale } from "@/lib/i18n/params";
import { localePath } from "@/lib/i18n/paths";
import { renderMarkdown } from "@/lib/markdown";
import { postNotice } from "@/lib/post-notice";
import { ogBase } from "@/lib/root-metadata";
import { getPublishedPost, listAllPublishedPosts, listPublishedPosts } from "@/lib/posts";
import prose from "@/components/Prose.module.css";
import styles from "./page.module.css";

type Props = PageProps<"/[lang]/posts/[slug]">;

/*
 * ISR：构建时每种语言预生成"该语言可见的文章"（原文是该语言的，或者有该语言译文的）。
 * 没有译文的文章不预生成该语言的页面，但直接访问仍会按需生成（dynamicParams 默认为 true）：显示原文 + 提示。
 * 之后新发布的 slug 同样在第一次被访问时生成并缓存，不用重新部署。
 * 内容更新靠 API 写入后按标签（post:<slug>:<locale>）通知失效（见 lib/posts.ts、app/hooks/revalidate）。
 */

export async function generateStaticParams({ params }: { params: { lang: string } }) {
  if (!isLocale(params.lang)) return [];
  const posts = await listAllPublishedPosts(params.lang);
  return posts.map((post) => ({ slug: post.slug }));
}

/**
 * 格式不合法的 slug 不可能存在：直接 404，不请求 API——
 * 否则任何人都能用随意构造的地址让服务器不断去请求 API。
 */
async function findPost(slug: string, locale: Locale) {
  return slugSchema.safeParse(slug).success ? getPublishedPost(slug, locale) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  const locale = requireLocale(lang);
  const post = await findPost(slug, locale);
  if (!post) return {};

  return {
    title: post.title,
    description: post.excerpt,
    // hreflang 只列真实存在的语言版本；显示原文时 canonical 指向原文网址
    alternates: postAlternates(post),
    openGraph: {
      // 展开布局的公共字段（site_name 等）：页面的 openGraph 会整个替换布局的。locale 用实际显示的内容的语言
      ...ogBase(post.locale),
      // 与 hreflang 一致，只列真实存在的其他语言版本
      alternateLocale: post.availableLocales.filter((l) => l !== post.locale).map((l) => localeInfo[l].ogLocale),
      type: "article",
      title: post.title,
      publishedTime: post.publishedAt,
      tags: post.tags.map((tag) => tag.name),
      // 分享卡片的配图：头图（没有就不设，社交平台显示无图的卡片）
      ...(post.cover && { images: [ogImageOf(post.cover)] }),
    },
    // X（Twitter）有图时用大图卡片。标题、描述它会回退读 og:*，图片也显式给出
    ...(post.cover && { twitter: { card: "summary_large_image", images: [ogImageOf(post.cover).url] } }),
  };
}

export default async function PostPage({ params }: Props) {
  const { lang, slug } = await params;
  const locale = requireLocale(lang);
  const post = await findPost(slug, locale);
  if (!post) notFound();

  const t = getDictionary(locale);
  const [html, latest] = await Promise.all([
    // html 来自 renderMarkdown，已经过 rehype-sanitize 白名单清洗。脚注文字跟着正文的语言
    renderMarkdown(post.contentMd, { images: post.images, locale: post.locale }),
    listPublishedPosts({ limit: 5, locale }),
  ]);
  const recent = latest.filter((p) => p.slug !== post.slug).slice(0, 4);
  const notice = postNotice(post, locale);
  // 显示原文（该语言没有译文）时，标题和正文是另一种语言：标上 lang，读屏换发音、浏览器换字形和字体。
  // 只标内容本身，不标整个 <article>：返回链接、日期这些界面文字仍是页面语言
  const postLang = contentLang(post.locale, locale);

  const aside =
    recent.length > 0 ? (
      <SidebarSection title={t.post.recent}>
        <RecentPosts posts={recent} locale={locale} />
      </SidebarSection>
    ) : undefined;

  return (
    <PageLayout aside={aside} asideLabel={t.post.asideLabel}>
      <article>
        <header className={styles.header}>
          <Link href={localePath(locale, "/")} className={styles.back}>
            <ChevronLeft className={styles.backIcon} aria-hidden="true" />
            {t.post.allPosts}
          </Link>
          <h1 className={styles.title} lang={postLang}>
            {post.title}
          </h1>
          <div className={styles.meta}>
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt, locale)}</time>
            <ViewCounter slug={post.slug} />
            <TagList tags={post.tags} locale={locale} linked />
          </div>
        </header>

        {post.cover && <CoverHero cover={post.cover} />}

        {notice && <TranslationNotice notice={notice} slug={post.slug} locale={locale} />}

        <div className={prose.prose} lang={postLang} dangerouslySetInnerHTML={{ __html: html }} />
      </article>
      {/* 评论不分语言，各语言版本共用同一组评论；在浏览器里加载，不进 ISR 页面（见 components/comments/Comments.tsx） */}
      <Comments slug={post.slug} />
    </PageLayout>
  );
}
