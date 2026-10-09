import Link from "next/link";
import { PageLayout } from "@/components/PageLayout";
import { PostListItem } from "@/components/PostListItem";
import { SidebarSection } from "@/components/SidebarSection";
import { TagSummary } from "@/components/TagSummary";
import { listPublishedPosts, listTags } from "@/lib/posts";
import { site } from "@/lib/site";
import styles from "./page.module.css";

export default async function HomePage() {
  const [posts, tags] = await Promise.all([listPublishedPosts(), listTags()]);

  const aside = (
    <>
      <SidebarSection title="关于">
        <p className={styles.about}>{site.description}</p>
        <Link href="/about" className={styles.aboutLink}>
          了解更多
        </Link>
      </SidebarSection>
      {tags.length > 0 && (
        <SidebarSection title="标签">
          <TagSummary tags={tags} />
        </SidebarSection>
      )}
    </>
  );

  return (
    <PageLayout aside={aside} asideLabel="站点信息">
      <header className={styles.header}>
        <h1 className={styles.title}>文章</h1>
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
    </PageLayout>
  );
}
