import type { ApiErrorReason } from "@/lib/api-error-reason";
import type { Dictionary } from "@/lib/i18n";

type Errors = Dictionary["comments"]["errors"];

/**
 * 评论接口的失败原因 → 当前语言的文字。fallback：服务端问题时更具体的说法（比如"删除失败"）。
 * 不显示 API 返回的 message：它是中文的。
 */
export function commentErrorText(t: Errors, reason: ApiErrorReason, fallback?: string): string {
  switch (reason) {
    case "network":
      return t.network;
    case "rate_limited":
      return t.rateLimited;
    case "invalid":
      return t.invalid;
    case "unauthorized":
      return t.unauthorized;
    case "forbidden":
      return t.forbidden;
    case "not_found":
      return t.notFound;
    case "unavailable":
      return fallback ?? t.unavailable;
  }
}
