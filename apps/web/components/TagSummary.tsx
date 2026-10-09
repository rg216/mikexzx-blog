import type { TagWithCount } from "@/lib/posts";
import styles from "./TagSummary.module.css";

/** 标签及篇数。v0 还没有标签页，所以只展示、不可点击；有了标签页再改成链接。 */
export function TagSummary({ tags }: { tags: TagWithCount[] }) {
  return (
    <ul className={styles.list}>
      {tags.map((tag) => (
        <li key={tag.slug} className={styles.row}>
          <span>{tag.name}</span>
          <span className={styles.count}>
            {tag.count}
            <span className="visually-hidden"> 篇</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
