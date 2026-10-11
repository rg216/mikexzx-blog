import { modifyRouteRegex } from "next/dist/lib/redirect-status";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { describe, expect, it } from "vitest";
import { defaultLocalePathPattern, defaultLocaleRewrites } from "./locale-routing";

/*
 * 用 Next 自己的匹配函数（与 server/lib/router-utils/filesystem.js 的 buildCustomRoute 相同的参数）模拟 rewrites，
 * 而不是自己用 path-to-regexp 近似：source 的写法（命名参数 + 自定义正则）稍有不对，Next 就会悄悄不匹配。
 * 这些是 Next 的内部模块，next 版本是锁定的；升级后这里报错说明内部结构变了，要重新确认 rewrite 行为。
 */
function rewrite(pathname: string): string | null {
  for (const rule of defaultLocaleRewrites()) {
    const match = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true, regexModifier: (regex) => modifyRouteRegex(regex) });
    const params = match(pathname);
    if (!params) continue;
    return prepareDestination({ appendParamsToQuery: false, destination: rule.destination, params, query: {} }).parsedDestination.pathname ?? null;
  }
  return null;
}

describe("default locale rewrites (as matched by Next)", () => {
  it.each([
    ["/", "/zh"],
    ["/about", "/zh/about"],
    ["/posts/x", "/zh/posts/x"],
    ["/search", "/zh/search"],
    // 只是以 en 开头，不是 /en 前缀
    ["/english", "/zh/english"],
    ["/ja-guide/x", "/zh/ja-guide/x"],
    // 中文只有一套网址：/zh/… 被重写成 /zh/zh/…，由 [...rest] 返回 404
    ["/zh/about", "/zh/zh/about"],
    // 不支持的语言：同样落到中文的 404
    ["/fr/about", "/zh/fr/about"],
  ])("rewrites %s to %s", (pathname, target) => {
    expect(rewrite(pathname)).toBe(target);
  });

  it.each(["/en", "/en/", "/en/about", "/ja/posts/x", "/admin", "/admin/posts/1", "/api/x", "/hooks/revalidate", "/_next/static/x.js"])(
    "leaves %s alone",
    (pathname) => {
      expect(rewrite(pathname)).toBeNull();
    },
  );
});

describe("defaultLocalePathPattern", () => {
  const re = new RegExp(`^/${defaultLocalePathPattern()}$`);

  it("excludes the non-default locales and reserved prefixes only as whole segments", () => {
    expect(re.test("/about")).toBe(true);
    expect(re.test("/english")).toBe(true);
    expect(re.test("/apis")).toBe(true);
    expect(re.test("/en")).toBe(false);
    expect(re.test("/ja/x")).toBe(false);
    expect(re.test("/hooks/revalidate")).toBe(false);
  });

  it("derives the locale list from @blog/shared instead of hard-coding it", () => {
    expect(defaultLocalePathPattern()).toBe("(?!(?:en|ja|admin|api|hooks|_next)(?:/|$)).*");
  });
});
