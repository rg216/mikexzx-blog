import { locales } from "@blog/shared";
import { describe, expect, it } from "vitest";
import { getDictionary } from "./index";

/*
 * key 是否齐全由类型保证（en / ja 标注为 Dictionary）；这里补上类型管不到的：
 * 没有空字符串、数组长度一致（关于页的段落），以及带参数的文案在各语言里的输出。
 */

type Leaf = string | ((...args: never[]) => string);

function leaves(value: unknown, path = ""): Array<[string, Leaf | number]> {
  if (typeof value === "string" || typeof value === "function") return [[path, value as Leaf]];
  if (Array.isArray(value)) return [[`${path}.length`, value.length], ...value.flatMap((item, i) => leaves(item, `${path}[${i}]`))];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => leaves(item, path ? `${path}.${key}` : key));
}

// 语序 / 空格相关的片段，有的语言就是空的
const mayBeEmpty = ["identityBefore", "identityAfter", "separator"];

describe("dictionaries", () => {
  const reference = leaves(getDictionary("zh"));

  it.each(locales)("%s has the same shape as zh and no empty strings", (locale) => {
    const entries = leaves(getDictionary(locale));
    expect(entries.map(([path]) => path)).toEqual(reference.map(([path]) => path));
    for (const [path, value] of entries) {
      if (path.endsWith(".length")) expect(value, path).toBe(reference.find(([p]) => p === path)?.[1]);
      else if (typeof value === "string" && !mayBeEmpty.some((key) => path.endsWith(key))) expect(value, path).not.toBe("");
    }
  });

  it.each(locales)("%s names every locale", (locale) => {
    expect(Object.keys(getDictionary(locale).languageNames)).toEqual([...locales]);
  });

  it("pluralizes English counts", () => {
    const en = getDictionary("en");
    expect(en.search.found(1)).toBe("1 post found");
    expect(en.search.found(3)).toBe("3 posts found");
    expect(en.search.found(0)).toBe("0 posts found");
    expect(en.post.views(1, "1")).toBe("1 view");
    expect(en.post.views(1234, "1,234")).toBe("1,234 views");
    expect(en.home.tagCount(1)).toBe("1 post");
    expect(en.home.tagCount(2)).toBe("2 posts");
  });

  it("puts parameters where each language wants them", () => {
    expect(getDictionary("zh").search.nothingFound("next")).toBe("没有找到与“next”相关的文章");
    expect(getDictionary("ja").search.nothingFound("next")).toBe("「next」に一致する記事は見つかりませんでした");
    expect(getDictionary("en").post.notice.untranslated("Chinese")).toContain("original in Chinese");
    expect(getDictionary("ja").post.notice.untranslated("中国語")).toContain("中国語の原文");
    expect(getDictionary("zh").comments.form.replyLabel("octocat")).toBe("回复 @octocat");
    // 阅读数：日文的写法由站长指定（"閲覧数 1,234"），中文沿用原来的"1,234 次阅读"
    expect(getDictionary("ja").post.views(1234, "1,234")).toBe("閲覧数 1,234");
    expect(getDictionary("zh").post.views(1234, "1,234")).toBe("1,234 次阅读");
  });
});
