import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/PageLayout";
import { RecentPosts } from "@/components/RecentPosts";
import { SidebarSection } from "@/components/SidebarSection";
import { TagList } from "@/components/TagList";
import { formatDate } from "@/lib/format";
import { excerptFromMarkdown, renderMarkdown } from "@/lib/markdown";
import { getPublishedPost, listPublishedPosts } from "@/lib/posts";
import prose from "@/components/Prose.module.css";
import styles from "./page.module.css";

type Props = { params: Promise<{ slug: string }> };

// v0 全部静态生成：构建时就知道所有 slug，其余路径一律 404。
// v3 引入 ISR 后，新发布的文章需要按需生成，届时改为 true。
export const dynamicParams = false;

export async function generateStaticParams() {
  const posts = await listPublishedPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) return {};

  return {
    title: post.title,
    description: excerptFromMarkdown(post.contentMd),
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
  const post = await getPublishedPost(slug);
  if (!post) notFound();

  const [html, allPosts] = await Promise.all([
    // html 来自 renderMarkdown，已经过 rehype-sanitize 白名单清洗。
    renderMarkdown(post.contentMd),
    listPublishedPosts(),
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
            <TagList tags={post.tags} />
          </div>
        </header>

        <div className={prose.prose} dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </PageLayout>
  );
}
