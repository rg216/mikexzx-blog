import { type ArchiveItem, type Locale, localeInfo } from "@blog/shared";
import { site } from "./site";

/*
 * 归档页的分组：按年、再按月，都按站点时区算（北京时间 3 月 1 日早上发的文章属于 3 月，哪怕 UTC 还是 2 月）。
 * API 返回的已经按发布时间倒序，这里只分组、不重新排序。
 */

export type ArchiveMonth = { key: string; label: string; items: ArchiveItem[] };
export type ArchiveYear = { year: string; label: string; months: ArchiveMonth[] };

const partsFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", timeZone: site.timeZone });

/** 文章发布时间在站点时区里的年、月："2026"、"03" */
export function yearMonthOf(iso: string): { year: string; month: string } {
  const parts = partsFormatter.formatToParts(new Date(iso));
  return { year: parts.find((p) => p.type === "year")?.value ?? "", month: parts.find((p) => p.type === "month")?.value ?? "" };
}

export function groupArchive(items: ArchiveItem[], locale: Locale): ArchiveYear[] {
  const tag = localeInfo[locale].tag;
  // 标签文字按页面语言："2026年3月" / "March" / "3月"；年份的标题单独显示，所以月份只写月
  const monthLabel = new Intl.DateTimeFormat(tag, { month: "long", timeZone: "UTC" });
  const yearLabel = new Intl.DateTimeFormat(tag, { year: "numeric", timeZone: "UTC" });

  const years: ArchiveYear[] = [];
  for (const item of items) {
    const { year, month } = yearMonthOf(item.publishedAt);
    let currentYear = years.at(-1);
    if (currentYear?.year !== year) {
      currentYear = { year, label: yearLabel.format(Date.UTC(Number(year), 0, 15)), months: [] };
      years.push(currentYear);
    }
    const key = `${year}-${month}`;
    let currentMonth = currentYear.months.at(-1);
    if (currentMonth?.key !== key) {
      currentMonth = { key, label: monthLabel.format(Date.UTC(Number(year), Number(month) - 1, 15)), items: [] };
      currentYear.months.push(currentMonth);
    }
    currentMonth.items.push(item);
  }
  return years;
}

const dayFormatters = new Map<Locale, Intl.DateTimeFormat>();

/** 归档里每篇文章前面的日期：只写月日（年、月已经是标题）："3月10日" / "Mar 10" / "3月10日" */
export function formatArchiveDay(iso: string, locale: Locale): string {
  let formatter = dayFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(localeInfo[locale].tag, { month: "short", day: "numeric", timeZone: site.timeZone });
    dayFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(iso));
}
