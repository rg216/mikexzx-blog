import { type Locale, localeInfo, SEARCH_RESULT_LIMIT, type SearchHit } from "@blog/shared";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { posts, postTranslations } from "../db/schema.ts";
import { plainTextFromMarkdown } from "../lib/markdown-text.ts";
import { buildSearchQuery, buildSnippet, findHighlights } from "../lib/search-text.ts";
import { tagsByPostId } from "./post-common.ts";

type Candidate = { id: number; slug: string; title: string; contentMd: string; publishedAt: Date | null; rank: number };

/** 相关度高的在前；相同的按发布时间倒序，再按 id（与列表的排序一致，结果稳定） */
export function compareHits(a: Candidate, b: Candidate): number {
  return b.rank - a.rank || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || b.id - a.id;
}

/**
 * 在某种语言的版本里全文搜索已发布文章，按相关度排序。
 * 排序用 ts_rank：标题（权重 A）命中远高于正文（D）；第三个参数 1 表示按文档长度做对数归一化，长文不会仅因字多而占优。
 *
 * 每种语言一套索引：原文是这种语言的文章查 posts.search_vector，其他文章查这种语言的译文（post_translations.search_vector）。
 * 两路各自按相关度取前 20 再在内存里合并，而不是一条 SQL 里 OR 两张表：分开查时两边都能走各自的 GIN 索引，
 * 合并 40 条的代价可以忽略。两边的 rank 用同一个公式、同一套分词算出，可以直接比较。
 */
export async function searchPosts(db: Db, query: string, locale: Locale): Promise<SearchHit[]> {
  const tsquery = buildSearchQuery(query);
  if (!tsquery) return [];

  const q = sql`${tsquery}::tsquery`;
  const originalRank = sql<number>`ts_rank(${posts.searchVector}, ${q}, 1)`.mapWith(Number);
  const translationRank = sql<number>`ts_rank(${postTranslations.searchVector}, ${q}, 1)`.mapWith(Number);

  const [originals, translations] = await Promise.all([
    db
      .select({ id: posts.id, slug: posts.slug, title: posts.title, contentMd: posts.contentMd, publishedAt: posts.publishedAt, rank: originalRank })
      .from(posts)
      // status 条件让查询能用上 posts_search_idx（部分索引）
      .where(and(eq(posts.status, "published"), eq(posts.sourceLocale, locale), sql`${posts.searchVector} @@ ${q}`))
      .orderBy(desc(originalRank), desc(posts.publishedAt), desc(posts.id))
      .limit(SEARCH_RESULT_LIMIT),
    db
      .select({
        id: posts.id,
        slug: posts.slug,
        title: postTranslations.title,
        contentMd: postTranslations.contentMd,
        publishedAt: posts.publishedAt,
        rank: translationRank,
      })
      .from(postTranslations)
      // 与列表一致：原文就是这种语言时只认原文
      .innerJoin(posts, and(eq(posts.id, postTranslations.postId), eq(posts.status, "published"), ne(posts.sourceLocale, locale)))
      .where(and(eq(postTranslations.locale, locale), sql`${postTranslations.searchVector} @@ ${q}`))
      .orderBy(desc(translationRank), desc(posts.publishedAt), desc(posts.id))
      .limit(SEARCH_RESULT_LIMIT),
  ]);

  const rows = [...originals, ...translations].sort(compareHits).slice(0, SEARCH_RESULT_LIMIT);
  const tagMap = await tagsByPostId(
    db,
    rows.map((r) => r.id),
    locale,
  );

  // 摘要在查询时现算（最多 20 篇，每篇解析一次 Markdown），不再存一份纯文本，省得多一个要保持同步的派生列。
  // 长度和列表摘要一样按语言取（西文字符窄，同样的视觉长度需要更多字符），匹配前的上下文取长度的六分之一
  const length = localeInfo[locale].excerptLength;
  const snippetOptions = { length, context: Math.round(length / 6) };
  return rows.map((row) => {
    const body = plainTextFromMarkdown(row.contentMd);
    return {
      slug: row.slug,
      locale,
      title: { text: row.title, highlights: findHighlights(row.title, query) },
      snippet: buildSnippet(body, findHighlights(body, query), snippetOptions),
      // 已发布文章一定有发布时间（数据库 CHECK 约束保证）
      publishedAt: (row.publishedAt ?? new Date(0)).toISOString(),
      tags: tagMap.get(row.id) ?? [],
    };
  });
}
