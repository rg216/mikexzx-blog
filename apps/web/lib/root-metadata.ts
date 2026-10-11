import { type Locale, localeInfo } from "@blog/shared";
import type { Metadata, Viewport } from "next";
import { z } from "zod";
import { site } from "./site";

/*
 * 两个根布局（前台 app/[lang]/layout.tsx、后台 app/admin/layout.tsx）共用的 metadata 和 viewport。
 * 没有 app/layout.tsx：前台的 <html lang> 要随语言变化，只能由 [lang] 下的根布局输出；后台于是也需要自己的根布局。
 */

const DEFAULT_SITE_URL = "https://mikexzx-blog.vercel.app";

/**
 * 站点的公开地址（SITE_URL）：hreflang、canonical 这些必须是绝对网址，相对网址由 metadataBase 补全。
 * 没设置或格式不对时用线上地址——本地开发时 <link> 指向线上也无妨，它们只给搜索引擎看。
 */
export function siteUrl(value = process.env.SITE_URL): URL {
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(value?.trim());
  return new URL(parsed.success ? parsed.data : DEFAULT_SITE_URL);
}

export const baseMetadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: site.name, template: `%s · ${site.name}` },
};

/**
 * 所有前台页面共有的 Open Graph 字段。Next 合并 metadata 是浅合并：页面返回自己的 openGraph 会整个替换布局的，
 * 所以文章页要把它展开进自己的 openGraph，否则 og:site_name 会丢。
 * locale 是实际显示的内容的语言（文章页显示原文时是原文语言，不是网址的语言）
 */
export function ogBase(locale: Locale) {
  return { siteName: site.name, locale: localeInfo[locale].ogLocale };
}

export const rootViewport: Viewport = {
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
