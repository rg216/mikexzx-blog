import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime } from "./admin-format";

describe("formatDateTime", () => {
  it("formats date and 24h time in the site time zone", () => {
    // UTC 10 月 8 日 20:05 = 北京时间 10 月 9 日 04:05
    expect(formatDateTime("2026-10-08T20:05:00Z")).toBe("2026/10/9 04:05");
  });
});

describe("formatTime", () => {
  it("formats hours and minutes in the site time zone", () => {
    expect(formatTime(new Date("2026-10-08T06:30:00Z"))).toBe("14:30");
  });
});
