import { describe, expect, it } from "vitest";
import { isLikelyBot, siteDay } from "./views.ts";

describe("siteDay", () => {
  it("uses the site time zone, not UTC", () => {
    // UTC 10 月 9 日 17:00 = 北京时间 10 月 10 日 01:00
    expect(siteDay(new Date("2026-10-09T17:00:00Z"))).toBe("2026-10-10");
    expect(siteDay(new Date("2026-10-09T15:59:59Z"))).toBe("2026-10-09");
  });
});

describe("isLikelyBot", () => {
  it.each([
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", true],
    ["curl/8.7.1", true],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 HeadlessChrome/140.0", true],
    [undefined, true],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1", false],
  ])("%s → %s", (ua, expected) => {
    expect(isLikelyBot(ua)).toBe(expected);
  });
});
