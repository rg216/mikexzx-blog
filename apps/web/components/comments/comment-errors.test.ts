import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n";
import { commentErrorText } from "./comment-errors";

describe("commentErrorText", () => {
  const t = getDictionary("en").comments.errors;

  it.each([
    ["network", t.network],
    ["rate_limited", t.rateLimited],
    ["invalid", t.invalid],
    ["unauthorized", t.unauthorized],
    ["forbidden", t.forbidden],
    ["not_found", t.notFound],
    ["unavailable", t.unavailable],
  ] as const)("maps %s to its own message", (reason, text) => {
    expect(commentErrorText(t, reason)).toBe(text);
  });

  it("uses the more specific fallback only for server-side problems", () => {
    expect(commentErrorText(t, "unavailable", t.deleteFailed)).toBe(t.deleteFailed);
    expect(commentErrorText(t, "network", t.deleteFailed)).toBe(t.network);
  });

  it("never shows Chinese on English pages", () => {
    for (const reason of ["network", "rate_limited", "invalid", "unauthorized", "forbidden", "not_found", "unavailable"] as const) {
      expect(commentErrorText(t, reason)).not.toMatch(/[一-鿿]/);
    }
  });
});
