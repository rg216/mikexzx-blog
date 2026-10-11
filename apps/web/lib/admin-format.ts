import type { Locale } from "@blog/shared";
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

const languageNames = new Intl.DisplayNames(site.locale, { type: "language" });

/**
 * 后台里的语言名：用后台界面的语言（中文）称呼各语言——"英语""日语"，而不是语言自称（English / 日本語）。
 * 后台的语言名都夹在中文句子里（"编辑英语译文""删除日语译文？"），用自称的话每处都得单独标 lang，
 * 否则读屏会用中文读 "English"、按中文字形显示"語"。语言自称只用在前台的切换语言菜单。
 * 由 Intl 按语言代码生成，不写死具体语言。
 */
export function adminLocaleName(locale: Locale): string {
  return languageNames.of(locale) ?? locale;
}
