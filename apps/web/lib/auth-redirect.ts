export const DEFAULT_AFTER_LOGIN = "/admin/posts";

/**
 * 登录后跳转的目标（来自 ?next=）。只接受站内路径，防止开放重定向：
 * 攻击者构造 /admin/login?next=https://evil.example，用户在真站点上登录后被带去钓鱼站。
 * "//evil.example" 和 "/\evil.example" 会被浏览器当成跨站地址，也要拒绝。
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_AFTER_LOGIN;
  }
  // 再用 URL 解析确认没有跑到别的源（兜住各种编码绕过）
  const base = "https://same.origin";
  const url = new URL(value, base);
  if (url.origin !== base) return DEFAULT_AFTER_LOGIN;
  // 不要跳回登录页本身，否则登录成功后又看到登录页
  if (url.pathname === "/admin/login") return DEFAULT_AFTER_LOGIN;
  return `${url.pathname}${url.search}${url.hash}`;
}
