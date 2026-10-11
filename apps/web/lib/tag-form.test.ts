import type { AdminTag } from "@blog/shared";
import { describe, expect, it } from "vitest";
import { tagSuggestions, validateTagForm } from "./tag-form";

const tag = (id: number, slug: string, name: string): AdminTag => ({ id, slug, name, postCount: 0, publishedCount: 0 });
const existing = [tag(1, "css", "CSS"), tag(2, "design", "设计"), tag(3, "frontend", "前端")];

describe("validateTagForm", () => {
  it("accepts a new tag and derives the slug from a Latin name", () => {
    expect(validateTagForm({ name: " Next.js ", slug: "" }, existing)).toEqual({ data: { name: "Next.js", slug: "nextjs" }, errors: {} });
  });

  it("normalizes a typed slug", () => {
    expect(validateTagForm({ name: "排版", slug: "Typography " }, existing).data).toEqual({ name: "排版", slug: "typography" });
  });

  it("asks for a slug when the name has no Latin letters", () => {
    expect(validateTagForm({ name: "排版", slug: "" }, existing).errors).toEqual({ slug: expect.stringContaining("手动填写") });
  });

  it("reports schema errors on the right field", () => {
    expect(validateTagForm({ name: "   ", slug: "x" }, existing).errors).toEqual({ name: "请填写名称" });
    expect(validateTagForm({ name: "长".repeat(51), slug: "x" }, existing).errors.name).toBe("名称不能超过 50 个字符");
  });

  it("catches duplicate names (ignoring case) and slugs", () => {
    expect(validateTagForm({ name: "css", slug: "css-2" }, existing).errors).toEqual({ name: "已经有标签「CSS」了" });
    expect(validateTagForm({ name: "视觉", slug: "design" }, existing).errors).toEqual({ slug: 'slug "design" 已被「设计」使用' });
  });

  it("does not compare a tag with itself when editing", () => {
    expect(validateTagForm({ name: "Css", slug: "css" }, existing, 1).data).toEqual({ name: "Css", slug: "css" });
    expect(validateTagForm({ name: "前端", slug: "css" }, existing, 1).errors).toEqual({ name: "已经有标签「前端」了" });
  });
});

describe("tagSuggestions", () => {
  it("leaves out selected tags and caps the list when nothing is typed", () => {
    expect(tagSuggestions(existing, ["css"], "", 1).map((t) => t.slug)).toEqual(["design"]);
  });

  it("matches name or slug without case, returning every match", () => {
    expect(tagSuggestions(existing, [], "Fr", 1).map((t) => t.slug)).toEqual(["frontend"]);
    expect(tagSuggestions(existing, [], "前", 1).map((t) => t.slug)).toEqual(["frontend"]);
    expect(tagSuggestions(existing, [], "s", 1).map((t) => t.slug)).toEqual(["css", "design"]);
    expect(tagSuggestions(existing, ["css"], "css", 5)).toEqual([]);
  });
});
