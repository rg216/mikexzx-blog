/*
 * 截断文字时不切开西文单词。摘要（excerpt.ts，只截结尾）和搜索结果片段（search-text.ts，开头结尾都截）共用。
 * 输入是按字素切好的数组（emoji、组合字符不会被切成半个），返回调整后的字素下标。
 */

/**
 * 用空格分词的文字里"单词的一部分"：字母、数字（含组合附加符号）。中文、日文不用空格分词，任意两个字之间都可以断开。
 * 韩文虽然也是中日韩文字，但用空格分词（띄어쓰기），按普通字母处理
 */
const WORD_CHAR = /^[\p{L}\p{N}\p{M}]+$/u;
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
export const isWordChar = (g: string | undefined) => g !== undefined && WORD_CHAR.test(g) && !NO_SPACE_SCRIPT.test(g);

/** 截断点落在单词中间时，最多移动这么多个字素去找单词边界；再长的"单词"（如一长串网址）就直接切断 */
export const WORD_BACKOFF = 30;

/** 截断点 at 前后都是单词字符：切在单词中间 */
const insideWord = (graphemes: string[], at: number) => isWordChar(graphemes[at - 1]) && isWordChar(graphemes[at]);

/**
 * 结尾的截断点：如果正好切在一个西文单词中间（"Type|Script"），退到这个单词的开头。
 * 单词前面是空格、中日文字还是标点都可以：在它后面断开即可（"以及TypeScript" 断在"及"后面，不会把"以及"也丢掉）
 */
export function wordSafeEnd(graphemes: string[], at: number): number {
  if (!insideWord(graphemes, at)) return at;
  let i = at - 1;
  while (i > 0 && isWordChar(graphemes[i - 1])) i--;
  // 整段都是一个单词，或单词太长：直接切断
  return i === 0 || at - i > WORD_BACKOFF ? at : i;
}

/**
 * 开头的截断点：如果切在单词中间（"Red|is"），前进到这个单词的末尾，片段从下一个词开始。
 * 不超过 limit（片段必须包含的第一处匹配的位置）；做不到就保持原样。
 */
export function wordSafeStart(graphemes: string[], at: number, limit: number): number {
  if (!insideWord(graphemes, at)) return at;
  let i = at;
  while (i < graphemes.length && isWordChar(graphemes[i])) i++;
  return i > limit || i - at > WORD_BACKOFF ? at : i;
}
