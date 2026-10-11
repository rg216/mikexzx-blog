import { localeInfo, locales } from "@blog/shared";
import type { Metadata } from "next";
import { SiteShell } from "@/components/SiteShell";
import { getDictionary } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/client";
import { requireLocale } from "@/lib/i18n/params";
import { baseMetadata, ogBase, rootViewport } from "@/lib/root-metadata";
import "../globals.css";

/*
 * 前台的根布局。每种语言一棵树：/en/…、/ja/… 直接匹配 [lang]，中文网址由 next.config.ts 的 rewrite 送到 /zh/…。
 * 根布局放在 [lang] 下，是因为 <html lang> 必须随语言变化：中日文共用汉字，浏览器靠 lang 选字形和字体。
 *
 * 没有设置 dynamicParams = false：Next 判断一个页面能否按需生成时要求路径上每一段都允许（见
 * next/dist/build/static-paths/app.js 的 segments.every），这里设成 false 会让文章页的新 slug 也只能 404、
 * 必须重新部署才能访问。不支持的语言改由 requireLocale 返回 404。
 */

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export const viewport = rootViewport;

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const locale = requireLocale((await params).lang);
  return {
    ...baseMetadata,
    description: getDictionary(locale).site.description,
    openGraph: ogBase(locale),
  };
}

export default async function SiteLayout({ children, params }: LayoutProps<"/[lang]">) {
  const locale = requireLocale((await params).lang);

  return (
    <html lang={localeInfo[locale].tag}>
      <body>
        <a href="#main" className="skip-link">
          {getDictionary(locale).nav.skipToContent}
        </a>
        <LocaleProvider locale={locale}>
          <SiteShell locale={locale}>{children}</SiteShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
