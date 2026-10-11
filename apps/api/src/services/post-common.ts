import type { Locale, Tag } from "@blog/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { postTags, tags, tagTranslations } from "../db/schema.ts";
import { plainTextFromMarkdown } from "../lib/markdown-text.ts";
import { buildSearchVector } from "../lib/search-text.ts";

// posts.ts 和 translations.ts 都要用的几个小工具，放在这里免得两个模块互相导入。

/**
 * db 本身或事务对象，两者的查询 API 相同。
 * 注意：事务只占一个连接，在它上面的查询必须一条接一条地 await，不能 Promise.all
 * （pg 会排队执行，但同时调用 client.query() 已被弃用，pg 9 会报错）；连接池 db 上的并发查询没问题
 */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** 标签在某种语言里的名称：有译名用译名，否则（原文语言、或旧标签还没有译名）用原文名称。配合 tagTranslationJoin 使用 */
export const localizedTagName = sql<string>`COALESCE(${tagTranslations.name}, ${tags.name})`;

/** 连接某种语言的标签译名（LEFT JOIN 的条件） */
export const tagTranslationJoin = (locale: Locale) => and(eq(tagTranslations.tagId, tags.id), eq(tagTranslations.locale, locale));

/**
 * 一次查出多篇文章的标签（避免每篇文章各查一次的 N+1 问题），按作者填写的顺序。
 * 给了 locale 时名称是该语言的（前台页面、该语言的搜索索引）；不给是原文名称（后台）。
 */
export async function tagsByPostId(db: Executor, postIds: number[], locale?: Locale): Promise<Map<number, Tag[]>> {
  const result = new Map<number, Tag[]>(postIds.map((id) => [id, []]));
  if (postIds.length === 0) return result;

  const base = db
    .select({ postId: postTags.postId, slug: tags.slug, name: locale ? localizedTagName : tags.name })
    .from(postTags)
    .innerJoin(tags, eq(tags.id, postTags.tagId));
  const rows = await (locale ? base.leftJoin(tagTranslations, tagTranslationJoin(locale)) : base)
    .where(inArray(postTags.postId, postIds))
    .orderBy(asc(postTags.position));

  for (const { postId, ...tag } of rows) result.get(postId)?.push(tag);
  return result;
}

/**
 * 一种语言版本的搜索索引：标题（A）+ 标签名（B）+ 正文（D）。原文和译文用同一套分词：
 * 中日韩文字切二元组（日文的假名、汉字都在内），其他文字按词——所以不需要按语言换分词器。
 * 译文的索引里用该语言的标签名（tagsByPostId 传入译文的 locale）。
 */
export function searchVectorOf(version: { title: string; contentMd: string; tags: Tag[] }): string {
  return buildSearchVector({ title: version.title, tags: version.tags.map((t) => t.name), body: plainTextFromMarkdown(version.contentMd) });
}
