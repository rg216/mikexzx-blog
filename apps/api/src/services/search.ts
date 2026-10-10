import { SEARCH_RESULT_LIMIT, type SearchHit } from "@blog/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { posts } from "../db/schema.ts";
import { plainTextFromMarkdown } from "../lib/markdown-text.ts";
import { buildSearchQuery, buildSnippet, findHighlights } from "../lib/search-text.ts";
import { tagsByPostId } from "./posts.ts";

/**
 * 全文搜索已发布文章，按相关度排序。
 * 排序用 ts_rank：标题（权重 A）命中远高于正文（D）；第三个参数 1 表示按文档长度做对数归一化，长文不会仅因字多而占优。
 * 相关度相同的按发布时间倒序。
 */
export async function searchPosts(db: Db, query: string): Promise<SearchHit[]> {
  const tsquery = buildSearchQuery(query);
  if (!tsquery) return [];

  const q = sql`${tsquery}::tsquery`;
  const rows = await db
    .select({ id: posts.id, slug: posts.slug, title: posts.title, contentMd: posts.contentMd, publishedAt: posts.publishedAt })
    .from(posts)
    // status 条件让查询能用上 posts_search_idx（部分索引）
    .where(and(eq(posts.status, "published"), sql`${posts.searchVector} @@ ${q}`))
    .orderBy(desc(sql`ts_rank(${posts.searchVector}, ${q}, 1)`), desc(posts.publishedAt), desc(posts.id))
    .limit(SEARCH_RESULT_LIMIT);

  const tagMap = await tagsByPostId(
    db,
    rows.map((r) => r.id),
  );

  // 摘要在查询时现算（最多 20 篇，每篇解析一次 Markdown），不再存一份纯文本，省得多一个要保持同步的派生列
  return rows.map((row) => {
    const body = plainTextFromMarkdown(row.contentMd);
    return {
      slug: row.slug,
      title: { text: row.title, highlights: findHighlights(row.title, query) },
      snippet: buildSnippet(body, findHighlights(body, query)),
      // 已发布文章一定有发布时间（数据库 CHECK 约束保证）
      publishedAt: (row.publishedAt ?? new Date(0)).toISOString(),
      tags: tagMap.get(row.id) ?? [],
    };
  });
}
