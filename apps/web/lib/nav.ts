import { stripLocale } from "./i18n/paths";

/**
 * 导航链接是否对应当前页面。先去掉两边的语言前缀再比较：/en/about 属于"关于"，/about 也是。
 * pathname 在服务端是 rewrite 后的路由路径（/zh/about）、在浏览器里是 /about，去掉前缀后一致，不会水合不匹配。
 * 后台链接（/admin/…）没有语言前缀，比较方式不变。
 */
export function isNavLinkActive(href: string, pathname: string): boolean {
  const target = stripLocale(href);
  const current = stripLocale(pathname);
  if (target.locale !== current.locale) return false;
  // "文章"栏目同时覆盖首页和 /posts/* 文章页
  if (target.path === "/") return current.path === "/" || current.path.startsWith("/posts/");
  return current.path === target.path || current.path.startsWith(`${target.path}/`);
}
