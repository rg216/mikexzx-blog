import type { Locale, TagWithCount } from "@blog/shared";
import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import { contentLang } from "@/lib/i18n/content-lang";
import { tagPath } from "@/lib/i18n/paths";
import styles from "./TagSummary.module.css";

/**
 * 标签及篇数，每个是一枚链接到标签页的圆角按钮（侧栏、标签总览页）。
 * 还没有译名的标签显示原文名称，只给名字标上它自己的语言；篇数的读屏文字仍是页面语言
 */
export function TagSummary({ tags, locale }: { tags: TagWithCount[]; locale: Locale }) {
  const countLabel = getDictionary(locale).home.tagCount;
  return (
    <ul className={styles.list}>
      {tags.map((tag) => (
        <li key={tag.slug}>
          <Link href={tagPath(locale, tag.slug)} className={styles.chip}>
            <span className={styles.name} lang={contentLang(tag.locale, locale)}>
              {tag.name}
            </span>
            <span className={styles.count}>
              {/* 视觉上只有数字；读屏读完整的"3 篇 / 3 posts"（单复数、量词各语言不同） */}
              <span aria-hidden="true">{tag.count}</span>
              <span className="visually-hidden">{countLabel(tag.count)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
