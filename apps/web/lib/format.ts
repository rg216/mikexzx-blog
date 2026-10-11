import { type Locale, localeInfo } from "@blog/shared";
import { site } from "./site";

/*
 * 前台的日期和数字格式，按页面语言（后台用 admin-format.ts，固定中文）。
 * Intl 的格式化器创建起来不便宜，按语言各建一个、缓存起来。
 */

const dateFormatters = new Map<Locale, Intl.DateTimeFormat>();
const numberFormatters = new Map<Locale, Intl.NumberFormat>();

function dateFormatter(locale: Locale): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(localeInfo[locale].tag, {
      year: "numeric",
      month: "long",
      day: "numeric",
      // 所有语言都按站点时区：同一篇文章在各语言页面上显示同一天
      timeZone: site.timeZone,
    });
    dateFormatters.set(locale, formatter);
  }
  return formatter;
}

/** "2026-10-01T01:00:00Z" → zh "2026年10月1日" / en "October 1, 2026" / ja "2026年10月1日"（按站点时区） */
export function formatDate(iso: string, locale: Locale): string {
  return dateFormatter(locale).format(new Date(iso));
}

/** 12345 → zh / en / ja 都是 "12,345"（分组方式由语言决定） */
export function formatNumber(value: number, locale: Locale): string {
  let formatter = numberFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(localeInfo[locale].tag);
    numberFormatters.set(locale, formatter);
  }
  return formatter.format(value);
}
