import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: site.name, template: `%s · ${site.name}` },
  description: site.description,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 让页面延伸到刘海/圆角区域，再由 CSS 的 env(safe-area-inset-*) 把内容让回来。
  viewportFit: "cover",
  // <meta name="theme-color"> 只接受字面量颜色，无法引用 CSS 变量；值与 --color-background 保持一致。
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={site.locale}>
      <body>
        <a href="#main" className="skip-link">
          跳到正文
        </a>
        {/* 导航栏和 <main id="main"> 由各自的布局提供：前台见 (site)/layout.tsx，后台见 admin/layout.tsx */}
        {children}
      </body>
    </html>
  );
}
