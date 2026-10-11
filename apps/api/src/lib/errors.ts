import type { ApiError, ApiErrorCode } from "@blog/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type Issue = NonNullable<ApiError["error"]["issues"]>[number];

export function errorBody(code: ApiErrorCode, message: string, issues?: Issue[]): ApiError {
  return { error: issues ? { code, message, issues } : { code, message } };
}

/** 路由里 throw 它，由 app.onError 统一转成 JSON 错误响应。 */
export class HttpError extends Error {
  // 不用构造函数参数属性（constructor(readonly status …)）：
  // 那不是"可擦除"语法，Node 的原生 type stripping 跑不了（tsconfig 的 erasableSyntaxOnly 会拦住）
  readonly status: ContentfulStatusCode;
  readonly code: ApiErrorCode;
  /** 校验错误的明细（如机器译文的结构问题），原样放进响应的 issues */
  readonly issues: Issue[] | undefined;

  constructor(status: ContentfulStatusCode, code: ApiErrorCode, message: string, issues?: Issue[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/** 沿着 cause 链找 PostgreSQL 的错误（Drizzle 会把驱动的错误包一层），返回错误码和违反的约束名。 */
export function pgErrorOf(error: unknown): { code: string; constraint: string | undefined } | undefined {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ("code" in e && typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
      const constraint = "constraint" in e && typeof e.constraint === "string" ? e.constraint : undefined;
      return { code: e.code, constraint };
    }
  }
  return undefined;
}

/** 唯一约束被违反时给用户看的说明，按约束名（见 schema.ts / 迁移文件） */
const uniqueViolationMessages: Record<string, string> = {
  posts_slug_unique: "slug 已被其他文章使用",
  tags_slug_unique: "已经有使用这个 slug 的标签",
  tags_name_lower_idx: "已经有同名的标签",
  tag_translations_locale_name_idx: "这种语言里已经有同名的标签",
  media_folders_name_unique: "已经有同名的文件夹",
};

export function uniqueViolationMessage(constraint: string | undefined): string {
  return (constraint && uniqueViolationMessages[constraint]) || "与已有的数据重复";
}
