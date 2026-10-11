import {
  archiveSchema,
  type Locale,
  MAX_FILTER_TAGS,
  type PostSummaryPage,
  postSummaryPageSchema,
  SEARCH_QUERY_MAX_LENGTH,
  type SearchHit,
  searchResultSchema,
  slugSchema,
  type TagWithCount,
  tagWithCountSchema,
  yearMonthSchema,
} from "@blog/shared";
import { z } from "zod";
import { type ApiErrorReason, reasonFromStatus } from "./api-error-reason";
import { yearMonthOf } from "./archive";
import type { Dictionary } from "./i18n";

/** 搜索词的长度上限（界面提示"不能超过 N 个字符"用），与 API 的校验同一个常量 */
export { SEARCH_QUERY_MAX_LENGTH };

/** 搜索页的状态：关键词 + 筛选条件（标签全部满足、发布月份范围）。都会同步到网址上 */
export type SearchState = { q: string; tags: string[]; from: string; to: string };

export const emptySearchState: SearchState = { q: "", tags: [], from: "", to: "" };

/**
 * 从网址读搜索状态。手改的网址可能不合法：不合法的标签、月份直接丢掉，而不是让整个页面报错。
 */
export function searchStateFromParams(params: URLSearchParams): SearchState {
  const month = (value: string | null) => (value && yearMonthSchema.safeParse(value).success ? value : "");
  const tags = (params.get("tags") ?? "")
    .split(",")
    .filter((tag) => slugSchema.safeParse(tag).success)
    .slice(0, MAX_FILTER_TAGS);
  return { q: (params.get("q") ?? "").slice(0, SEARCH_QUERY_MAX_LENGTH), tags: [...new Set(tags)], from: month(params.get("from")), to: month(params.get("to")) };
}

/** 搜索状态 → 查询参数（空的不写）。关键词去掉首尾空白 */
export function searchStateToParams(state: SearchState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.tags.length > 0) params.set("tags", state.tags.join(","));
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  return params;
}

export const hasFilters = (state: SearchState) => state.tags.length > 0 || state.from !== "" || state.to !== "";

/** 起始月份晚于结束月份时两端对调后再查（用户多半只是先填了后面那个），不报错 */
function orderedRange(state: SearchState): { from: string; to: string } {
  return state.from && state.to && state.from > state.to ? { from: state.to, to: state.from } : { from: state.from, to: state.to };
}

function filterParams(state: SearchState): URLSearchParams {
  const { from, to } = orderedRange(state);
  return searchStateToParams({ ...state, q: "", from, to });
}

async function getJson(url: string, signal: AbortSignal | undefined, fetchImpl: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal, headers: { accept: "application/json" } });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new SearchError("network", { cause: error });
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw new SearchError(reasonFromStatus(res.status));
  return body;
}

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
 * 在浏览器里调用搜索接口（经 /api 代理）。filter：标签、月份条件，与关键词同时满足。
 * 为什么不在服务端渲染搜索结果：服务端请求 API 时，API 看到的是 Vercel 函数的 IP，所有读者会共用一个限流额度；
 * 而且搜索页本身可以是静态页面，不必每次访问都运行函数。
 * locale：搜哪种语言的版本（每种语言分别建索引）。
 * 请求被 signal 取消时抛出原生的 AbortError，调用方据此忽略过期的请求。
 */
export async function searchPosts(
  query: string,
  {
    locale,
    filter = emptySearchState,
    signal,
    fetch: fetchImpl = fetch,
  }: { locale: Locale; filter?: SearchState; signal?: AbortSignal; fetch?: typeof fetch },
): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query, locale });
  for (const [key, value] of filterParams(filter)) params.set(key, value);
  const parsed = searchResultSchema.safeParse(await getJson(`/api/search?${params}`, signal, fetchImpl));
  if (!parsed.success) throw new SearchError("unavailable", { cause: parsed.error });
  return parsed.data.items;
}

/**
 * 按条件浏览文章（没有关键词）：走列表接口，按发布时间倒序、按游标翻页。
 * 首页、标签页加载下一页也用它（filter 只带标签）。
 */
export async function browsePosts({
  locale,
  filter = emptySearchState,
  cursor,
  limit,
  signal,
  fetch: fetchImpl = fetch,
}: {
  locale: Locale;
  filter?: SearchState;
  cursor?: string | null;
  limit: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): Promise<PostSummaryPage> {
  const params = new URLSearchParams({ locale, limit: String(limit) });
  for (const [key, value] of filterParams(filter)) params.set(key, value);
  if (cursor) params.set("cursor", cursor);
  const parsed = postSummaryPageSchema.safeParse(await getJson(`/api/posts?${params}`, signal, fetchImpl));
  if (!parsed.success) throw new SearchError("unavailable", { cause: parsed.error });
  return parsed.data;
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

/** 筛选器的选项：该语言下有文章的标签、有文章的月份（新的在前，"2026-03"） */
export type FilterOptions = { tags: TagWithCount[]; months: string[] };

/**
 * 读筛选器的选项。月份从归档接口推出来：只列真有文章的月份，而不是让读者在日历里瞎选
 * （也不用 <input type="month">：Safari、Firefox 桌面版不支持，会退化成普通文本框）。
 */
export async function fetchFilterOptions({
  locale,
  signal,
  fetch: fetchImpl = fetch,
}: {
  locale: Locale;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): Promise<FilterOptions> {
  const query = new URLSearchParams({ locale });
  const [tagsBody, archiveBody] = await Promise.all([getJson(`/api/tags?${query}`, signal, fetchImpl), getJson(`/api/archive?${query}`, signal, fetchImpl)]);
  const tags = z.array(tagWithCountSchema).safeParse(tagsBody);
  const archive = archiveSchema.safeParse(archiveBody);
  if (!tags.success || !archive.success) throw new SearchError("unavailable");
  const months = [
    ...new Set(
      archive.data.map((item) => {
        const { year, month } = yearMonthOf(item.publishedAt);
        return `${year}-${month}`;
      }),
    ),
  ];
  return { tags: tags.data, months };
}
