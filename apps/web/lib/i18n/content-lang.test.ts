import { describe, expect, it } from "vitest";
import { contentLang, tagLocale } from "./content-lang";

describe("contentLang", () => {
  it("returns nothing when the content is in the page's language", () => {
    expect(contentLang("zh", "zh")).toBeUndefined();
    expect(contentLang("en", "en")).toBeUndefined();
  });

  it("returns the full tag of the content's language otherwise", () => {
    expect(contentLang("zh", "ja")).toBe("zh-CN");
    expect(contentLang("zh", "en")).toBe("zh-CN");
    expect(contentLang("en", "zh")).toBe("en");
  });
});

describe("tag names", () => {
  it("are marked as Chinese on en/ja pages and not marked on zh pages", () => {
    expect(contentLang(tagLocale, "ja")).toBe("zh-CN");
    expect(contentLang(tagLocale, "en")).toBe("zh-CN");
    expect(contentLang(tagLocale, "zh")).toBeUndefined();
  });
});
