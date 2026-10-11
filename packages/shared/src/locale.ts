import { z } from "zod";

/*
 * 站点支持的语言。其他代码一律从这里取，不写死具体语言：
 * 加一种语言 = 在 locales 和 localeInfo 里各加一项 + 补齐前端的界面字典（缺 key 编译报错）+ 必要时调整字体和分词。
 *
 * 代码用 BCP 47 语言标签（zh / en / ja）：既是数据库里 post_translations.locale 的值，也是网址前缀（/en/…）。
 * 默认语言（中文）在根路径，不加前缀，现有网址保持不变。
 */
export const locales = ["zh", "en", "ja"] as const;
export type Locale = (typeof locales)[number];

/** 网址不带前缀的语言；也是没有指定语言时 API 的默认值 */
export const defaultLocale: Locale = "zh";

/** 新文章的原文语言（posts.source_locale 的默认值） */
export const defaultSourceLocale: Locale = "zh";

export type LocaleInfo = {
  /** 用于 <html lang>、hreflang、Intl 格式化的完整标签。中文用 zh-CN：浏览器据此选简体字形（中日共用汉字） */
  tag: string;
  /** 语言自称，用于切换语言的菜单（无论当前界面是哪种语言，都用该语言自己的写法） */
  name: string;
  /** 摘要的长度（字素数）。拉丁字母大约是汉字一半宽，同样的视觉长度需要更多字符 */
  excerptLength: number;
  /**
   * Open Graph 的 og:locale，只用于这一处：格式是 language_TERRITORY（en_US、ja_JP），
   * 不能由 tag 推出来（"en"、"ja" 不带地区，Facebook 等只认它列表里的值）
   */
  ogLocale: string;
};

export const localeInfo: Record<Locale, LocaleInfo> = {
  zh: { tag: "zh-CN", name: "中文", excerptLength: 120, ogLocale: "zh_CN" },
  en: { tag: "en", name: "English", excerptLength: 240, ogLocale: "en_US" },
  ja: { tag: "ja", name: "日本語", excerptLength: 120, ogLocale: "ja_JP" },
};

export const localeSchema = z.enum(locales);

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/** 只含 locale 参数的查询（默认语言可省略，兼容没有语言参数的旧客户端） */
export const localeQuerySchema = z.object({ locale: localeSchema.default(defaultLocale) });
export type LocaleQuery = z.infer<typeof localeQuerySchema>;
