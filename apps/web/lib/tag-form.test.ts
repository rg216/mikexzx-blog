import type { AdminTag, TagTranslations } from "@blog/shared";
import { describe, expect, it } from "vitest";
import { adminLanguageName, tagFormValues, tagSuggestions, validateTagForm } from "./tag-form";

const tag = (id: number, slug: string, name: string, translations: TagTranslations = {}): AdminTag => ({
  id,
  slug,
  name,
  translations,
  postCount: 0,
  publishedCount: 0,
});
const existing = [
  tag(1, "css", "CSS", { en: "CSS", ja: "CSS" }),
  tag(2, "design", "设计", { en: "Design", ja: "デザイン" }),
  tag(3, "frontend", "前端", { en: "Frontend", ja: "フロントエンド" }),
];
const form = (name: string, slug: string, en = "En name", ja = "日本語名") => ({ name, slug, translations: { zh: "", en, ja } });

describe("tagFormValues", () => {
  it("starts empty, or from the tag being edited with blanks for missing translations", () => {
    expect(tagFormValues()).toEqual({ name: "", slug: "", translations: { en: "", ja: "" } });
    expect(tagFormValues(tag(9, "old", "旧", { en: "Old" }))).toEqual({ name: "旧", slug: "old", translations: { en: "Old", ja: "" } });
  });
});

describe("validateTagForm", () => {
  const values = (name: string, slug: string, en = "Next.js", ja = "Next.js") => ({ ...tagFormValues(), name, slug, translations: { en, ja } });

  it("accepts a new tag and derives the slug from a Latin name", () => {
    expect(validateTagForm(values(" Next.js ", ""), existing)).toEqual({
      data: { name: "Next.js", slug: "nextjs", translations: { en: "Next.js", ja: "Next.js" } },
      errors: {},
    });
  });

  it("normalizes a typed slug", () => {
    expect(validateTagForm(values("排版", "Typography ", "Typography", "タイポグラフィ"), existing).data?.slug).toBe("typography");
  });

  it("asks for a slug when the name has no Latin letters", () => {
    expect(validateTagForm(values("排版", "", "Typography", "タイポグラフィ"), existing).errors).toEqual({ slug: expect.stringContaining("手动填写") });
  });

  it("requires a name in every other language", () => {
    expect(validateTagForm(values("排版", "typography", "  ", ""), existing).errors).toEqual({ translations: { en: "请填写译名", ja: "请填写译名" } });
    expect(validateTagForm(values("排版", "typography", "x".repeat(51), "タイポグラフィ"), existing).errors).toEqual({
      translations: { en: "译名不能超过 50 个字符" },
    });
  });

  it("reports schema errors on the right field", () => {
    expect(validateTagForm(values("   ", "x"), existing).errors).toEqual({ name: "请填写名称" });
    expect(validateTagForm(values("长".repeat(51), "x"), existing).errors.name).toBe("名称不能超过 50 个字符");
  });

  it("catches duplicate names (ignoring case), slugs and translated names", () => {
    expect(validateTagForm(values("css", "css-2", "Cascading", "カスケード"), existing).errors).toEqual({ name: "已经有标签「CSS」了" });
    expect(validateTagForm(values("视觉", "design", "Visual", "ビジュアル"), existing).errors).toEqual({ slug: 'slug "design" 已被「设计」使用' });
    expect(validateTagForm(values("视觉", "visual", "design", "ビジュアル"), existing).errors).toEqual({
      translations: { en: "「设计」在这种语言里也叫「Design」" },
    });
  });

  it("does not compare a tag with itself when editing", () => {
    expect(validateTagForm(values("Css", "css", "CSS", "CSS"), existing, 1).data).toEqual({ name: "Css", slug: "css", translations: { en: "CSS", ja: "CSS" } });
    expect(validateTagForm(values("前端", "css", "CSS", "CSS"), existing, 1).errors).toEqual({ name: "已经有标签「前端」了" });
  });

  it("ignores a stray value for the original language", () => {
    expect(validateTagForm(form("视觉", "visual"), existing).data?.translations).toEqual({ en: "En name", ja: "日本語名" });
  });
});

describe("tagSuggestions", () => {
  it("leaves out selected tags and caps the list when nothing is typed", () => {
    expect(tagSuggestions(existing, ["css"], "", 1).map((t) => t.slug)).toEqual(["design"]);
  });

  it("matches name, slug or any translated name without case, returning every match", () => {
    expect(tagSuggestions(existing, [], "Fr", 1).map((t) => t.slug)).toEqual(["frontend"]);
    expect(tagSuggestions(existing, [], "前", 1).map((t) => t.slug)).toEqual(["frontend"]);
    expect(tagSuggestions(existing, [], "デザ", 1).map((t) => t.slug)).toEqual(["design"]);
    expect(tagSuggestions(existing, [], "s", 1).map((t) => t.slug)).toEqual(["css", "design"]);
    expect(tagSuggestions(existing, ["css"], "css", 5)).toEqual([]);
  });
});

describe("adminLanguageName", () => {
  it("names languages in Chinese for the admin UI", () => {
    expect(adminLanguageName("en")).toBe("英语");
    expect(adminLanguageName("ja")).toBe("日语");
  });
});
