import { describe, expect, it } from "vitest";
import { isNavLinkActive } from "./nav";

describe("isNavLinkActive", () => {
  it.each([
    ["/", "/", true],
    ["/", "/posts/a", true],
    ["/", "/zh/posts/a", true],
    ["/", "/about", false],
    ["/about", "/about", true],
    ["/about", "/zh/about", true],
    ["/en", "/en", true],
    ["/en", "/en/posts/a", true],
    ["/en", "/en/about", false],
    ["/en/about", "/en/about", true],
    ["/en/search", "/en/search", true],
    // 语言不同就不是同一个页面
    ["/about", "/en/about", false],
    ["/en/about", "/about", false],
    // 只是前缀相同的其他路径
    ["/about", "/aboutx", false],
    // 后台导航
    ["/admin/posts", "/admin/posts", true],
    ["/admin/posts", "/admin/posts/3", true],
    ["/admin/media", "/admin/posts", false],
  ])("%s on %s → %s", (href, pathname, expected) => {
    expect(isNavLinkActive(href, pathname)).toBe(expected);
  });
});
