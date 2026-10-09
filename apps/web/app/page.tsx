import { PostListItem } from "@/components/PostListItem";
import { listPublishedPosts } from "@/lib/posts";
import { site } from "@/lib/site";
import styles from "./page.module.css";

export default async function HomePage() {
  const posts = await listPublishedPosts();

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>文章</h1>
        <p className={styles.subtitle}>{site.description}</p>
      </header>

      {posts.length === 0 ? (
        <p className={styles.empty}>还没有文章。</p>
      ) : (
        <ol className={styles.list}>
          {posts.map((post) => (
            <li key={post.slug} className={styles.item}>
              <PostListItem post={post} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
