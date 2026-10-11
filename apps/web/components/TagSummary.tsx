import type { Locale, TagWithCount } from "@blog/shared";
import { getDictionary } from "@/lib/i18n";
import { contentLang, tagLocale } from "@/lib/i18n/content-lang";
import styles from "./TagSummary.module.css";

/**
 * 标签及篇数。v0 还没有标签页，所以只展示、不可点击；有了标签页再改成链接。
 * 标签名不翻译：其他语言的页面里只给名字标上它自己的语言，篇数的读屏文字仍是页面语言
 */
export function TagSummary({ tags, locale }: { tags: TagWithCount[]; locale: Locale }) {
  const countLabel = getDictionary(locale).home.tagCount;
  const lang = contentLang(tagLocale, locale);
  return (
    <ul className={styles.list}>
      {tags.map((tag) => (
        <li key={tag.slug} className={styles.row}>
          <span lang={lang}>{tag.name}</span>
          <span className={styles.count}>
            {/* 视觉上只有数字；读屏读完整的"3 篇 / 3 posts"（单复数、量词各语言不同） */}
            <span aria-hidden="true">{tag.count}</span>
            <span className="visually-hidden">{countLabel(tag.count)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
