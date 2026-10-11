import { defaultSourceLocale, type Locale, localeInfo } from "@blog/shared";

/*
 * 页面里夹着另一种语言的内容时（没有译文时显示的原文、不翻译的标签名），给这部分内容标上 lang：
 * 读屏换发音，浏览器按语言选字形和字体（中日共用汉字，/ja 页面里的中文要用简体字形和 SC 字体）。
 * 只标内容本身，不标外层容器：容器上的 aria-label、读屏文字是页面语言的界面文案。
 */

/** 内容的语言与页面语言不同时返回内容语言的标签（用作 lang 属性），相同时返回 undefined（继承页面的 lang） */
export function contentLang(contentLocale: Locale, pageLocale: Locale): string | undefined {
  return contentLocale === pageLocale ? undefined : localeInfo[contentLocale].tag;
}

/**
 * 标签名的语言。标签是全站共用的、不翻译，跟原文写在一起，而文章原文默认是 defaultSourceLocale
 * （以后真有别的语言写的原文，再给标签加上自己的语言）。
 */
export const tagLocale: Locale = defaultSourceLocale;
