import { describe, expect, it } from "vitest";
import { formatDate } from "./format";

describe("formatDate", () => {
  it("formats in the site time zone, not the machine's", () => {
    // UTC 10 月 8 日 20:00 = 北京时间 10 月 9 日 04:00
    expect(formatDate("2026-10-08T20:00:00Z")).toBe("2026年10月9日");
  });

  it("respects explicit offsets", () => {
    expect(formatDate("2026-10-09T00:30:00+08:00")).toBe("2026年10月9日");
  });
});
