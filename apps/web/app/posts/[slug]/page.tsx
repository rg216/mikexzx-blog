import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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

  // html 来自 renderMarkdown，已经过 rehype-sanitize 白名单清洗。
  const html = await renderMarkdown(post.contentMd);

  return (
    <article>
      <Link href="/" className={styles.back}>
        <ChevronLeft className={styles.backIcon} aria-hidden="true" />
        全部文章
      </Link>

      <header className={styles.header}>
        <h1 className={styles.title}>{post.title}</h1>
        <div className={styles.meta}>
          <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          <TagList tags={post.tags} />
        </div>
      </header>

      <div className={prose.prose} dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
