import { describe, expect, it } from "vitest";
import { buildSearchQuery, buildSearchVector, buildSnippet, findHighlights, MAX_INDEXED_BODY_CHARS, splitTerms } from "./search-text.ts";

/** 把 tsvector 字面量解析回 { 词条: 位置列表 }，方便断言 */
function parseVector(literal: string): Record<string, string[]> {
  return Object.fromEntries(
    [...literal.matchAll(/'((?:[^']|'')+)':(\S+)/g)].map(([, lexeme = "", positions = ""]) => [lexeme.replaceAll("''", "'"), positions.split(",")]),
  );
}

const marked = (text: string, query: string) =>
  findHighlights(text, query).map(({ start, end }) => text.slice(start, end));

describe("splitTerms", () => {
  it("separates CJK runs from words and normalizes width and case", () => {
    expect(splitTerms("用Ｎｅｘｔ.js写全栈 App！v4b阶段")).toEqual([
      { cjk: true, text: "用" },
      { cjk: false, text: "next" },
      { cjk: false, text: "js" },
      { cjk: true, text: "写全栈" },
      { cjk: false, text: "app" },
      { cjk: false, text: "v4b" },
      { cjk: true, text: "阶段" },
    ]);
  });

  it("treats kana (with the prolonged sound mark) and hangul as CJK", () => {
    expect(splitTerms("コーヒー 한국어")).toEqual([
      { cjk: true, text: "コーヒー" },
      { cjk: true, text: "한국어" },
    ]);
  });

  it("skips absurdly long words such as hashes", () => {
    expect(splitTerms(`a${"x".repeat(100)} ok`)).toEqual([{ cjk: false, text: "ok" }]);
  });
});

describe("buildSearchVector", () => {
  it("indexes CJK text as unigrams plus bigrams, each bigram at its first character's position", () => {
    expect(parseVector(buildSearchVector({ title: "", tags: [], body: "全栈开" }))).toEqual({
      全: ["2"],
      全栈: ["2"],
      栈: ["3"],
      栈开: ["3"],
      开: ["4"],
    });
  });

  it("weights title A, tags B and body D", () => {
    const vector = parseVector(buildSearchVector({ title: "Hono", tags: ["后端"], body: "hono" }));
    expect(vector.hono).toEqual(["1A", "6"]);
    expect(vector.后端).toEqual(["3B"]);
  });

  it("does not form bigrams across separate runs", () => {
    expect(parseVector(buildSearchVector({ title: "", tags: [], body: "全栈，开发" }))).not.toHaveProperty("栈开");
  });

  it("escapes quotes and backslashes defensively", () => {
    // 分词结果只含字母数字，碰不到引号；这里直接测转义不出错的前提：结果总能被解析回来
    expect(buildSearchVector({ title: "it's a\\b", tags: [], body: "" })).toBe("'it':1A 's':2A 'a':3A 'b':4A");
  });

  it("caps positions per lexeme and the position value like Postgres does", () => {
    const vector = parseVector(buildSearchVector({ title: "", tags: [], body: "word ".repeat(20_000) }));
    expect(vector.word).toHaveLength(256);
    // 每个汉字占一个位置：17000 个字之后的词超过了位置上限
    const long = parseVector(buildSearchVector({ title: "", tags: [], body: `${"字".repeat(17_000)} tail` }));
    expect(long.tail).toEqual(["16383"]);
  });

  it(`only indexes the first ${MAX_INDEXED_BODY_CHARS} characters of the body`, () => {
    const body = `${"字".repeat(MAX_INDEXED_BODY_CHARS)}尾巴`;
    expect(parseVector(buildSearchVector({ title: "", tags: [], body }))).not.toHaveProperty("尾巴");
  });
});

describe("buildSearchQuery", () => {
  it("ANDs CJK bigrams and prefix-matches words", () => {
    expect(buildSearchQuery("全栈开发 Next")).toBe("'全栈' & '栈开' & '开发' & 'next':*");
  });

  it("uses the single character for one-character CJK terms", () => {
    expect(buildSearchQuery("博")).toBe("'博'");
  });

  it("deduplicates repeated lexemes", () => {
    expect(buildSearchQuery("next NEXT 全栈 全栈")).toBe("'next':* & '全栈'");
  });

  it("returns null when nothing is searchable", () => {
    expect(buildSearchQuery("!!! ？？ —")).toBeNull();
  });

  it("never lets query syntax through", () => {
    // 操作符和引号都被当作分隔符丢掉，用户输入不可能改变查询结构
    expect(buildSearchQuery("a' | !b & (c:*) <-> d")).toBe("'a':* & 'b':* & 'c':* & 'd':*");
  });

  it("limits the number of terms", () => {
    const query = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
    expect(buildSearchQuery(query)?.split(" & ")).toHaveLength(10);
  });
});

describe("findHighlights", () => {
  it("merges overlapping bigram matches into the whole phrase", () => {
    expect(marked("学习全栈开发的过程", "全栈开发")).toEqual(["全栈开发"]);
  });

  it("highlights scattered bigrams separately", () => {
    expect(marked("全栈和开发", "全栈开发")).toEqual(["全栈", "开发"]);
  });

  it("matches words by prefix at word starts only, case-insensitively", () => {
    expect(marked("Deploying redeploy deploy", "deploy")).toEqual(["Deploy", "deploy"]);
  });

  it("allows a word to start right after a CJK character", () => {
    expect(marked("用Next写", "next")).toEqual(["Next"]);
  });

  it("maps matches on normalized text back to the original characters", () => {
    const text = "全角 Ｎｅｘｔ 文字";
    expect(marked(text, "next")).toEqual(["Ｎｅｘｔ"]);
  });

  it("uses UTF-16 offsets that stay correct after astral characters", () => {
    const text = "😀😀 hono";
    expect(findHighlights(text, "hono")).toEqual([{ start: 5, end: 9 }]);
  });
});

describe("buildSnippet", () => {
  const text = `${"前".repeat(100)}关键词${"后".repeat(100)}`;

  it("returns short text whole", () => {
    expect(buildSnippet("短文本", [{ start: 0, end: 2 }])).toEqual({ text: "短文本", highlights: [{ start: 0, end: 2 }] });
  });

  it("centers on the first match with some leading context and ellipses", () => {
    const snippet = buildSnippet(text, findHighlights(text, "关键词"), { length: 30, context: 5 });
    expect(snippet.text).toBe(`…${"前".repeat(5)}关键词${"后".repeat(22)}…`);
    expect(snippet.highlights.map(({ start, end }) => snippet.text.slice(start, end))).toEqual(["关键词"]);
  });

  it("starts at the beginning when there is no match in the body", () => {
    expect(buildSnippet(text, [], { length: 3 })).toEqual({ text: "前前前…", highlights: [] });
  });

  it("clips highlights that cross the window edge", () => {
    const snippet = buildSnippet("abcdefghij", [{ start: 2, end: 8 }], { length: 4, context: 0 });
    expect(snippet).toEqual({ text: "…cdef…", highlights: [{ start: 1, end: 5 }] });
  });

  it("does not cut emoji in half", () => {
    const snippet = buildSnippet("👩‍💻👩‍💻👩‍💻", [], { length: 2 });
    expect(snippet.text).toBe("👩‍💻👩‍💻…");
  });

  it("trims spaces at the cut without shifting highlights", () => {
    const words = "one two three four five";
    const snippet = buildSnippet(words, findHighlights(words, "four"), { length: 10, context: 5 });
    expect(snippet.highlights.map(({ start, end }) => snippet.text.slice(start, end))).toEqual(["four"]);
    expect(snippet.text.startsWith("… ")).toBe(false);
  });
});
