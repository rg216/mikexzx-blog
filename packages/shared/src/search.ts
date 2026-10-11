import { z } from "zod";
import { defaultLocale, localeSchema } from "./locale.ts";
import { MONTH_RANGE_MESSAGE, postFilterFields, slugSchema, tagSchema, validMonthRange } from "./post.ts";

/** 一次最多返回的搜索结果数。按相关度排序的结果不好做游标分页，个人博客取前 20 条足够 */
export const SEARCH_RESULT_LIMIT = 20;

/** 搜索词的长度上限（前端输入框的 maxLength 也用它） */
export const SEARCH_QUERY_MAX_LENGTH = 100;

export const searchQuerySchema = z
  .object({
    q: z.string().trim().min(1, "请输入搜索内容").max(SEARCH_QUERY_MAX_LENGTH, `搜索内容不能超过 ${SEARCH_QUERY_MAX_LENGTH} 个字符`),
    /** 搜索哪种语言的版本：每种语言分别建索引（原文在 posts，译文在 post_translations） */
    locale: localeSchema.default(defaultLocale),
    /** 和列表接口相同的筛选条件，与关键词同时满足。只按条件浏览（没有关键词）走列表接口，可以翻页 */
    ...postFilterFields,
  })
  .refine(validMonthRange, { message: MONTH_RANGE_MESSAGE, path: ["from"] });
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** 高亮区间：text 的 UTF-16 下标，[start, end)。返回区间而不是带 <mark> 的 HTML，前端不用 dangerouslySetInnerHTML */
export const highlightRangeSchema = z
  .object({ start: z.int().nonnegative(), end: z.int().nonnegative() })
  .refine((range) => range.end > range.start, "高亮区间不能为空");
export type HighlightRange = z.infer<typeof highlightRangeSchema>;

export const highlightedTextSchema = z.object({
  text: z.string(),
  /** 按位置排序、互不重叠 */
  highlights: z.array(highlightRangeSchema),
});
export type HighlightedText = z.infer<typeof highlightedTextSchema>;

export const searchHitSchema = z.object({
  slug: slugSchema,
  /** 命中内容的语言（等于请求的 locale） */
  locale: localeSchema,
  title: highlightedTextSchema,
  /** 正文里包含匹配的一段（只命中标题或标签时是开头一段） */
  snippet: highlightedTextSchema,
  publishedAt: z.iso.datetime({ offset: true }),
  tags: z.array(tagSchema),
});
export type SearchHit = z.infer<typeof searchHitSchema>;

export const searchResultSchema = z.object({ items: z.array(searchHitSchema) });
export type SearchResult = z.infer<typeof searchResultSchema>;
