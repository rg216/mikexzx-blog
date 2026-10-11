"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./PostSectionTabs.module.css";

const sections = [
  { href: "/admin/posts", label: "文章" },
  { href: "/admin/posts/tags", label: "标签" },
] as const;

/**
 * "文章"栏目下的二级导航：文章列表 / 标签管理。标签只为文章服务，放在文章下面，
 * 不占顶部导航的位置（窄屏上顶栏已经放不下更多项）。外观同分段控件，但它们是链接（换页面），不是 radio。
 */
export function PostSectionTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="文章管理" className={styles.tabs}>
      {sections.map((section) => (
        <Link key={section.href} href={section.href} className={styles.tab} aria-current={pathname === section.href ? "page" : undefined}>
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
