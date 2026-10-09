import {
  type AdminPost,
  postCreateInputSchema,
  type PostCreateInput,
  type PostStatus,
  type PostUpdateInput,
  type Tag,
} from "@blog/shared";
import type { z } from "zod";
import type { AdminApiIssue } from "./admin-api";

/*
 * 文章编辑表单的纯逻辑：表单值 ↔ API 输入、改动检测、错误归位。
 * 不依赖 React 和浏览器，单元测试直接跑。
 */

/** 表单里可编辑的字段。status 不在这里：它由"保存草稿 / 发布 / 撤回"哪个按钮决定。 */
export type PostFormValues = {
  title: string;
  slug: string;
  contentMd: string;
  tags: Tag[];
};

export type PostFormField = keyof PostFormValues;

/** 字段级错误；form 是不属于任何字段的错误（如服务器 500）。 */
export type PostFormErrors = Partial<Record<PostFormField | "form", string>>;

export const emptyPostForm: PostFormValues = { title: "", slug: "", contentMd: "", tags: [] };

export function formFromPost(post: AdminPost): PostFormValues {
  return { title: post.title, slug: post.slug, contentMd: post.contentMd, tags: post.tags };
}

function sameTags(a: Tag[], b: Tag[]): boolean {
  // 顺序也算改动：标签顺序就是文章页上的显示顺序
  return a.length === b.length && a.every((tag, i) => tag.slug === b[i]?.slug && tag.name === b[i]?.name);
}

export function isFormDirty(initial: PostFormValues, current: PostFormValues): boolean {
  return (
    current.title !== initial.title ||
    current.slug !== initial.slug ||
    current.contentMd !== initial.contentMd ||
    !sameTags(current.tags, initial.tags)
  );
}

export function buildCreateInput(values: PostFormValues, status: PostStatus): PostCreateInput {
  return { ...values, status };
}

/**
 * PATCH 请求体：只包含和服务器上版本不同的字段。
 *
 * 为什么不整篇提交：PATCH 的语义是部分更新，只发改动能减少"覆盖别人改动"的范围
 * （例如另一个标签页只改了标签，这里只改了正文，两边都不会把对方的改动冲掉）。
 * 没有任何改动时返回 null——postUpdateInputSchema 拒绝空对象，调用方应该直接跳过请求。
 */
export function buildUpdateInput(
  initial: PostFormValues & { status: PostStatus },
  current: PostFormValues,
  status: PostStatus,
): PostUpdateInput | null {
  const input: PostUpdateInput = {};
  if (current.title !== initial.title) input.title = current.title;
  if (current.slug !== initial.slug) input.slug = current.slug;
  if (current.contentMd !== initial.contentMd) input.contentMd = current.contentMd;
  if (!sameTags(current.tags, initial.tags)) input.tags = current.tags;
  if (status !== initial.status) input.status = status;
  return Object.keys(input).length > 0 ? input : null;
}

/** 把 API 返回的字段路径（如 "tags.0.slug"）归到表单字段上。 */
function fieldForPath(path: string): PostFormField | "form" {
  const head = path.split(".")[0];
  return head === "title" || head === "slug" || head === "contentMd" || head === "tags" ? head : "form";
}

function describeIssue(issue: AdminApiIssue): string {
  // 标签是列表，指出是第几个，否则用户不知道哪个标签有问题
  const match = /^tags\.(\d+)/.exec(issue.path);
  return match ? `第 ${Number(match[1]) + 1} 个标签：${issue.message}` : issue.message;
}

/** 字段级错误：同一字段有多条时只显示第一条（用户改完一条再看下一条，避免一次堆一屏）。 */
export function issuesToFormErrors(issues: AdminApiIssue[]): PostFormErrors {
  const errors: PostFormErrors = {};
  for (const issue of issues) {
    const field = fieldForPath(issue.path);
    errors[field] ??= describeIssue(issue);
  }
  return errors;
}

const fieldLabels: Record<string, string> = {
  title: "标题",
  slug: "slug",
  contentMd: "正文",
  tags: "标签",
  name: "名称",
};

/**
 * zod 的默认错误信息是英文的通用句子（"Too small: expected string to have >=1 characters"）。
 * 长度类错误换成中文的具体说法；schema 里自定义过的信息（如 slug 的格式说明）原样保留。
 * 不用 z.config 切换全局语言包：那是影响整个包的副作用，而这里只需要几种常见情况。
 */
export function toApiIssues(issues: readonly z.core.$ZodIssue[]): AdminApiIssue[] {
  return issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    const key = String(issue.path.at(-1) ?? "");
    const label = fieldLabels[key] ?? key;
    let message = issue.message;
    if (issue.code === "too_small" && issue.origin === "string" && Number(issue.minimum) <= 1) {
      message = `请填写${label}`;
    } else if (issue.code === "too_big" && issue.origin === "string") {
      message = `${label}不能超过 ${issue.maximum} 个字符`;
    } else if (issue.code === "too_big" && issue.origin === "array") {
      message = `${label}最多 ${issue.maximum} 个`;
    }
    return { path, message };
  });
}

/**
 * 提交前用 shared 的同一个 schema 在前端校验一遍，错误格式和服务端 400 完全相同，
 * 所以前端校验和服务端校验走同一条显示路径。
 * 草稿也必须有标题和 slug——这是 API 的约束（slug 唯一、标题非空），前端不放宽。
 */
export function validatePostForm(values: PostFormValues, status: PostStatus): PostFormErrors {
  const result = postCreateInputSchema.safeParse(buildCreateInput(values, status));
  return result.success ? {} : issuesToFormErrors(toApiIssues(result.error.issues));
}

export function hasErrors(errors: PostFormErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/**
 * 输入框失焦时把 slug 整理成合法形式：转小写、空白和下划线变连字符、去掉其它字符、合并连字符。
 * 只在失焦时做，打字过程中不改用户的输入（否则光标会乱跳）。
 */
export function normalizeSlug(input: string): string {
  return input
    .normalize("NFKD") // 全角字母数字 → 半角；é → e + 组合符号（下一步去掉）
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * 从标题里提取 slug 建议：只取标题中的拉丁字母和数字（"用 Hono 写 API" → "hono-api"）。
 * 中文没法在不引入拼音库的情况下转写，而且拼音 slug 对读者也不友好；
 * 标题里一个拉丁字符都没有时退回到日期（"2026-10-10"），至少唯一性好、能用。
 */
export function suggestSlug(title: string, now: Date = new Date()): string {
  const words = title.normalize("NFKD").toLowerCase().match(/[a-z0-9]+/g);
  if (words) return words.join("-").slice(0, 80).replace(/-$/, "");
  // 按本地日期，而不是 UTC（toISOString 在北京时间早上 8 点前会得到前一天）
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
