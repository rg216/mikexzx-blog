import { describe, expect, it } from "vitest";
import { pageAlternates, postAlternates } from "./alternates";

describe("pageAlternates", () => {
  it("links every locale and points canonical at itself", () => {
    expect(pageAlternates("en", "/about")).toEqual({
      canonical: "/en/about",
      languages: { "zh-CN": "/about", en: "/en/about", ja: "/ja/about", "x-default": "/about" },
    });
  });

  it("handles the home page", () => {
    expect(pageAlternates("zh", "/")).toEqual({
      canonical: "/",
      languages: { "zh-CN": "/", en: "/en", ja: "/ja", "x-default": "/" },
    });
  });
});

describe("postAlternates", () => {
  it("lists only the versions that exist, with x-default on the original", () => {
    expect(postAlternates({ slug: "a", locale: "en", sourceLocale: "zh", availableLocales: ["zh", "en"] })).toEqual({
      canonical: "/en/posts/a",
      languages: { "zh-CN": "/posts/a", en: "/en/posts/a", "x-default": "/posts/a" },
    });
  });

  it("points canonical at the original when showing it as a fallback", () => {
    // 请求 /ja/posts/a，但没有日文译文：API 返回原文（locale = zh）
    const alternates = postAlternates({ slug: "a", locale: "zh", sourceLocale: "zh", availableLocales: ["zh", "en"] });
    expect(alternates.canonical).toBe("/posts/a");
    expect(alternates.languages).not.toHaveProperty("ja");
  });

  it("uses the source locale for x-default even when it is not the default locale", () => {
    const alternates = postAlternates({ slug: "b", locale: "ja", sourceLocale: "en", availableLocales: ["en", "ja"] });
    expect(alternates.languages).toEqual({ en: "/en/posts/b", ja: "/ja/posts/b", "x-default": "/en/posts/b" });
  });
});
