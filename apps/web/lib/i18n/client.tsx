"use client";

import { defaultLocale, type Locale } from "@blog/shared";
import { createContext, type ReactNode, useContext } from "react";
import { type Dictionary, getDictionary } from "./index";

/*
 * 客户端组件取当前语言和字典的方式。
 * 字典里有函数（带参数的文案），服务端组件不能把函数当 props 传给客户端组件（RSC 序列化不了），
 * 所以只把语言代码放进 context，客户端组件自己查字典。
 * 默认值是默认语言：后台没有包 LocaleProvider，复用前台组件时界面是中文，与后台一致。
 */
const LocaleContext = createContext<Locale>(defaultLocale);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useDictionary(): Dictionary {
  return getDictionary(useLocale());
}
