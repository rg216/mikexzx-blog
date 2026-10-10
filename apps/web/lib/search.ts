import { apiErrorSchema, type SearchHit, searchResultSchema } from "@blog/shared";

/** 搜索失败的原因，已经是可以直接展示给读者的文字 */
export class SearchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SearchError";
  }
}

/**
 * 在浏览器里调用搜索接口（经 /api 代理）。
 * 为什么不在服务端渲染搜索结果：服务端请求 API 时，API 看到的是 Vercel 函数的 IP，所有读者会共用一个限流额度；
 * 而且搜索页本身可以是静态页面，不必每次访问都运行函数。
 * 请求被 signal 取消时抛出原生的 AbortError，调用方据此忽略过期的请求。
 */
export async function searchPosts(query: string, { signal, fetch: fetchImpl = fetch }: { signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<SearchHit[]> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/search?${new URLSearchParams({ q: query })}`, { signal, headers: { accept: "application/json" } });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new SearchError("无法连接服务器，请检查网络后重试", { cause: error });
  }

  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    if (res.status === 429) throw new SearchError("搜索太频繁，请稍等片刻再试");
    const parsed = apiErrorSchema.safeParse(body);
    // 400 的消息来自 searchQuerySchema（"搜索内容不能超过 100 个字符"），可以直接展示
    throw new SearchError(res.status === 400 && parsed.success ? parsed.data.error.message : "搜索暂时不可用，请稍后重试");
  }

  const parsed = searchResultSchema.safeParse(body);
  if (!parsed.success) throw new SearchError("搜索暂时不可用，请稍后重试", { cause: parsed.error });
  return parsed.data.items;
}
