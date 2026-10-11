import { defaultLocale, locales } from "@blog/shared";

/*
 * 默认语言（中文）的网址不带前缀，而页面都在 app/[lang]/ 下：用 next.config.ts 的 rewrites
 * 把"不以其他语言前缀开头"的网址重写到 /zh/…。这个模块只依赖 @blog/shared 的语言定义，供 next.config.ts 引用。
 *
 * 为什么用 rewrites 而不用 proxy（middleware）：rewrites 在路由层静态匹配，不用每个请求都执行一次函数，
 * ISR 页面照常直接从缓存返回。rewrites 返回数组时属于 afterFiles：在静态文件和静态路由（/admin/*、/hooks/*、
 * 图标等）之后、动态路由（[lang]）之前匹配。
 *
 * 结果：
 *   /about → /zh/about；/ → /zh
 *   /en/about 不重写，由 [lang] = en 处理
 *   /zh/about → /zh/zh/about → 404：中文只有一套网址，不需要重定向
 *   /fr/about → /zh/fr/about → 404（中文的 404 页面）
 */

/** 不属于前台页面的路径前缀：后台、API 代理、API 回调、Next 内部文件 */
export const reservedPrefixes = ["admin", "api", "hooks", "_next"] as const;

/** 需要排除的第一段：其他语言的前缀 + 保留前缀 */
function excludedFirstSegments(): string[] {
  return [...locales.filter((locale) => locale !== defaultLocale), ...reservedPrefixes];
}

/**
 * 匹配"应当重写到默认语言"的路径（不含开头的 /）的正则。
 * 负向先行断言要求排除项后面紧跟 / 或结尾：/english 不是 /en 前缀，照样重写到中文。
 * 语言代码和保留前缀只含小写字母和下划线，不需要转义。
 */
export function defaultLocalePathPattern(): string {
  return `(?!(?:${excludedFirstSegments().join("|")})(?:/|$)).*`;
}

export type Rewrite = { source: string; destination: string };

/** next.config.ts 的 rewrites 用的规则（放在 /api 代理之后） */
export function defaultLocaleRewrites(): Rewrite[] {
  return [
    // "/:path(…)" 要求 / 后面至少有内容才能稳定匹配，根路径单独写一条
    { source: "/", destination: `/${defaultLocale}` },
    { source: `/:path(${defaultLocalePathPattern()})`, destination: `/${defaultLocale}/:path` },
  ];
}
