import type { Locale, PostSummary } from "@blog/shared";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { postPath } from "@/lib/i18n/paths";
import styles from "./RecentPosts.module.css";

/** 侧栏文章列表。现在是"最近文章"，以后的"推荐文章"复用同一个组件，只换数据。 */
export function RecentPosts({ posts, locale }: { posts: PostSummary[]; locale: Locale }) {
  return (
    <ul className={styles.list}>
      {posts.map((post) => (
        <li key={post.slug}>
          <Link href={postPath(locale, post.slug)} className={styles.link}>
            <span className={styles.title}>{post.title}</span>
            {post.publishedAt && (
              <time className={styles.date} dateTime={post.publishedAt}>
                {formatDate(post.publishedAt, locale)}
              </time>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
