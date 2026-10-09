import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PostEditor } from "@/components/admin/PostEditor";

export const metadata: Metadata = { title: "编辑文章" };

// 与 API 的 idParam 同样的约束（PostgreSQL integer 的上限）：明显不合法的地址直接 404，不发请求
const idSchema = z.coerce.number().int().positive().max(2_147_483_647);

export default async function EditPostPage({ params }: PageProps<"/admin/posts/[id]">) {
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  // key：从一篇文章跳到另一篇时重新挂载编辑器，不沿用上一篇的表单状态
  return <PostEditor key={parsed.data} postId={parsed.data} />;
}
