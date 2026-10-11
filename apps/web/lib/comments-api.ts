import {
  apiErrorSchema,
  type CommentCreateInput,
  type CommenterMe,
  commenterMeSchema,
  type CommentList,
  commentListSchema,
  type PublicComment,
  publicCommentSchema,
} from "@blog/shared";
import type { z } from "zod";
import { type ApiErrorReason, reasonFromStatus } from "./api-error-reason";
import { browserPath } from "./i18n/paths";

/**
 * 评论接口的错误。reason 由组件按字典翻译成当前语言的文字；message 只用于日志和调试——
 * API 的 message 是中文的，英文、日文页面上不直接显示它。
 */
export class CommentApiError extends Error {
  readonly status: number;
  readonly reason: ApiErrorReason;
  constructor(status: number, reason: ApiErrorReason = reasonFromStatus(status), options?: ErrorOptions) {
    super(`comments API failed: ${reason} (${status})`, options);
    this.name = "CommentApiError";
    this.status = status;
    this.reason = reason;
  }
}

/**
 * 评论区在浏览器里调用的接口（经 /api 代理，评论者的 cookie 是第一方的）。
 * fetch 可注入，便于测试。
 */
export function createCommentsApi(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  async function call<T extends z.ZodType>(path: string, schema: T, init: RequestInit = {}): Promise<z.output<T>> {
    let res: Response;
    try {
      res = await fetchImpl(`/api${path}`, { credentials: "same-origin", ...init, headers: { accept: "application/json", ...init.headers } });
    } catch (error) {
      throw new CommentApiError(0, "network", { cause: error });
    }
    const body: unknown = res.status === 204 ? null : await res.json().catch(() => undefined);
    if (!res.ok) {
      // 错误码以 HTTP 状态为准；网关的 HTML 错误页之类不符合 apiErrorSchema 的响应一律算服务端问题
      const reason = res.status >= 500 || !apiErrorSchema.safeParse(body).success ? "unavailable" : reasonFromStatus(res.status);
      throw new CommentApiError(res.status, res.status === 429 ? "rate_limited" : reason);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new CommentApiError(res.status, "unavailable", { cause: parsed.error });
    return parsed.data;
  }

  return {
    me: (): Promise<CommenterMe> => call("/auth/github/me", commenterMeSchema),
    list: (slug: string): Promise<CommentList> => call(`/posts/${encodeURIComponent(slug)}/comments`, commentListSchema),
    post: (slug: string, input: CommentCreateInput): Promise<PublicComment> =>
      call(`/posts/${encodeURIComponent(slug)}/comments`, publicCommentSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    edit: (id: number, body: string): Promise<PublicComment> =>
      call(`/comments/${id}`, publicCommentSchema, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      }),
    async remove(id: number): Promise<void> {
      let res: Response;
      try {
        res = await fetchImpl(`/api/comments/${id}`, { method: "DELETE", credentials: "same-origin" });
      } catch (error) {
        throw new CommentApiError(0, "network", { cause: error });
      }
      // 已经不存在了（比如在另一个标签页删过）：结果和成功一样
      if (!res.ok && res.status !== 404) throw new CommentApiError(res.status);
    },
    async logout(): Promise<void> {
      const res = await fetchImpl("/api/auth/github/logout", { method: "POST", credentials: "same-origin" }).catch(() => null);
      if (!res?.ok) throw new CommentApiError(res?.status ?? 0);
    },
  };
}

export const commentsApi = createCommentsApi();

/**
 * GitHub 登录入口：整页跳转（OAuth 要离开本站去 GitHub），登录后回到当前文章的评论区。
 * pathname 来自 usePathname()：服务端渲染时可能是 rewrite 后的路由路径（/zh/posts/a），
 * 统一成浏览器网址（/posts/a），否则登录回来会落到 /zh/… 的 404。
 */
export function githubLoginHref(pathname: string): string {
  return `/api/auth/github/start?${new URLSearchParams({ next: `${browserPath(pathname)}#comments` })}`;
}

export type LoginResult = "cancelled" | "failed" | "unavailable";

/** 登录回跳时 API 加在地址上的 ?login=…；不认识的值返回 null。文字由组件按字典显示 */
export function parseLoginResult(value: string | null): LoginResult | null {
  return value === "cancelled" || value === "failed" || value === "unavailable" ? value : null;
}
