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

/** 评论接口的错误，message 可以直接展示给读者 */
export class CommentApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CommentApiError";
    this.status = status;
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
      throw new CommentApiError(0, "无法连接服务器，请检查网络后重试", { cause: error });
    }
    const body: unknown = res.status === 204 ? null : await res.json().catch(() => undefined);
    if (!res.ok) {
      const parsed = apiErrorSchema.safeParse(body);
      if (res.status === 429) throw new CommentApiError(429, "评论太频繁，请过几分钟再试");
      throw new CommentApiError(res.status, parsed.success ? parsed.data.error.message : "服务暂时不可用，请稍后重试");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new CommentApiError(res.status, "服务器返回的数据格式不正确", { cause: parsed.error });
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
    async logout(): Promise<void> {
      const res = await fetchImpl("/api/auth/github/logout", { method: "POST", credentials: "same-origin" }).catch(() => null);
      if (!res?.ok) throw new CommentApiError(res?.status ?? 0, "退出失败，请稍后重试");
    },
  };
}

export const commentsApi = createCommentsApi();

/** GitHub 登录入口：整页跳转（OAuth 要离开本站去 GitHub），登录后回到当前文章的评论区 */
export function githubLoginHref(pathname: string): string {
  return `/api/auth/github/start?${new URLSearchParams({ next: `${pathname}#comments` })}`;
}

/** 登录回跳时 API 加在地址上的 ?login=…，翻译成提示；没有返回 null */
export function loginResultMessage(value: string | null): string | null {
  if (value === "cancelled") return "你取消了 GitHub 授权，没有登录。";
  if (value === "failed") return "GitHub 登录没有成功，请重试。";
  if (value === "unavailable") return "评论登录暂未开放。";
  return null;
}
