import type { Locale } from "@blog/shared";
import en from "./dictionaries/en";
import ja from "./dictionaries/ja";
import zh, { type Dictionary } from "./dictionaries/zh";

export type { Dictionary };

/*
 * 三份字典都很小（几 KB），同步、静态导入：服务端组件直接调用，客户端组件经 useDictionary() 调用。
 * 没有按需加载（Next 文档示例里的 import()）：那样 getDictionary 要变成异步，客户端组件用起来麻烦，省下的体积可以忽略。
 * Record<Locale, …>：locales 里加了语言而这里没有对应的字典，编译报错。
 */
const dictionaries: Record<Locale, Dictionary> = { zh, en, ja };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
