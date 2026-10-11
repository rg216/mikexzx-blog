import type { AdminPost } from "@blog/shared";
import Link from "next/link";
import { useId } from "react";
import { formatDateTime } from "@/lib/admin-format";
import { originLabel, translationTargets } from "@/lib/translation-form";
import styles from "./PostTranslations.module.css";
import { TranslationStateBadge } from "./TranslationStateBadge";

type Props = {
  /** 服务器上已保存的文章（译文状态是服务端按已保存的原文算的） */
  post: AdminPost;
  /** 原文有未保存的修改 */
  sourceDirty: boolean;
  className?: string;
};

/**
 * 文章编辑页的"译文"一栏：除原文语言外，每种语言一行，显示状态并链接到译文编辑页。
 * 译文在单独的页面编辑而不是塞进这个表单：两份正文各自保存、各自有未保存提醒，
 * 也不会让文章的"保存"按钮意外改动译文。
 */
export function PostTranslations({ post, sourceDirty, className }: Props) {
  const headingId = useId();
  const targets = translationTargets(post);

  return (
    <section className={[styles.section, className].filter(Boolean).join(" ")} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.title}>
        译文
      </h2>
      {sourceDirty && <p className={styles.note}>原文有未保存的修改，下面的状态以已保存的原文为准。</p>}
      <ul className={styles.list}>
        {targets.map(({ locale, name, summary, state }) => (
          <li key={locale} className={styles.row}>
            <div className={styles.head}>
              <span className={styles.name}>{name}</span>
              <TranslationStateBadge state={state} />
            </div>
            <p className={styles.detail}>
              {summary && (
                <>
                  {originLabel(summary.origin, summary.model)} · {summary.origin === "machine" ? "生成于" : "保存于"}{" "}
                  <time dateTime={summary.translatedAt}>{formatDateTime(summary.translatedAt)}</time>
                </>
              )}
            </p>
            <Link href={`/admin/posts/${post.id}/translations/${locale}`} className={styles.action}>
              {summary ? "编辑译文" : "添加译文"}
              <span className="visually-hidden">（{name}）</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
