import type { Tag } from "@blog/shared";
import styles from "./TagList.module.css";

/** v0 只展示，不可点击；有了标签页之后再改成链接。 */
export function TagList({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) return null;

  return (
    <ul className={styles.tags} aria-label="标签">
      {tags.map((tag) => (
        <li key={tag.slug} className={styles.tag}>
          {tag.name}
        </li>
      ))}
    </ul>
  );
}
