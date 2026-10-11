import type { Locale, Tag } from "@blog/shared";
import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import { contentLang } from "@/lib/i18n/content-lang";
import { tagPath } from "@/lib/i18n/paths";
import styles from "./TagList.module.css";

/**
 * 文章的标签。linked：链接到标签页（文章页）；列表卡片里不链接——整张卡片已经是一个链接，
 * 里面再嵌链接既是嵌套的交互元素，点击区域也做不到 44px。
 * 还没有译名的标签显示原文名称：给它标上自己的语言（lang 放在 <li> 上，不放在 <ul> 上：aria-label 是页面语言的界面文案）
 */
export function TagList({ tags, locale, linked = false }: { tags: Tag[]; locale: Locale; linked?: boolean }) {
  if (tags.length === 0) return null;

  return (
    <ul className={styles.tags} aria-label={getDictionary(locale).post.tags}>
      {tags.map((tag) => (
        <li key={tag.slug} className={styles.tag} lang={contentLang(tag.locale, locale)}>
          {linked ? (
            <Link href={tagPath(locale, tag.slug)} className={styles.link}>
              {tag.name}
            </Link>
          ) : (
            tag.name
          )}
        </li>
      ))}
    </ul>
  );
}
