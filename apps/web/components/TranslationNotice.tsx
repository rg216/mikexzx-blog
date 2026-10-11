import { type Locale, localeInfo } from "@blog/shared";
import { Languages } from "lucide-react";
import { getDictionary } from "@/lib/i18n";
import { postPath } from "@/lib/i18n/paths";
import type { PostNotice } from "@/lib/post-notice";
import styles from "./TranslationNotice.module.css";

/**
 * 文章页顶部的语言提示：显示的是原文 / 机器翻译 / 原文已更新。
 * 这是说明而不是错误：label 色的安静样式，不用红色的 Banner，也不用 role="alert" 打断读屏。
 */
export function TranslationNotice({ notice, slug, locale }: { notice: PostNotice; slug: string; locale: Locale }) {
  const t = getDictionary(locale);
  const original = t.languageNames[notice.originalLocale];
  const text = {
    untranslated: t.post.notice.untranslated(original),
    machine: t.post.notice.machine(original),
    outdated: t.post.notice.outdated,
  };
  const fallback = notice.messages.includes("untranslated");

  return (
    // role="note"：附属于正文的说明；不做成 <aside> landmark，免得读屏的地标列表里多出一个无名区域
    <div role="note" className={styles.notice}>
      <Languages className={styles.icon} aria-hidden="true" />
      <p className={styles.text}>
        {notice.messages.map((message) => text[message]).join(t.post.notice.separator)}
        {t.post.notice.separator}
        {/* 链接文字是界面语言，目标页面是原文语言：hreflang 提示读屏和浏览器 */}
        <a href={postPath(notice.originalLocale, slug)} hrefLang={localeInfo[notice.originalLocale].tag} className={styles.link}>
          {fallback ? t.post.notice.goToOriginal : t.post.notice.readOriginal}
        </a>
      </p>
    </div>
  );
}
