import {
  type AdminImage,
  adminImageSchema,
  type AdminPost,
  adminPostSchema,
  type ApiError,
  type ApiErrorCode,
  apiErrorSchema,
  type ImageUpload,
  type ImageUploadRequest,
  imageUploadSchema,
  type PostCreateInput,
  type PostUpdateInput,
} from "@blog/shared";
import { z } from "zod";

/*
 * 管理接口客户端。只在浏览器里运行（管理页面是 Client Components）。
 *
 * 和 lib/api.ts 的区别：
 *   - 走同源路径 /api/admin/...，由 Next rewrites 代理到 apps/api（v2a 配置）。
 *     同源的好处：session cookie 可以设成 httpOnly + SameSite=Lax 的第一方 cookie，浏览器自动带上，JS 读不到；
 *     也不用处理 CORS 预检。
 *   - 写操作的失败是"正常情况"（校验失败、slug 冲突），所以错误要带上结构化信息给表单用，
 *     而不是像构建期那样直接抛一个字符串。
 */

export type AdminApiIssue = NonNullable<ApiError["error"]["issues"]>[number];

/**
 * 客户端额外的两种错误码：
 *   network_error   请求没发出去 / 没收到响应（断网、代理挂了）
 *   bad_response    收到了响应，但不符合 @blog/shared 的约定（前后端版本对不上）
 */
export type AdminApiErrorCode = ApiErrorCode | "network_error" | "bad_response";

export class AdminApiError extends Error {
  // 不用构造函数参数属性：tsconfig 开了 erasableSyntaxOnly
  /** HTTP 状态码；请求没发出去时为 0 */
  readonly status: number;
  readonly code: AdminApiErrorCode;
  /** 字段级错误（只有 validation_error 才有） */
  readonly issues: AdminApiIssue[];

  constructor(status: number, code: AdminApiErrorCode, message: string, issues: AdminApiIssue[] = [], options?: ErrorOptions) {
    super(message, options);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/** 状态码 → 兜底错误码：错误响应体不是约定格式时（比如代理返回的 HTML 502 页面）用它。 */
function codeForStatus(status: number): AdminApiErrorCode {
  if (status === 400 || status === 422) return "validation_error";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  return "internal_error";
}

const fallbackMessages: Record<AdminApiErrorCode, string> = {
  validation_error: "提交的内容有误",
  unauthorized: "登录已过期，请重新登录",
  forbidden: "请求被拒绝，请刷新页面后重试",
  not_found: "文章不存在",
  conflict: "与已有数据冲突",
  rate_limited: "操作太频繁，请稍后再试",
  internal_error: "服务器出错了，请稍后重试",
  network_error: "无法连接服务器，请检查网络后重试",
  bad_response: "服务器返回的数据格式不正确",
};

/** 把错误响应（状态码 + 已解析的 JSON 或 undefined）转换成 AdminApiError。纯函数，便于测试。 */
export function toAdminApiError(status: number, body: unknown): AdminApiError {
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, issues } = parsed.data.error;
    return new AdminApiError(status, code, message, issues ?? []);
  }
  const code = codeForStatus(status);
  return new AdminApiError(status, code, fallbackMessages[code]);
}

type JsonClientOptions = {
  /** 默认用全局 fetch；测试时注入假的 */
  fetch?: typeof fetch;
  /** 收到 401 时调用。默认跳到登录页，登录后回到当前页面 */
  onUnauthorized?: () => void;
  basePath?: string;
};

export const LOGIN_PATH = "/admin/login";

export function redirectToLogin(): void {
  const next = `${window.location.pathname}${window.location.search}`;
  // 故意用整页跳转而不是 router.push：这里在 React 之外拿不到 router；
  // 而且 session 失效后页面上的状态都不可信了，干净地重新加载更稳妥
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 见上
  window.location.assign(`${LOGIN_PATH}?${new URLSearchParams({ next })}`);
}

const postListSchema = z.array(adminPostSchema);

/**
 * 后台各接口共用的 JSON 客户端：发请求、把错误响应转成 AdminApiError、用 schema 校验响应。
 * 管理文章（createAdminApi）和登录 / Passkey（lib/auth-api.ts）都基于它。
 */
export function createJsonClient({ fetch: fetchImpl = (...args) => fetch(...args), onUnauthorized = redirectToLogin, basePath = "/api/admin" }: JsonClientOptions = {}) {
  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    const init: RequestInit = {
      method,
      // 同源请求默认就会带 cookie，这里写明，防止以后有人改成跨域地址时悄悄丢了鉴权
      credentials: "same-origin",
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    };

    let res: Response;
    try {
      res = await fetchImpl(`${basePath}${path}`, init);
    } catch (error) {
      throw new AdminApiError(0, "network_error", fallbackMessages.network_error, [], { cause: error });
    }

    if (res.ok) return res;

    if (res.status === 401) onUnauthorized();
    // 错误响应体可能不是 JSON（代理错误页），解析失败就当没有
    const errorBody: unknown = await res.json().catch(() => undefined);
    throw toAdminApiError(res.status, errorBody);
  }

  async function parseJson<T extends z.ZodType>(res: Response, schema: T): Promise<z.output<T>> {
    const json: unknown = await res.json().catch(() => undefined);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AdminApiError(res.status, "bad_response", fallbackMessages.bad_response, [], { cause: parsed.error });
    }
    return parsed.data;
  }

  return { request, parseJson };
}

export function createAdminApi(options: JsonClientOptions = {}) {
  const { request, parseJson } = createJsonClient(options);

  return {
    /** 全部文章（含草稿），按更新时间倒序 */
    async listPosts(): Promise<AdminPost[]> {
      return parseJson(await request("GET", "/posts"), postListSchema);
    },

    async getPost(id: number): Promise<AdminPost> {
      return parseJson(await request("GET", `/posts/${id}`), adminPostSchema);
    },

    async createPost(input: PostCreateInput): Promise<AdminPost> {
      return parseJson(await request("POST", "/posts", input), adminPostSchema);
    },

    /** 部分更新：只传改动过的字段（见 lib/post-form.ts 的 buildUpdateInput） */
    async updatePost(id: number, input: PostUpdateInput): Promise<AdminPost> {
      return parseJson(await request("PATCH", `/posts/${id}`, input), adminPostSchema);
    },

    async deletePost(id: number): Promise<void> {
      await request("DELETE", `/posts/${id}`);
    },

    /** 申请上传一张图片：拿到预签名 URL（见 lib/image-upload.ts） */
    async createImageUpload(input: ImageUploadRequest): Promise<ImageUpload> {
      return parseJson(await request("POST", "/images", input), imageUploadSchema);
    },

    /** 文件传到存储之后，请 API 核对并确认 */
    async confirmImage(id: number): Promise<AdminImage> {
      return parseJson(await request("POST", `/images/${id}/confirm`), adminImageSchema);
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;

/** 页面里用的默认实例。 */
export const adminApi = createAdminApi();
