import { isLocale, type Locale } from "@blog/shared";
import { notFound } from "next/navigation";

/**
 * 路由参数 [lang] → Locale；不支持的语言 404。
 * 正常情况下进不来不支持的语言（rewrite 把其他前缀都交给了中文），这里兜住大小写不同（/EN）之类的漏网情况。
 */
export function requireLocale(lang: string): Locale {
  if (!isLocale(lang)) notFound();
  return lang;
}
