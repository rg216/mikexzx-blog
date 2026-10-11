"use client";

import { type Locale, localeInfo, locales } from "@blog/shared";
import { Check, Languages } from "lucide-react";
import { usePathname } from "next/navigation";
import type { SyntheticEvent } from "react";
import { useDictionary, useLocale } from "@/lib/i18n/client";
import { switchLocalePath } from "@/lib/i18n/paths";
import styles from "./LanguageSwitcher.module.css";

/** 页面上只有一个切换语言菜单，id 固定即可（useId 生成的 id 也能用，但固定值方便 CSS anchor 对应） */
const MENU_ID = "language-menu";

/**
 * 切换语言：导航栏右侧的按钮 + 弹出菜单。不按 Accept-Language 自动跳转，由读者自己选。
 *
 * 菜单用原生 Popover API（popover + popovertarget）：点外面关闭、Esc 关闭、焦点回到按钮都是浏览器内置的，
 * 按钮的展开状态浏览器也会自动告诉读屏软件。不用 role="menu"：里面就是一组普通链接，用 Tab 走即可。
 *
 * 每项用普通 <a> 而不是 next/link：整页加载，<html lang> 和按语言调整的字体栈才会跟着切换
 * （另一种语言是另一个根布局，客户端导航也会整页刷新，这里直接写明）。
 * 目标是同一页面的其他语言版本；文章没有该语言的译文也照样链接（那边显示原文 + 提示），行为可预期。
 *
 * 搜索页的 ?q= 也要带过去。服务端渲染的 href 只用路径（静态页面预渲染时没有查询串；在这里用 useSearchParams
 * 会让共用的导航栏所在的整页退回客户端渲染）；读者按下、聚焦链接时再按当前的 location.search 改写 href，
 * 这样点击、新标签页打开、复制链接都带着查询词。
 */
export function LanguageSwitcher() {
  const current = useLocale();
  const t = useDictionary().languageSwitcher;
  // 服务端渲染时是 rewrite 后的路由路径（/zh/about），浏览器里是 /about；switchLocalePath 两种都认，结果一致
  const pathname = usePathname();
  const carryQuery = (event: SyntheticEvent<HTMLAnchorElement>, locale: Locale) => {
    event.currentTarget.href = switchLocalePath(pathname, locale, window.location.search);
  };

  return (
    <>
      <button type="button" className={styles.button} popoverTarget={MENU_ID} aria-label={t.label} title={t.label}>
        <Languages className={styles.icon} aria-hidden="true" />
      </button>
      <div id={MENU_ID} popover="auto" className={styles.menu}>
        <ul className={styles.list} aria-label={t.label}>
          {locales.map((locale) => {
            const active = locale === current;
            return (
              <li key={locale}>
                <a
                  className={styles.item}
                  href={switchLocalePath(pathname, locale)}
                  onPointerDown={(event) => carryQuery(event, locale)}
                  onFocus={(event) => carryQuery(event, locale)}
                  onClick={(event) => carryQuery(event, locale)}
                  hrefLang={localeInfo[locale].tag}
                  lang={localeInfo[locale].tag}
                  aria-current={active ? "true" : undefined}
                >
                  {/* 勾只是视觉提示，当前项由 aria-current 告诉读屏 */}
                  <Check className={styles.check} aria-hidden="true" data-visible={active || undefined} />
                  {localeInfo[locale].name}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
