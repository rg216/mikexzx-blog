import type { Locale, PostCover, PostSummary, Tag } from "@blog/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/format";
import { postPath } from "@/lib/i18n/paths";
import { CoverThumbnail } from "./CoverImage";
import styles from "./PostListItem.module.css";
import { TagList } from "./TagList";

type PostCardProps = {
  slug: string;
  /** 标题和摘要可以是带高亮的节点（搜索结果） */
  title: ReactNode;
  excerpt: ReactNode;
  publishedAt: string | null;
  tags: Tag[];
  /** 头图：有的话在右侧显示缩略图 */
  cover?: PostCover | null;
  /** 页面语言：决定链接前缀和日期格式。列表里的文章都有这种语言的版本 */
  locale: Locale;
};

/** 文章卡片：首页列表和搜索结果共用（搜索结果在客户端组件里，所以 props 只用可序列化的值） */
export function PostCard({ slug, title, excerpt, publishedAt, tags, cover, locale }: PostCardProps) {
  return (
    <article className={styles.card} data-cover={cover ? "" : undefined}>
      {cover && (
        <div className={styles.cover}>
          <CoverThumbnail cover={cover} />
        </div>
      )}
      <h2 className={styles.title}>
        {/* 整张卡片可点击，但 DOM 里只有一个链接：链接的 ::after 铺满卡片。
            读屏软件只读到标题文字，不会把摘要、日期全塞进链接名里。 */}
        <Link href={postPath(locale, slug)} className={styles.link}>
          {title}
        </Link>
      </h2>
      <p className={styles.excerpt}>{excerpt}</p>
      <div className={styles.meta}>
        {publishedAt && <time dateTime={publishedAt}>{formatDate(publishedAt, locale)}</time>}
        <TagList tags={tags} locale={locale} />
      </div>
    </article>
  );
}

export function PostListItem({ post, locale }: { post: PostSummary; locale: Locale }) {
  return (
    <PostCard slug={post.slug} title={post.title} excerpt={post.excerpt} publishedAt={post.publishedAt} tags={post.tags} cover={post.cover} locale={locale} />
  );
}
