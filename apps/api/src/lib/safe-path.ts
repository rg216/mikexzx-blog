/**
 * 登录后跳回的地址只接受本站路径（"/posts/x#comments"），防止开放重定向：
 * 否则攻击者可以构造 /auth/github/start?next=https://evil.example，借我们的域名把人带去钓鱼站。
 * "//evil.example" 和 "/\\evil.example" 在浏览器里也会被当成另一个站点，一并拒绝。
 */
export function safeReturnPath(value: string | undefined, fallback = "/"): string {
  if (!value || value.length > 500) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // 控制字符（换行等）可能被用来拼接响应头
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}

/** 在本站路径上加查询参数（保留原有的 #hash），用于把登录结果告诉前端 */
export function withQuery(path: string, params: Record<string, string>): string {
  const url = new URL(path, "http://placeholder");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}
