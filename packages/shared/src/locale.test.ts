import { describe, expect, it } from "vitest";
import { defaultLocale, defaultSourceLocale, isLocale, localeInfo, localeQuerySchema, locales, localeSchema } from "./locale.ts";

describe("locales", () => {
  it("lists Chinese first as the default, unprefixed language", () => {
    expect(locales).toEqual(["zh", "en", "ja"]);
    expect(defaultLocale).toBe("zh");
    expect(defaultSourceLocale).toBe("zh");
  });

  it("describes every language with a BCP 47 tag, its own name and an excerpt length", () => {
    expect(Object.keys(localeInfo).sort()).toEqual([...locales].sort());
    for (const locale of locales) {
      const info = localeInfo[locale];
      // 完整标签以语言代码开头（zh-CN 之于 zh），hreflang 和 <html lang> 才对得上
      expect(info.tag === locale || info.tag.startsWith(`${locale}-`)).toBe(true);
      expect(Intl.getCanonicalLocales(info.tag)).toEqual([info.tag]);
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.excerptLength).toBeGreaterThan(0);
    }
    // 中文用 zh-CN：浏览器据此选简体字形
    expect(localeInfo.zh.tag).toBe("zh-CN");
  });

  it("uses language codes that fit the database's format check", () => {
    for (const locale of locales) expect(locale).toMatch(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
  });
});

describe("isLocale / localeSchema", () => {
  it.each(["zh", "en", "ja"])("accepts %s", (value) => {
    expect(isLocale(value)).toBe(true);
    expect(localeSchema.safeParse(value).success).toBe(true);
  });

  it.each(["", "fr", "EN", "zh-CN", "en-US", "toString", "__proto__"])("rejects %j", (value) => {
    expect(isLocale(value)).toBe(false);
    expect(localeSchema.safeParse(value).success).toBe(false);
  });
});

describe("localeQuerySchema", () => {
  it("defaults to the default language for clients that send no locale", () => {
    expect(localeQuerySchema.parse({})).toEqual({ locale: "zh" });
    expect(localeQuerySchema.parse({ locale: "en" })).toEqual({ locale: "en" });
    expect(localeQuerySchema.safeParse({ locale: "fr" }).success).toBe(false);
  });
});
