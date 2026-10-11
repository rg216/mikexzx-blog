import type { Metadata } from "next";
import type { ReactNode } from "react";
import { baseMetadata, rootViewport } from "@/lib/root-metadata";
import { site } from "@/lib/site";
import "../globals.css";

/*
 * 后台的根布局。前台的根布局在 app/[lang]/ 下（<html lang> 随语言变化），没有 app/layout.tsx，
 * 所以后台也要有自己的 <html>。后台界面只有中文，不做多语言。
 * 导航栏和 <main id="main"> 由下面的布局提供：(panel)/layout.tsx、login/page.tsx。
 * 从前台进后台（或反过来）是跨根布局的导航，会整页加载——两边本来也没有共享的状态。
 */

export const metadata: Metadata = {
  ...baseMetadata,
  // 后台页面不进搜索引擎
  robots: { index: false, follow: false },
};

export const viewport = rootViewport;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={site.locale}>
      <body>
        <a href="#main" className="skip-link">
          跳到正文
        </a>
        {children}
      </body>
    </html>
  );
}
