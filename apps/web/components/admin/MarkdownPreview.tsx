"use client";

import { useEffect, useRef, useState } from "react";
import prose from "@/components/Prose.module.css";
import { renderMarkdown } from "@/lib/markdown";
import styles from "./MarkdownPreview.module.css";

type Props = {
  markdown: string;
  /** 停止输入多久后再渲染（毫秒） */
  delay?: number;
};

/**
 * 实时预览：和文章页用同一个 renderMarkdown（同样的 GFM、sanitize、figure 插件）和同一份 Prose 样式，
 * 预览看到的就是发布后的样子。
 *
 * 在浏览器里渲染而不是请求服务端：没有网络往返，断网也能预览。
 * 代价是 unified 全家桶进了编辑器页面的客户端包（只有这个后台路由会加载）。
 * 防抖：长文每次渲染要几毫秒到几十毫秒，逐字渲染会拖慢打字。
 */
export function MarkdownPreview({ markdown, delay = 200 }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const renderedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // 第一次立即渲染（打开已有文章时不要先看到空白），之后才防抖
    const timer = setTimeout(
      async () => {
        try {
          const output = await renderMarkdown(markdown);
          if (cancelled) return;
          renderedOnce.current = true;
          setHtml(output);
          setFailed(false);
        } catch {
          if (!cancelled) setFailed(true);
        }
      },
      renderedOnce.current ? delay : 0,
    );
    // 内容变了就作废上一轮：防止慢的旧渲染结果覆盖新的
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [markdown, delay]);

  if (markdown.trim() === "") {
    return <p className={styles.placeholder}>正文预览会显示在这里。</p>;
  }

  return (
    <>
      {failed && <p className={styles.placeholder}>预览渲染失败，请检查 Markdown 语法。</p>}
      {/* html 来自 renderMarkdown，已经过 rehype-sanitize 白名单清洗 */}
      {html !== null && <div className={prose.prose} dangerouslySetInnerHTML={{ __html: html }} />}
    </>
  );
}
