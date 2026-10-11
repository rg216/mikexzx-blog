import type { Locale, Tag } from "@blog/shared";
import { getDictionary } from "@/lib/i18n";
import { contentLang, tagLocale } from "@/lib/i18n/content-lang";
import styles from "./TagList.module.css";

/**
 * v0 只展示，不可点击；有了标签页之后再改成链接。标签名不翻译，各语言显示原样。
 * 其他语言的页面里给每个标签名标上它自己的语言（lang 放在 <li> 上，不放在 <ul> 上：aria-label 是页面语言的界面文案）
 */
export function TagList({ tags, locale }: { tags: Tag[]; locale: Locale }) {
  if (tags.length === 0) return null;
  const lang = contentLang(tagLocale, locale);

  return (
    <ul className={styles.tags} aria-label={getDictionary(locale).post.tags}>
      {tags.map((tag) => (
        <li key={tag.slug} className={styles.tag} lang={lang}>
          {tag.name}
        </li>
      ))}
    </ul>
  );
}
