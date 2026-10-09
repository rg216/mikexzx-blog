import type { ReactNode } from "react";
import styles from "./PageLayout.module.css";

type Props = {
  children: ReactNode;
  /** 侧栏内容。大屏显示在右侧，窄屏排到主内容下方。 */
  aside?: ReactNode;
  /** 侧栏的无障碍名称，读屏软件用它区分页面上的多个 landmark。 */
  asideLabel?: string;
};

/**
 * 页面骨架：主栏 + 可选侧栏。
 * DOM 顺序永远是"主内容在前、侧栏在后"：窄屏自然堆叠，读屏和键盘也先到正文。
 */
export function PageLayout({ children, aside, asideLabel }: Props) {
  if (!aside) return <div className={styles.primary}>{children}</div>;

  return (
    <div className={styles.withAside}>
      <div className={styles.primary}>{children}</div>
      <aside className={styles.aside} aria-label={asideLabel}>
        {aside}
      </aside>
    </div>
  );
}
