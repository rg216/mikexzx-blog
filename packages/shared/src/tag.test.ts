import { describe, expect, it } from "vitest";
import { missingTagTranslations, tagInputSchema, tagTranslationLocales, tagUpdateInputSchema } from "./tag.ts";

describe("tag translations", () => {
  it("needs a name in every language except the original one", () => {
    expect(tagTranslationLocales).toEqual(["en", "ja"]);
  });

  it("requires all of them when creating a tag", () => {
    const base = { slug: "design", name: "设计" };
    expect(tagInputSchema.parse({ ...base, translations: { en: " Design ", ja: "デザイン" } }).translations).toEqual({ en: "Design", ja: "デザイン" });
    const missing = tagInputSchema.safeParse({ ...base, translations: { en: "Design" } });
    expect(missing.error?.issues.map((i) => i.path.join("."))).toEqual(["translations.ja"]);
    const extra = tagInputSchema.safeParse({ ...base, translations: { zh: "设计", en: "Design", ja: "デザイン" } });
    expect(extra.error?.issues.map((i) => i.path.join("."))).toEqual(["translations.zh"]);
    expect(tagInputSchema.safeParse(base).success).toBe(false);
  });

  it("lets an update leave them out, but not give only some", () => {
    expect(tagUpdateInputSchema.safeParse({ name: "设计" }).success).toBe(true);
    expect(tagUpdateInputSchema.safeParse({ translations: { en: "Design" } }).success).toBe(false);
  });

  it("lists the languages a tag still lacks", () => {
    expect(missingTagTranslations({ translations: {} })).toEqual(["en", "ja"]);
    expect(missingTagTranslations({ translations: { en: "Design", ja: " " } })).toEqual(["ja"]);
    expect(missingTagTranslations({ translations: { en: "Design", ja: "デザイン" } })).toEqual([]);
  });
});
