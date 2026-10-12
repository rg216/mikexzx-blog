"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./SectionTabs.module.css";

export type Section = { href: string; label: string };

/**
 * 栏目下的二级导航（"文章 / 标签"、"设置 / 状态"）：放在栏目里面，不占顶部导航的位置（窄屏上顶栏已经放不下更多项）。
 * 外观同分段控件，但它们是链接（换页面），不是 radio。
 */
export function SectionTabs({ label, sections }: { label: string; sections: readonly Section[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className={styles.tabs}>
      {sections.map((section) => (
        <Link key={section.href} href={section.href} className={styles.tab} aria-current={pathname === section.href ? "page" : undefined}>
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
