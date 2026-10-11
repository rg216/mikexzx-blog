import { describe, expect, it } from "vitest";
import { browserPath, localePath, postPath, stripLocale, switchLocalePath } from "./paths";

describe("localePath", () => {
  it.each([
    ["zh", "/", "/"],
    ["zh", "/posts/a", "/posts/a"],
    ["en", "/", "/en"],
    ["en", "/posts/a", "/en/posts/a"],
    ["ja", "/search", "/ja/search"],
  ] as const)("%s + %s → %s", (locale, path, expected) => {
    expect(localePath(locale, path)).toBe(expected);
  });

  it("builds post paths", () => {
    expect(postPath("zh", "hello")).toBe("/posts/hello");
    expect(postPath("ja", "hello")).toBe("/ja/posts/hello");
  });
});

describe("stripLocale", () => {
  it.each([
    ["/", "zh", "/"],
    ["/about", "zh", "/about"],
    ["/posts/a", "zh", "/posts/a"],
    ["/en", "en", "/"],
    ["/en/", "en", "/"],
    ["/en/posts/a", "en", "/posts/a"],
    ["/ja/search", "ja", "/search"],
    // rewrite 之后的路由路径（服务端预渲染时 usePathname 的值）
    ["/zh", "zh", "/"],
    ["/zh/about", "zh", "/about"],
    // 只是以语言代码开头的普通路径，不是前缀
    ["/english", "zh", "/english"],
    ["/enx/a", "zh", "/enx/a"],
    ["/admin/posts", "zh", "/admin/posts"],
    ["", "zh", "/"],
  ])("%s → %s %s", (pathname, locale, path) => {
    expect(stripLocale(pathname)).toEqual({ locale, path });
  });

  it("strips only one prefix", () => {
    expect(stripLocale("/zh/zh/about")).toEqual({ locale: "zh", path: "/zh/about" });
    expect(stripLocale("/en/ja")).toEqual({ locale: "en", path: "/ja" });
  });
});

describe("browserPath", () => {
  it("maps route paths and browser URLs to the same browser URL", () => {
    expect(browserPath("/zh/posts/a")).toBe("/posts/a");
    expect(browserPath("/posts/a")).toBe("/posts/a");
    expect(browserPath("/zh")).toBe("/");
    expect(browserPath("/en/posts/a")).toBe("/en/posts/a");
  });
});

describe("switchLocalePath", () => {
  it.each([
    ["/", "en", "/en"],
    ["/posts/a", "ja", "/ja/posts/a"],
    ["/en/posts/a", "zh", "/posts/a"],
    ["/en/posts/a", "ja", "/ja/posts/a"],
    ["/ja", "zh", "/"],
    ["/zh/about", "en", "/en/about"],
    ["/en/search", "en", "/en/search"],
  ] as const)("%s → %s: %s", (pathname, target, expected) => {
    expect(switchLocalePath(pathname, target)).toBe(expected);
  });

  it("keeps the search query on the search page", () => {
    expect(switchLocalePath("/search", "ja", "?q=缓存")).toBe("/ja/search?q=%E7%BC%93%E5%AD%98");
    expect(switchLocalePath("/en/search", "zh", "?q=edge+caching&x=1")).toBe("/search?q=edge+caching");
    expect(switchLocalePath("/zh/search", "en", "?q=a%26b")).toBe("/en/search?q=a%26b");
  });

  it("drops an empty or missing query", () => {
    expect(switchLocalePath("/en/search", "zh", "")).toBe("/search");
    expect(switchLocalePath("/en/search", "zh", "?q=")).toBe("/search");
  });

  it("drops one-off parameters on other pages", () => {
    expect(switchLocalePath("/posts/x", "en", "?login=failed")).toBe("/en/posts/x");
    expect(switchLocalePath("/posts/x", "en", "?q=foo")).toBe("/en/posts/x");
  });
});
