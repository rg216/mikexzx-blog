import type { ApiError, ApiErrorCode } from "@blog/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";

type Issue = NonNullable<ApiError["error"]["issues"]>[number];

export function errorBody(code: ApiErrorCode, message: string, issues?: Issue[]): ApiError {
  return { error: issues ? { code, message, issues } : { code, message } };
}

/** 路由里 throw 它，由 app.onError 统一转成 JSON 错误响应。 */
export class HttpError extends Error {
  // 不用构造函数参数属性（constructor(readonly status …)）：
  // 那不是"可擦除"语法，Node 的原生 type stripping 跑不了（tsconfig 的 erasableSyntaxOnly 会拦住）
  readonly status: ContentfulStatusCode;
  readonly code: ApiErrorCode;

  constructor(status: ContentfulStatusCode, code: ApiErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 沿着 cause 链找 PostgreSQL 错误码（Drizzle 会把驱动的错误包一层）。 */
export function pgErrorCode(error: unknown): string | undefined {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ("code" in e && typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  }
  return undefined;
}
