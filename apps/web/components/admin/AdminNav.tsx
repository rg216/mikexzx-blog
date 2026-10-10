import { ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { NavLink } from "@/components/NavLink";
import { site } from "@/lib/site";
import styles from "./AdminNav.module.css";
import { PendingCommentsBadge } from "./PendingCommentsBadge";

/**
 * 管理后台的导航栏（吸顶 + 毛玻璃，和前台 SiteHeader 同一套样式和高度）。
 * 由 app/admin/(panel)/layout.tsx 接入；actions 放登录态相关的操作（"退出登录"按钮）。
 */
/** 窄屏只显示图标的文字（"退出登录"按钮也用它） */
export const wideOnlyClassName = styles.wideOnly;

export function AdminNav({ actions }: { actions?: ReactNode }) {
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link href="/admin/posts" className={styles.brand}>
          {site.name}
          <span className={styles.badge}>后台</span>
        </Link>
        <nav aria-label="后台导航" className={styles.nav}>
          <ul className={styles.links}>
            <li>
              <NavLink href="/admin/posts">文章</NavLink>
            </li>
            <li>
              <NavLink href="/admin/comments">
                评论
                <PendingCommentsBadge />
              </NavLink>
            </li>
            <li>
              <NavLink href="/admin/settings">设置</NavLink>
            </li>
            <li>
              {/* 回前台：新标签页打开，后台的编辑状态不受影响 */}
              <a href="/" target="_blank" rel="noopener" className={styles.external}>
                <span className={styles.wideOnly}>查看网站</span>
                <ExternalLink className={styles.externalIcon} aria-hidden="true" />
                <span className="visually-hidden">（在新标签页打开）</span>
              </a>
            </li>
          </ul>
          {actions}
        </nav>
      </div>
    </header>
  );
}
