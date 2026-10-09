import type { ReactNode } from "react";
import styles from "./SiteShell.module.css";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/** 前台页面的外壳：导航栏 + 主内容 + 页脚。后台有自己的导航，不用它。 */
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
