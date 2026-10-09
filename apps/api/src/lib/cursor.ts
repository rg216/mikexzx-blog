import { z } from "zod";

/*
 * 游标 = 上一页最后一条的 (publishedAt, id)，编码成 base64url 的不透明字符串。
 * 比 offset 分页好在：翻页期间有新文章发布，也不会重复或漏掉；而且能走索引，不用扫描跳过的行。
 * id 参与比较是为了打破 publishedAt 相同时的平局。
 */
const cursorSchema = z.object({ p: z.iso.datetime({ offset: true }), i: z.int().positive() });

export type Cursor = { publishedAt: Date; id: number };

export function encodeCursor({ publishedAt, id }: Cursor): string {
  return Buffer.from(JSON.stringify({ p: publishedAt.toISOString(), i: id })).toString("base64url");
}

/** 无效游标返回 null（由调用方转成 400），不抛异常。 */
export function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success ? { publishedAt: new Date(parsed.data.p), id: parsed.data.i } : null;
  } catch {
    return null;
  }
}
