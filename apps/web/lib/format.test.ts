import { describe, expect, it } from "vitest";
import { formatDate, formatNumber } from "./format";

describe("formatDate", () => {
  it.each([
    ["zh", "2026年10月9日"],
    ["en", "October 9, 2026"],
    ["ja", "2026年10月9日"],
  ] as const)("formats %s dates in the site time zone, not the machine's", (locale, expected) => {
    // UTC 10 月 8 日 20:00 = 北京时间 10 月 9 日 04:00：所有语言都显示 9 日
    expect(formatDate("2026-10-08T20:00:00Z", locale)).toBe(expected);
  });

  it("respects explicit offsets", () => {
    expect(formatDate("2026-10-09T00:30:00+08:00", "en")).toBe("October 9, 2026");
  });

  it("keeps one formatter per locale", () => {
    // 缓存按语言区分：先格式化英文不会让中文也变成英文
    expect(formatDate("2026-01-02T00:00:00Z", "en")).toBe("January 2, 2026");
    expect(formatDate("2026-01-02T00:00:00Z", "zh")).toBe("2026年1月2日");
  });
});

describe("formatNumber", () => {
  it.each(["zh", "en", "ja"] as const)("groups thousands in %s", (locale) => {
    expect(formatNumber(12345, locale)).toBe("12,345");
  });
});
