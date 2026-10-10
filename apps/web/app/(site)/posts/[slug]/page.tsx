import { slugSchema } from "@blog/shared";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/PageLayout";
import { RecentPosts } from "@/components/RecentPosts";
import { SidebarSection } from "@/components/SidebarSection";
import { Comments } from "@/components/comments/Comments";
import { TagList } from "@/components/TagList";
import { ViewCounter } from "@/components/ViewCounter";
import { formatDate } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { getPublishedPost, listAllPublishedPosts, listPublishedPosts } from "@/lib/posts";
import prose from "@/components/Prose.module.css";
import styles from "./page.module.css";

type Props = { params: Promise<{ slug: string }> };

// ISR：构建时预生成已有文章；之后新发布的 slug 在第一次被访问时生成并缓存（dynamicParams 默认为 true），
// 不用重新部署。内容更新靠 API 写入后按标签通知失效（见 lib/posts.ts、app/hooks/revalidate）。

export async function generateStaticParams() {
  const posts = await listAllPublishedPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

/**
 * 格式不合法的 slug 不可能存在：直接 404，不请求 API——
 * 否则任何人都能用随意构造的地址让服务器不断去请求 API。
 */
async function findPost(slug: string) {
  return slugSchema.safeParse(slug).success ? getPublishedPost(slug) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await findPost(slug);
  if (!post) return {};

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      type: "article",
      title: post.title,
      publishedTime: post.publishedAt,
      tags: post.tags.map((tag) => tag.name),
    },
  };
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const post = await findPost(slug);
  if (!post) notFound();

  const [html, allPosts] = await Promise.all([
    // html 来自 renderMarkdown，已经过 rehype-sanitize 白名单清洗。
    renderMarkdown(post.contentMd),
    listPublishedPosts({ limit: 5 }),
  ]);
  const recent = allPosts.filter((p) => p.slug !== post.slug).slice(0, 4);

  const aside =
    recent.length > 0 ? (
      <SidebarSection title="最近文章">
        <RecentPosts posts={recent} />
      </SidebarSection>
    ) : undefined;

  return (
    <PageLayout aside={aside} asideLabel="更多文章">
      <article>
        <header className={styles.header}>
          <Link href="/" className={styles.back}>
            <ChevronLeft className={styles.backIcon} aria-hidden="true" />
            全部文章
          </Link>
          <h1 className={styles.title}>{post.title}</h1>
          <div className={styles.meta}>
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
            <ViewCounter slug={post.slug} />
            <TagList tags={post.tags} />
          </div>
        </header>

        <div className={prose.prose} dangerouslySetInnerHTML={{ __html: html }} />
      </article>
      {/* 评论在浏览器里加载，不进 ISR 页面（见 components/comments/Comments.tsx） */}
      <Comments slug={post.slug} />
    </PageLayout>
  );
}
