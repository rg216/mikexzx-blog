import type { HighlightedText } from "@blog/shared";

export type TextPart = { text: string; highlighted: boolean };

/**
 * 按高亮区间把文本切成段，交给组件渲染成 <mark>。
 * API 保证区间有序、不重叠，这里仍然防御一下（越界的截掉，和前一个重叠的丢掉），坏数据最多是少标几处，不会让页面出错。
 */
export function splitHighlights({ text, highlights }: HighlightedText): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const { start, end } of highlights) {
    const from = Math.max(start, cursor);
    const to = Math.min(end, text.length);
    if (from >= to) continue;
    if (from > cursor) parts.push({ text: text.slice(cursor, from), highlighted: false });
    parts.push({ text: text.slice(from, to), highlighted: true });
    cursor = to;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), highlighted: false });
  return parts;
}
