import { SITE_TIME_ZONE } from "@blog/shared";

export const site = {
  name: "mikexxz",
  /** 后台界面的语言（后台不做多语言）；前台的语言见 @blog/shared 的 locales */
  locale: "zh-CN",
  /** 日期统一按这个时区显示，避免构建机（通常是 UTC）和读者看到的日期差一天。API 按月筛选也用它（shared 的 site.ts） */
  timeZone: SITE_TIME_ZONE,
} as const;
