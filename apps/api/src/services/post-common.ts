import { type Locale, type PostFilter, SITE_TIME_ZONE, type Tag, tagSourceLocale } from "@blog/shared";
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { posts, postTags, tags, tagTranslations } from "../db/schema.ts";
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
/** 上面那个名称是哪种语言 */
export const localizedTagLocale = sql<Locale>`COALESCE(${tagTranslations.locale}, ${tagSourceLocale})`;
const sourceTagLocale = sql<Locale>`${tagSourceLocale}`;

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
    .select({
      postId: postTags.postId,
      slug: tags.slug,
      name: locale ? localizedTagName : tags.name,
      locale: locale ? localizedTagLocale : sourceTagLocale,
    })
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

/**
 * 文章筛选条件（列表和搜索共用），返回要 AND 进 WHERE 的条件；没有条件时 undefined。
 * - 标签：文章必须同时带有所有选中的标签——按文章分组，数命中的标签数是否等于选中数（标签在文章内不重复，主键保证）；
 * - 月份：按站点时区算每月的起止时刻（"2026-10" 在北京时间是 10 月 1 日 0 点起），结束月份整月都包含。
 */
export function postFilterCondition(db: Executor, filter: PostFilter): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.tags.length > 0) {
    const tagged = db
      .select({ postId: postTags.postId })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(inArray(tags.slug, filter.tags))
      .groupBy(postTags.postId)
      .having(sql`count(*) = ${filter.tags.length}`);
    conditions.push(inArray(posts.id, tagged));
  }
  if (filter.from) {
    conditions.push(sql`${posts.publishedAt} >= (${`${filter.from}-01`})::timestamp AT TIME ZONE ${SITE_TIME_ZONE}`);
  }
  if (filter.to) {
    conditions.push(sql`${posts.publishedAt} < ((${`${filter.to}-01`})::date + interval '1 month')::timestamp AT TIME ZONE ${SITE_TIME_ZONE}`);
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}
