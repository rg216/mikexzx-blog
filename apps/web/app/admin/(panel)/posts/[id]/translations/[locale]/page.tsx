import { isLocale } from "@blog/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { TranslationEditor } from "@/components/admin/TranslationEditor";

export const metadata: Metadata = { title: "编辑译文" };

// 与 posts/[id]/page.tsx 相同的约束（PostgreSQL integer 的上限）：明显不合法的地址直接 404，不发请求
const idSchema = z.coerce.number().int().positive().max(2_147_483_647);

export default async function EditTranslationPage({ params }: PageProps<"/admin/posts/[id]/translations/[locale]">) {
  const { id, locale } = await params;
  const parsedId = idSchema.safeParse(id);
  // 不认识的语言（/translations/fr）直接 404；"是不是原文语言"要等加载了文章才知道，由编辑器处理
  if (!parsedId.success || !isLocale(locale)) notFound();
  // key：换文章或换语言时重新挂载编辑器，不沿用上一篇的表单状态
  return <TranslationEditor key={`${parsedId.data}:${locale}`} postId={parsedId.data} locale={locale} />;
}
