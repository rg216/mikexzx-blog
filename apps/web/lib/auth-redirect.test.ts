import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_LOGIN, safeNextPath } from "./auth-redirect";

describe("safeNextPath", () => {
  it.each([
    ["/admin/posts/2", "/admin/posts/2"],
    ["/admin/posts?tab=drafts#top", "/admin/posts?tab=drafts#top"],
    ["/admin/settings", "/admin/settings"],
  ])("keeps same-site path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["absolute URL", "https://evil.example/admin"],
    ["protocol-relative URL", "//evil.example"],
    ["backslash trick", "/\\evil.example"],
    ["javascript: URL", "javascript:alert(1)"],
    ["relative path", "admin/posts"],
    ["the login page itself", "/admin/login?next=/admin"],
  ])("falls back to the default for a %s", (_name, input) => {
    expect(safeNextPath(input)).toBe(DEFAULT_AFTER_LOGIN);
  });
});
