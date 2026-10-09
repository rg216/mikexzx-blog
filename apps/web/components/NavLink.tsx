"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./NavLink.module.css";

/** 导航链接：当前所在栏目加 aria-current，读屏软件会读出"当前页面"。 */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  // "文章"栏目同时覆盖首页和 /posts/* 文章页
  const isActive = href === "/" ? pathname === "/" || pathname.startsWith("/posts/") : pathname.startsWith(href);

  return (
    <Link href={href} className={styles.link} aria-current={isActive ? "page" : undefined}>
      {children}
    </Link>
  );
}
