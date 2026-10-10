import type { PostSummary, Tag } from "@blog/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/format";
import styles from "./PostListItem.module.css";
import { TagList } from "./TagList";

type PostCardProps = {
  slug: string;
  /** 标题和摘要可以是带高亮的节点（搜索结果） */
  title: ReactNode;
  excerpt: ReactNode;
  publishedAt: string | null;
  tags: Tag[];
};

/** 文章卡片：首页列表和搜索结果共用 */
export function PostCard({ slug, title, excerpt, publishedAt, tags }: PostCardProps) {
  return (
    <article className={styles.card}>
      <h2 className={styles.title}>
        {/* 整张卡片可点击，但 DOM 里只有一个链接：链接的 ::after 铺满卡片。
            读屏软件只读到标题文字，不会把摘要、日期全塞进链接名里。 */}
        <Link href={`/posts/${slug}`} className={styles.link}>
          {title}
        </Link>
      </h2>
      <p className={styles.excerpt}>{excerpt}</p>
      <div className={styles.meta}>
        {publishedAt && <time dateTime={publishedAt}>{formatDate(publishedAt)}</time>}
        <TagList tags={tags} />
      </div>
    </article>
  );
}

export function PostListItem({ post }: { post: PostSummary }) {
  return <PostCard slug={post.slug} title={post.title} excerpt={post.excerpt} publishedAt={post.publishedAt} tags={post.tags} />;
}
