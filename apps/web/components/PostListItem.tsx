import type { PostSummary } from "@blog/shared";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import styles from "./PostListItem.module.css";
import { TagList } from "./TagList";

export function PostListItem({ post }: { post: PostSummary }) {
  return (
    <article className={styles.card}>
      <h2 className={styles.title}>
        {/* 整张卡片可点击，但 DOM 里只有一个链接：链接的 ::after 铺满卡片。
            读屏软件只读到标题文字，不会把摘要、日期全塞进链接名里。 */}
        <Link href={`/posts/${post.slug}`} className={styles.link}>
          {post.title}
        </Link>
      </h2>
      <p className={styles.excerpt}>{post.excerpt}</p>
      <div className={styles.meta}>
        {post.publishedAt && <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>}
        <TagList tags={post.tags} />
      </div>
    </article>
  );
}
