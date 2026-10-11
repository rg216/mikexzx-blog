import { type Locale, type SearchHit, searchQuerySchema, searchResultSchema } from "@blog/shared";
import { type ApiErrorReason, reasonFromStatus } from "./api-error-reason";
import type { Dictionary } from "./i18n";

/** 搜索词的长度上限，取自共享的 searchQuerySchema（界面提示"不能超过 N 个字符"用） */
export const SEARCH_QUERY_MAX_LENGTH = searchQuerySchema.shape.q.maxLength ?? 100;

/**
 * 搜索失败。reason 由组件按字典翻译成当前语言的文字；message 只用于日志和调试。
 * 不显示 API 的 message：它是中文的，英文、日文页面上不该出现。
 */
export class SearchError extends Error {
  readonly reason: ApiErrorReason;
  constructor(reason: ApiErrorReason, options?: ErrorOptions) {
    super(`search failed: ${reason}`, options);
    this.name = "SearchError";
    this.reason = reason;
  }
}

/**
 * 在浏览器里调用搜索接口（经 /api 代理）。
 * 为什么不在服务端渲染搜索结果：服务端请求 API 时，API 看到的是 Vercel 函数的 IP，所有读者会共用一个限流额度；
 * 而且搜索页本身可以是静态页面，不必每次访问都运行函数。
 * locale：搜哪种语言的版本（每种语言分别建索引）。
 * 请求被 signal 取消时抛出原生的 AbortError，调用方据此忽略过期的请求。
 */
export async function searchPosts(
  query: string,
  { locale, signal, fetch: fetchImpl = fetch }: { locale: Locale; signal?: AbortSignal; fetch?: typeof fetch },
): Promise<SearchHit[]> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/search?${new URLSearchParams({ q: query, locale })}`, { signal, headers: { accept: "application/json" } });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new SearchError("network", { cause: error });
  }

  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw new SearchError(reasonFromStatus(res.status));

  const parsed = searchResultSchema.safeParse(body);
  if (!parsed.success) throw new SearchError("unavailable", { cause: parsed.error });
  return parsed.data.items;
}

/** 失败原因 → 当前语言的文字（不显示 API 返回的中文 message） */
export function searchErrorText(t: Dictionary["search"]["errors"], reason: ApiErrorReason): string {
  switch (reason) {
    case "network":
      return t.network;
    case "rate_limited":
      return t.rateLimited;
    // 前端只会发非空、不超长（输入框有 maxLength）的查询词，400 基本只可能是超长
    case "invalid":
      return t.tooLong(SEARCH_QUERY_MAX_LENGTH);
    default:
      return t.unavailable;
  }
}
