import type { Locale, PublicPost } from "@blog/shared";

/*
 * 文章页顶部的语言提示（纯函数，组件 TranslationNotice 负责显示文字）：
 *   - untranslated：该语言没有译文，显示的是原文
 *   - machine：机器翻译的译文
 *   - outdated：译文生成之后原文又改过
 * 有提示时都附一个指向原文网址的链接。
 */
export type PostNoticeMessage = "untranslated" | "machine" | "outdated";

export type PostNotice = {
  messages: PostNoticeMessage[];
  /** 原文的语言（链接目标和文案里的语言名称） */
  originalLocale: Locale;
};

export function postNotice(post: Pick<PublicPost, "locale" | "sourceLocale" | "translation">, pageLocale: Locale): PostNotice | null {
  if (post.locale !== pageLocale) return { messages: ["untranslated"], originalLocale: post.locale };
  if (!post.translation) return null;

  const messages: PostNoticeMessage[] = [];
  if (post.translation.origin === "machine") messages.push("machine");
  if (post.translation.outdated) messages.push("outdated");
  return messages.length > 0 ? { messages, originalLocale: post.sourceLocale } : null;
}
