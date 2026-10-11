import { defaultLocale, isLocale, type Locale } from "@blog/shared";

/*
 * 站内网址与语言的换算。默认语言（中文）没有前缀：/posts/a；其他语言带前缀：/en/posts/a。
 *
 * 同一个页面会以两种形式出现在代码里：
 *   - 浏览器网址：/posts/a、/en/posts/a（链接、hreflang、登录回跳都要用这种）
 *   - 路由路径：/zh/posts/a、/en/posts/a（next.config.ts 把无前缀的网址重写到 app/[lang] 下的 /zh/…）
 * usePathname() 在服务端预渲染时返回路由路径，在浏览器里返回浏览器网址（见 Next 文档 use-pathname
 * "Avoid hydration mismatch with rewrites"）。stripLocale 两种形式都认，由它推导出来的链接、激活状态
 * 在服务端和浏览器里一致，不会出现水合不匹配。
 */

/** path 必须以 / 开头。zh + "/posts/a" → "/posts/a"；en + "/posts/a" → "/en/posts/a"；en + "/" → "/en" */
export function localePath(locale: Locale, path: string): string {
  if (locale === defaultLocale) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/**
 * 从网址里拆出语言和去掉前缀后的路径。没有语言前缀 = 默认语言。
 * 默认语言的前缀（/zh/…）也认：那是 rewrite 之后的路由路径，见文件开头的说明。
 * 只去掉一层前缀：浏览器里真的访问 /zh/about 时路由路径是 /zh/zh/about（404 页面），这里不去猜。
 */
export function stripLocale(pathname: string): { locale: Locale; path: string } {
  const match = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  const first = match?.[1];
  if (first && isLocale(first)) return { locale: first, path: match[2] ?? "/" };
  return { locale: defaultLocale, path: pathname || "/" };
}

/** 把路由路径或浏览器网址统一成浏览器网址：/zh/posts/a → /posts/a，/en/posts/a 不变 */
export function browserPath(pathname: string): string {
  const { locale, path } = stripLocale(pathname);
  return localePath(locale, path);
}

/** 切换语言时带过去的查询参数：只有作为页面状态的参数（目前只有搜索页的 q） */
const carriedParams: Record<string, readonly string[]> = { "/search": ["q"] };

/**
 * 同一个页面在另一种语言下的网址（切换语言菜单用）。
 * search 是当前网址的查询串（location.search）：只保留 carriedParams 里列出的参数，
 * 像评论登录后的 ?login=failed 这种一次性参数不跟着换语言。
 */
export function switchLocalePath(pathname: string, target: Locale, search = ""): string {
  const { path } = stripLocale(pathname);
  const href = localePath(target, path);
  const current = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const name of carriedParams[path] ?? []) {
    const value = current.get(name);
    if (value) kept.set(name, value);
  }
  return kept.size > 0 ? `${href}?${kept}` : href;
}

/** 文章页的网址 */
export function postPath(locale: Locale, slug: string): string {
  return localePath(locale, `/posts/${slug}`);
}
