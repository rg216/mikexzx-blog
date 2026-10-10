import type { HighlightedText, HighlightRange } from "@blog/shared";

/*
 * 全文搜索的分词，索引和查询共用这一套规则。
 *
 * PostgreSQL 内置的分词器按空格和标点切词，中文没有空格，一整句会变成一个"词"，搜不到句子里的任何部分；
 * 中文分词扩展（zhparser、pg_jieba）Neon 又不提供。所以在应用里切好词再交给 Postgres：
 *   - 中日韩文字：切成单字 + 相邻两字（二元组，bigram）。"全栈开发" → 全 全栈 栈 栈开 开 开发 发
 *     查询 "全栈开发" 要求文章同时含有 全栈、栈开、开发；查单字时用单字。
 *     不需要词典，不会因为"词典里没这个词"而搜不到；代价是索引更大、偶尔误命中（三个二元组散落在不同位置）。
 *   - 其他文字：按非字母数字切成单词，查询时按前缀匹配（"deploy" 能搜到 "deployment"）。
 *   - 先做 NFKC 规范化 + 小写：全角 "Ｎｅｘｔ" 与 "next" 视为相同。
 *
 * 为什么二元组之间用 AND 而不用短语查询（<->，要求位置相邻）：Postgres 的位置最大 16383，
 * 超过的都记成 16383，长文后半部分的"相邻"就判断不出来了，会悄悄搜不到。AND 不依赖位置，位置只用于排序。
 */

const CJK_CHAR = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー`;
// 其他文字：字母、数字、组合附加符号，但不含中日韩文字（否则 "abc中文" 会被当成一个词）
const TERM = new RegExp(`[${CJK_CHAR}]+|(?:(?![${CJK_CHAR}])[\\p{L}\\p{N}\\p{M}])+`, "gu");
const IS_CJK = new RegExp(`^[${CJK_CHAR}]`, "u");

/** 超过这个长度的"单词"（哈希、base64 之类）不索引，也不会有人搜 */
const MAX_WORD_LENGTH = 64;
/** 正文只索引前这么多个字符：tsvector 上限 1MB，二元组让长文的词条数接近字数 */
export const MAX_INDEXED_BODY_CHARS = 30_000;
/** Postgres 的限制：位置最大 16383，每个词条最多记 256 个位置（超出的会被静默丢弃，这里提前截断以减小 SQL） */
const MAX_POSITION = 16_383;
const MAX_POSITIONS_PER_LEXEME = 256;
/** 查询最多取前 10 个词，避免超长查询拖慢数据库 */
const MAX_QUERY_TERMS = 10;

type Term = { cjk: boolean; text: string };

export function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/** 把文本切成一段段连续的中日韩文字或单词 */
export function splitTerms(text: string): Term[] {
  const terms: Term[] = [];
  for (const [match] of normalizeForSearch(text).matchAll(TERM)) {
    const cjk = IS_CJK.test(match);
    if (!cjk && match.length > MAX_WORD_LENGTH) continue;
    terms.push({ cjk, text: match });
  }
  return terms;
}

function bigrams(chars: string[]): string[] {
  return chars.slice(0, -1).map((char, i) => char + chars[i + 1]);
}

/** tsvector / tsquery 字面量里的词条：用单引号包住，转义 ' 和 \（分词结果只有字母数字，这里是兜底） */
function quote(lexeme: string): string {
  return `'${lexeme.replace(/['\\]/g, (c) => c + c)}'`;
}

export type SearchFields = { title: string; tags: string[]; body: string };

/**
 * 生成 tsvector 字面量（形如 'next':1A '全栈':2B,9），由 SQL 里的 ::tsvector 转换。
 * 不用 to_tsvector()：那样 Postgres 会按服务器的 locale 再切一遍词，本地和 Neon 的 locale 不同时结果可能不一样。
 * 权重：标题 A、标签 B、正文 D（默认），排序时标题命中远比正文命中重要。
 */
export function buildSearchVector({ title, tags, body }: SearchFields): string {
  const positions = new Map<string, string[]>();
  let position = 1;

  const add = (lexeme: string, at: number, weight: string) => {
    const list = positions.get(lexeme) ?? [];
    if (list.length < MAX_POSITIONS_PER_LEXEME) list.push(`${Math.min(at, MAX_POSITION)}${weight}`);
    positions.set(lexeme, list);
  };

  const addText = (text: string, weight: string) => {
    for (const term of splitTerms(text)) {
      if (!term.cjk) {
        add(term.text, position++, weight);
        continue;
      }
      const chars = Array.from(term.text);
      // 二元组和它的第一个字记在同一个位置
      chars.forEach((char, i) => add(char, position + i, weight));
      bigrams(chars).forEach((pair, i) => add(pair, position + i, weight));
      position += chars.length;
    }
    // 字段之间空一个位置，标题末尾和正文开头不算相邻
    position++;
  };

  addText(title, "A");
  for (const tag of tags) addText(tag, "B");
  addText(Array.from(body).slice(0, MAX_INDEXED_BODY_CHARS).join(""), "");

  return [...positions].map(([lexeme, list]) => `${quote(lexeme)}:${list.join(",")}`).join(" ");
}

/** 生成 tsquery 字面量（形如 '全栈' & '栈开' & 'next':*）；查询里没有可搜索的字时返回 null。 */
export function buildSearchQuery(query: string): string | null {
  const parts = new Set<string>();
  for (const term of splitTerms(query).slice(0, MAX_QUERY_TERMS)) {
    if (!term.cjk) {
      parts.add(`${quote(term.text)}:*`);
      continue;
    }
    const chars = Array.from(term.text);
    for (const lexeme of chars.length === 1 ? chars : bigrams(chars)) parts.add(quote(lexeme));
  }
  return parts.size > 0 ? [...parts].join(" & ") : null;
}

// ---------- 高亮与摘要 ----------

/**
 * 逐个码点做和分词相同的规范化，同时记下规范化后每个位置对应原文的哪一段，
 * 这样在规范化的文本里找到的匹配可以映射回原文——高亮的是原文（"Ｎｅｘｔ" 原样显示），不是规范化后的文本。
 */
function foldWithMap(text: string): { folded: string; starts: number[]; ends: number[] } {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const char of text) {
    const normalized = normalizeForSearch(char);
    for (let i = 0; i < normalized.length; i++) {
      starts.push(index);
      ends.push(index + char.length);
    }
    folded += normalized;
    index += char.length;
  }
  return { folded, starts, ends };
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/** 文本里与查询匹配的位置（UTF-16 下标，[start, end)），按位置排序，重叠或相邻的合并。 */
export function findHighlights(text: string, query: string): HighlightRange[] {
  const { folded, starts, ends } = foldWithMap(text);
  const found: HighlightRange[] = [];

  for (const term of splitTerms(query).slice(0, MAX_QUERY_TERMS)) {
    const chars = Array.from(term.text);
    // 和查询语义一致：中文按二元组找（合并后连续的二元组就是整个词），单词按词首前缀找
    const needles = term.cjk && chars.length > 1 ? bigrams(chars) : [term.text];
    for (const needle of needles) {
      for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + 1)) {
        const before = folded[at - 1];
        if (!term.cjk && before !== undefined && WORD_CHAR.test(before) && !IS_CJK.test(before)) continue;
        const start = starts[at];
        const end = ends[at + needle.length - 1];
        if (start !== undefined && end !== undefined) found.push({ start, end });
      }
    }
  }

  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: HighlightRange[] = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

/**
 * 从正文里截一段包含第一处匹配的摘要（按字素截断，不会切开 emoji）。
 * 匹配前保留一点上下文；截断处加省略号，高亮下标随之平移。没有匹配（只命中标题或标签）时取开头。
 */
export function buildSnippet(text: string, highlights: HighlightRange[], { length = 120, context = 20 } = {}): HighlightedText {
  const segments = Array.from(segmenter.segment(text), (s) => s.index);
  const total = segments.length;
  const first = highlights[0];

  let from = 0;
  if (first) {
    const containing = segments.findLastIndex((index) => index <= first.start);
    from = Math.max(0, Math.min(containing - context, total - length));
  }
  const to = Math.min(total, from + length);
  let startIndex = segments[from] ?? 0;
  let endIndex = to < total ? (segments[to] ?? text.length) : text.length;
  // 截断处的空格去掉（"… 文字" → "…文字"），直接改下标而不是 trim()，否则高亮位置会错开
  while (startIndex < endIndex && text[startIndex] === " ") startIndex++;
  while (endIndex > startIndex && text[endIndex - 1] === " ") endIndex--;

  const prefix = startIndex > 0 ? "…" : "";
  const suffix = endIndex < text.length ? "…" : "";
  const shift = prefix.length - startIndex;

  return {
    text: prefix + text.slice(startIndex, endIndex) + suffix,
    highlights: highlights
      .filter((h) => h.end > startIndex && h.start < endIndex)
      .map((h) => ({ start: Math.max(h.start, startIndex) + shift, end: Math.min(h.end, endIndex) + shift })),
  };
}
