import { defaultLocale, type Locale, localeInfo, locales, type PublicPost } from "@blog/shared";
import type { Metadata } from "next";
import { localePath, postPath, tagPath } from "./paths";

/*
 * hreflang 与 canonical（metadata.alternates）。网址是相对的，由根布局的 metadataBase 补成绝对网址。
 * hreflang 的 key 用完整标签（zh-CN / en / ja），与 <html lang> 一致；x-default 给不匹配任何语言的访客。
 */

type Alternates = NonNullable<Metadata["alternates"]>;

/** 首页、关于、搜索这类每种语言都有的页面：互相标注所有语言，x-default = 默认语言的网址 */
export function pageAlternates(locale: Locale, path: string): Alternates {
  return {
    canonical: localePath(locale, path),
    languages: {
      ...Object.fromEntries(locales.map((l) => [localeInfo[l].tag, localePath(l, path)])),
      "x-default": localePath(defaultLocale, path),
    },
  };
}

/**
 * 文章页：只标注真正存在的语言版本（原文 + 已有译文），x-default = 原文网址。
 * canonical 指向实际显示的内容所在的网址：有译文时是自己；没有译文、显示原文时指向原文网址——
 * /en/posts/a 显示的是中文原文，不让它和 /posts/a 成为两份重复内容。
 */
export function postAlternates(post: Pick<PublicPost, "slug" | "locale" | "sourceLocale" | "availableLocales">): Alternates {
  return {
    canonical: postPath(post.locale, post.slug),
    languages: {
      ...Object.fromEntries(post.availableLocales.map((l) => [localeInfo[l].tag, postPath(l, post.slug)])),
      "x-default": postPath(post.sourceLocale, post.slug),
    },
  };
}

/**
 * 标签页：只标注这个标签下有可见文章的语言（其他语言的同一个标签页是 404）。
 * x-default 指向默认语言的版本；默认语言下没有文章时指向第一个有文章的语言。
 */
export function tagAlternates(locale: Locale, slug: string, visibleIn: readonly Locale[]): Alternates {
  const fallback = visibleIn.includes(defaultLocale) ? defaultLocale : (visibleIn[0] ?? locale);
  return {
    canonical: tagPath(locale, slug),
    languages: {
      ...Object.fromEntries(visibleIn.map((l) => [localeInfo[l].tag, tagPath(l, slug)])),
      "x-default": tagPath(fallback, slug),
    },
  };
}
