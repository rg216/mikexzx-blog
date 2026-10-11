"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isNavLinkActive } from "@/lib/nav";
import styles from "./NavLink.module.css";

/** 导航链接：当前所在栏目加 aria-current，读屏软件会读出"当前页面"。前台和后台的导航共用。 */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <Link href={href} className={styles.link} aria-current={isNavLinkActive(href, pathname) ? "page" : undefined}>
      {children}
    </Link>
  );
}
