/*
 * 编辑器里插入图片用到的文本操作（纯函数，便于测试）。
 * 上传期间先插入一个占位符，上传完成后替换成真正的图片语法——和 GitHub 编辑器的做法一样：
 * 上传可能要几秒，期间作者可以继续打字，占位符跟着文字移动，最后替换时不会插错位置。
 */

/** 在选区处插入一段"独占一段"的文本（前后补空行），返回新文本和插入后光标的位置 */
export function insertBlock(value: string, selectionStart: number, selectionEnd: number, block: string): { value: string; cursor: number } {
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  // 单独成段的图片才会渲染成 <figure>（可以比正文宽、带图注），所以前后都要隔一个空行
  const lead = before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = `${lead}${block}${trail}`;
  return { value: before + inserted + after, cursor: before.length + lead.length + block.length };
}

/** 上传中的占位符；id 保证同时上传多张时互不混淆 */
export function uploadPlaceholder(id: string, fileName: string): string {
  const name = fileName.replace(/[[\]]/g, "") || "图片";
  return `![上传中：${name}…](upload:${id})`;
}

/**
 * 图片的 Markdown。alt 留空让作者补写描述（读屏软件会读出它）；
 * URL 里的括号和空格要编码，否则会提前结束 Markdown 的链接语法。
 */
export function imageMarkdown(url: string, alt = ""): string {
  // 注意 encodeURIComponent 不编码括号，所以手动转成 %XX
  const safeUrl = url.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  return `![${alt.replace(/[[\]]/g, "")}](${safeUrl})`;
}

/**
 * 把占位符替换成最终文本；作者已经删掉占位符时原样返回。
 * replacement 为空串表示上传失败、删除占位符：连同插入时补在它后面的换行一起删，只动占位符附近，不碰正文其他地方。
 */
export function replacePlaceholder(value: string, placeholder: string, replacement: string): string {
  const index = value.indexOf(placeholder);
  if (index === -1) return value;
  const before = value.slice(0, index);
  let after = value.slice(index + placeholder.length);
  if (replacement === "") after = after.replace(/^\n{1,2}/, "");
  return before + replacement + after;
}
