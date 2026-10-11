import { describe, expect, it } from "vitest";
import { contentLang } from "./content-lang";

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
