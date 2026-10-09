import { site } from "./site";

/*
 * 后台用的时间格式：比前台多出时分，同一天改了好几次也分得清。
 * 和前台一样固定按站点时区显示——在国外出差时后台看到的时间也和文章页一致。
 */

const dateTimeFormatter = new Intl.DateTimeFormat(site.locale, {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: site.timeZone,
});

const timeFormatter = new Intl.DateTimeFormat(site.locale, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: site.timeZone,
});

/** "2026-10-08T20:05:00Z" → "2026/10/9 04:05" */
export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

/** 只要时分（保存状态里的"已保存 14:32"） */
export function formatTime(date: Date): string {
  return timeFormatter.format(date);
}
