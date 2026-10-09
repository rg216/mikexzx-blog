import type { PostSummary } from "@blog/shared";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import styles from "./RecentPosts.module.css";

/** 侧栏文章列表。现在是"最近文章"，以后的"推荐文章"复用同一个组件，只换数据。 */
export function RecentPosts({ posts }: { posts: PostSummary[] }) {
  return (
    <ul className={styles.list}>
      {posts.map((post) => (
        <li key={post.slug}>
          <Link href={`/posts/${post.slug}`} className={styles.link}>
            <span className={styles.title}>{post.title}</span>
            {post.publishedAt && (
              <time className={styles.date} dateTime={post.publishedAt}>
                {formatDate(post.publishedAt)}
              </time>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
