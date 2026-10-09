import { useId, type ReactNode } from "react";
import styles from "./SidebarSection.module.css";

/** 侧栏里的一个分组：小标题 + 内容。以后的控件、推荐文章都按这个结构往里加。 */
export function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.title}>
        {title}
      </h2>
      {children}
    </section>
  );
}
