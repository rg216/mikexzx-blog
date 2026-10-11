import { type AdminTag, tagInputSchema, type TagInput } from "@blog/shared";
import { normalizeSlug, toApiIssues } from "./post-form";

/*
 * 标签的纯逻辑：管理页的表单校验、编辑器里的候选列表。不依赖 React，单元测试直接跑。
 */

export type TagFormErrors = Partial<Record<"name" | "slug", string>>;

/** 名称比较不分大小写（和数据库的唯一索引 lower(name) 一致），首尾空白不算 */
const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * 管理页新建 / 编辑标签前的校验：先用 shared 的 schema，再查和已有标签重名。
 * 查重只是提前给出更具体的提示；真正的保证是数据库的唯一约束（并发时服务端返回 409）。
 * slug 留空时用名称自动生成（只对拉丁字母有效，中文名需要手填）。
 */
export function validateTagForm(values: TagInput, existing: AdminTag[], editingId?: number): { data?: TagInput; errors: TagFormErrors } {
  const candidate = { name: values.name, slug: normalizeSlug(values.slug || values.name) };
  if (candidate.name.trim() && !candidate.slug) {
    return { errors: { slug: "中文名称无法自动生成 slug，请手动填写（如 frontend）" } };
  }
  const parsed = tagInputSchema.safeParse(candidate);
  if (!parsed.success) {
    const errors: TagFormErrors = {};
    for (const issue of toApiIssues(parsed.error.issues)) {
      const field = issue.path === "slug" ? "slug" : "name";
      errors[field] ??= issue.message;
    }
    return { errors };
  }

  const others = existing.filter((tag) => tag.id !== editingId);
  const errors: TagFormErrors = {};
  const sameName = others.find((tag) => nameKey(tag.name) === nameKey(parsed.data.name));
  if (sameName) errors.name = `已经有标签「${sameName.name}」了`;
  const sameSlug = others.find((tag) => tag.slug === parsed.data.slug);
  if (sameSlug) errors.slug = `slug "${sameSlug.slug}" 已被「${sameSlug.name}」使用`;
  return Object.keys(errors).length > 0 ? { errors } : { data: parsed.data, errors };
}

/**
 * 编辑器里可以添加的标签：去掉已经选了的，按名称或 slug 筛选（不分大小写）。
 * 没有输入时只给最常用的 limit 个（列表已按使用次数排好），避免标签多了以后铺满一屏；输入时给全部匹配项。
 */
export function tagSuggestions(all: AdminTag[], selectedSlugs: string[], query: string, limit: number): AdminTag[] {
  const selected = new Set(selectedSlugs);
  const q = query.trim().toLowerCase();
  const available = all.filter((tag) => !selected.has(tag.slug));
  if (!q) return available.slice(0, limit);
  return available.filter((tag) => tag.name.toLowerCase().includes(q) || tag.slug.includes(q));
}
