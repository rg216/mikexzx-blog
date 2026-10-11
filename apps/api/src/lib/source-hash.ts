import { createHash } from "node:crypto";

/**
 * 原文指纹：译文依据的是哪一版原文。保存译文时记下当时的指纹，之后原文的指纹变了，就说明译文过时了。
 *
 * 只取标题和正文：标签不翻译（所有语言共用），slug、发布状态也不影响译文内容，改它们不该让译文变成"过时"。
 * 先编码成 JSON 数组再哈希，而不是直接拼接：直接拼接时 ("a\nb", "c") 和 ("a", "b\nc") 会得到同一个指纹。
 */
export function sourceHash({ title, contentMd }: { title: string; contentMd: string }): string {
  return createHash("sha256").update(JSON.stringify([title, contentMd])).digest("hex");
}
