import {
  type CoverBriefInput,
  type CoverBriefResult,
  coverBriefResultSchema,
  type CoverConfig,
  coverConfigSchema,
  type CoverImageInput,
  type CoverImageResult,
  type CoverImageStreamEvent,
  coverImageStreamEventSchema,
  type AdminComment,
  type AdminCommenter,
  adminCommenterSchema,
  adminCommentSchema,
  type CommenterTrust,
  type CommentStatus,
  type AdminImage,
  type AdminImageDetail,
  adminImageDetailSchema,
  type ImageListQuery,
  type ImageUpdateInput,
  type MediaFolder,
  mediaFolderSchema,
  adminImageSchema,
  type AdminPost,
  adminPostSchema,
  type AdminTranslation,
  adminTranslationSchema,
  type ApiError,
  type ApiErrorCode,
  apiErrorSchema,
  type ImageUpload,
  type ImageUploadRequest,
  imageUploadSchema,
  type Locale,
  type PostCreateInput,
  type PostUpdateInput,
  type TranslationConfig,
  translationConfigSchema,
  type SiteSettings,
  siteSettingsSchema,
  type SiteSettingsUpdate,
  type SystemStatus,
  systemStatusSchema,
  type TranslationGenerateInput,
  type TranslationModelId,
  type TranslationInput,
  type TranslationStreamEvent,
  translationStreamEventSchema,
  type TranslationTitleResult,
  translationTitleResultSchema,
  type AdminTag,
  adminTagSchema,
  type TagInput,
  type TagTranslateInput,
  type TagTranslateResult,
  tagTranslateResultSchema,
  type TagUpdateInput,
} from "@blog/shared";
import { z } from "zod";
import { LineDecodeError, readLines } from "./ndjson";

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

type RequestOptions = {
  /** 中止请求（"停止生成"）。中止时原样抛出 fetch 的 AbortError，不包装成 network_error：那不是故障 */
  signal?: AbortSignal;
  /** 期望的响应类型，默认 JSON */
  accept?: string;
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
const commentListSchema = z.array(adminCommentSchema);
const commenterListSchema = z.array(adminCommenterSchema);
const pendingCountSchema = z.object({ count: z.int().nonnegative() });
const imageListSchema = z.array(adminImageSchema);
const folderListSchema = z.array(mediaFolderSchema);
const tagListSchema = z.array(adminTagSchema);
const deletedSchema = z.object({ deleted: z.int().nonnegative() });

/** 一段正文翻译完成：done 事件（stopReason 不一定是 end_turn，由调用方判断成败，见 translation-generation.ts） */
export type TranslationSegmentResult = Extract<TranslationStreamEvent, { type: "done" }>;

export type StreamSegmentOptions = {
  /** 第几段（按 splitMarkdownForTranslation(原文) 计算，从 0 开始） */
  index: number;
  /** 编辑器加载文章时拿到的原文指纹；原文之后改过的话 API 返回 409 */
  sourceHash: string;
  /** 开始生成时定下的模型（整篇同一个）；不传时 API 用设置里的 */
  model?: TranslationModelId | undefined;
  signal?: AbortSignal;
  /** 每收到一小段译文调用一次（实时显示） */
  onDelta?: (text: string) => void;
  /** 收到心跳（API 那边一段时间没有输出：模型还在思考）时调用；心跳不带内容 */
  onPing?: () => void;
};

const streamBroken = "连接中断，这一段没有翻译完";
const imageStreamBroken = "连接中断，图片没有生成完";

/** 解析 NDJSON 的一行：不是 JSON、或不符合 @blog/shared 的事件约定，都是 bad_response。纯函数，便于测试 */
function parseStreamLine<T>(line: string, schema: z.ZodType<T>, status: number): T {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch (error) {
    throw new AdminApiError(status, "bad_response", fallbackMessages.bad_response, [], { cause: error });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AdminApiError(status, "bad_response", fallbackMessages.bad_response, [], { cause: parsed.error });
  return parsed.data;
}

export function parseTranslationStreamLine(line: string, status = 200): TranslationStreamEvent {
  return parseStreamLine(line, translationStreamEventSchema, status);
}

export function parseCoverImageStreamLine(line: string, status = 200): CoverImageStreamEvent {
  return parseStreamLine(line, coverImageStreamEventSchema, status);
}

export type GenerateCoverImageOptions = {
  signal?: AbortSignal;
  /** 生成过程中的预览（base64） */
  onPartial?: (preview: { image: string; contentType: string; index: number }) => void;
  onPing?: () => void;
};

/**
 * 后台各接口共用的 JSON 客户端：发请求、把错误响应转成 AdminApiError、用 schema 校验响应。
 * 管理文章（createAdminApi）和登录 / Passkey（lib/auth-api.ts）都基于它。
 */
export function createJsonClient({ fetch: fetchImpl = (...args) => fetch(...args), onUnauthorized = redirectToLogin, basePath = "/api/admin" }: JsonClientOptions = {}) {
  async function request(method: string, path: string, body?: unknown, { signal, accept = "application/json" }: RequestOptions = {}): Promise<Response> {
    const init: RequestInit = {
      method,
      // 同源请求默认就会带 cookie，这里写明，防止以后有人改成跨域地址时悄悄丢了鉴权
      credentials: "same-origin",
      headers: body === undefined ? { accept } : { accept, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    };

    let res: Response;
    try {
      res = await fetchImpl(`${basePath}${path}`, init);
    } catch (error) {
      if (signal?.aborted) throw error;
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

    /*
     * 译文：每篇文章每种语言一篇，用 (文章 id, 语言) 定位。
     * 没有译文时 GET 返回 404——和"文章不存在"同一个错误码，所以调用方先看 AdminPost.translations
     * 里有没有这种语言，有才来取，不靠 404 判断"还没有译文"。
     */
    async getTranslation(postId: number, locale: Locale): Promise<AdminTranslation> {
      return parseJson(await request("GET", `/posts/${postId}/translations/${locale}`), adminTranslationSchema);
    },

    /** 新建或整体替换（PUT 幂等：重复提交同样的内容结果相同）；摘要和搜索索引由 API 生成 */
    async saveTranslation(postId: number, locale: Locale, input: TranslationInput): Promise<AdminTranslation> {
      return parseJson(await request("PUT", `/posts/${postId}/translations/${locale}`, input), adminTranslationSchema);
    },

    async deleteTranslation(postId: number, locale: Locale): Promise<void> {
      await request("DELETE", `/posts/${postId}/translations/${locale}`);
    },

    /*
     * 大模型翻译（v5.5）。只有作者在后台点按钮才会调用；生成的结果先进编辑器，保存（saveTranslation）后才对读者可见。
     */
    async getTranslationConfig(): Promise<TranslationConfig> {
      return parseJson(await request("GET", "/translation/config"), translationConfigSchema);
    },

    /** 生成标题：一次普通的 JSON 请求（标题很短，不流式） */
    async generateTranslationTitle(postId: number, locale: Locale, sourceHash: string, signal?: AbortSignal, model?: TranslationModelId): Promise<TranslationTitleResult> {
      const input: TranslationGenerateInput = { part: "title", sourceHash, ...(model ? { model } : {}) };
      const res = await request("POST", `/posts/${postId}/translations/${locale}/generate`, input, { signal });
      return parseJson(res, translationTitleResultSchema);
    },

    /**
     * 生成正文的一段：响应是 NDJSON 流，若干 delta 之后以 done 或 error 结束。
     *   - done：返回它（拒答、截断也是 done，stopReason 不同）
     *   - error：抛 AdminApiError（错误码来自事件）
     *   - 流在 done / error 之前断了：network_error——半段译文不能当成整段用
     *   - signal 中止：原样抛出 AbortError
     * 流开始之前的错误（401、404、409、429、503…）是普通的 JSON 错误响应，和其他接口一样处理。
     */
    async streamTranslationSegment(postId: number, locale: Locale, { index, sourceHash, model, signal, onDelta, onPing }: StreamSegmentOptions): Promise<TranslationSegmentResult> {
      const input: TranslationGenerateInput = { part: "body", index, sourceHash, ...(model ? { model } : {}) };
      const res = await request("POST", `/posts/${postId}/translations/${locale}/generate`, input, { signal, accept: "application/x-ndjson" });
      if (!res.body) throw new AdminApiError(res.status, "bad_response", fallbackMessages.bad_response);
      try {
        for await (const line of readLines(res.body)) {
          const event = parseTranslationStreamLine(line, res.status);
          // ping 只是让连接保持有数据，不是内容
          if (event.type === "ping") onPing?.();
          else if (event.type === "delta") onDelta?.(event.text);
          // 提前返回会结束 readLines，它负责取消剩下的流
          else if (event.type === "done") return event;
          else throw new AdminApiError(res.status, event.code, event.message || fallbackMessages[event.code]);
        }
      } catch (error) {
        if (error instanceof AdminApiError) throw error;
        // 读响应体时被中止：读取会以 AbortError 失败
        if (signal?.aborted) throw error;
        if (error instanceof LineDecodeError) throw new AdminApiError(res.status, "bad_response", fallbackMessages.bad_response, [], { cause: error });
        throw new AdminApiError(0, "network_error", streamBroken, [], { cause: error });
      }
      // 流正常结束却没有 done：服务端函数被掐断（超时）之类，这一段不完整
      throw new AdminApiError(res.status, "network_error", streamBroken);
    },

    /*
     * 生成头图：两步都只回结果，选中的图由浏览器上传进媒体库（lib/image-upload.ts）。
     */
    async getCoverConfig(): Promise<CoverConfig> {
      return parseJson(await request("GET", "/covers/config"), coverConfigSchema);
    },

    /** Claude 按表单里此刻的标题、标签、正文写画面描述 */
    async writeCoverBrief(input: CoverBriefInput, signal?: AbortSignal): Promise<CoverBriefResult> {
      return parseJson(await request("POST", "/covers/brief", input, { signal }), coverBriefResultSchema);
    },

    /**
     * 出图：NDJSON 流，ping / partial 之后以 done 或 error 结束（和译文段的流同样的处理方式）。
     * 流开始之前的错误（内容审核拦下提示词 400、429、503…）是普通的 JSON 错误响应。
     */
    async generateCoverImage(input: CoverImageInput, { signal, onPartial, onPing }: GenerateCoverImageOptions = {}): Promise<CoverImageResult> {
      const res = await request("POST", "/covers/generate", input, { signal, accept: "application/x-ndjson" });
      if (!res.body) throw new AdminApiError(res.status, "bad_response", fallbackMessages.bad_response);
      try {
        for await (const line of readLines(res.body)) {
          const event = parseCoverImageStreamLine(line, res.status);
          if (event.type === "ping") onPing?.();
          else if (event.type === "partial") onPartial?.({ image: event.image, contentType: event.contentType, index: event.index });
          else if (event.type === "done") return event;
          else throw new AdminApiError(res.status, event.code, event.message || fallbackMessages[event.code]);
        }
      } catch (error) {
        if (error instanceof AdminApiError) throw error;
        if (signal?.aborted) throw error;
        if (error instanceof LineDecodeError) throw new AdminApiError(res.status, "bad_response", fallbackMessages.bad_response, [], { cause: error });
        throw new AdminApiError(0, "network_error", imageStreamBroken, [], { cause: error });
      }
      throw new AdminApiError(res.status, "network_error", imageStreamBroken);
    },

    /** 全部标签（含没有文章用的），按使用次数排序 */
    async listTags(): Promise<AdminTag[]> {
      return parseJson(await request("GET", "/tags"), tagListSchema);
    },

    async createTag(input: TagInput): Promise<AdminTag> {
      return parseJson(await request("POST", "/tags", input), adminTagSchema);
    },

    async updateTag(id: number, input: TagUpdateInput): Promise<AdminTag> {
      return parseJson(await request("PATCH", `/tags/${id}`, input), adminTagSchema);
    },

    async deleteTag(id: number): Promise<void> {
      await request("DELETE", `/tags/${id}`);
    },

    /** 请大模型给标签名起各语言的译名（只回给编辑框，保存标签后才生效） */
    async translateTag(input: TagTranslateInput, signal?: AbortSignal): Promise<TagTranslateResult> {
      return parseJson(await request("POST", "/tags/translate", input, { signal }), tagTranslateResultSchema);
    },

    /** 把标签 id 合并进 into，返回合并后的 into */
    async mergeTag(id: number, into: number): Promise<AdminTag> {
      return parseJson(await request("POST", `/tags/${id}/merge`, { into }), adminTagSchema);
    },

    /** 申请上传一张图片：拿到预签名 URL（见 lib/image-upload.ts） */
    async createImageUpload(input: ImageUploadRequest): Promise<ImageUpload> {
      return parseJson(await request("POST", "/images", input), imageUploadSchema);
    },

    /** 文件传到存储之后，请 API 核对并确认 */
    async confirmImage(id: number): Promise<AdminImage> {
      return parseJson(await request("POST", `/images/${id}/confirm`), adminImageSchema);
    },

    async listImages(query: ImageListQuery = {}): Promise<AdminImage[]> {
      const params = new URLSearchParams();
      if (query.folder !== undefined && query.folder !== "all") params.set("folder", String(query.folder));
      if (query.q) params.set("q", query.q);
      if (query.unused) params.set("unused", "1");
      const search = params.size > 0 ? `?${params}` : "";
      return parseJson(await request("GET", `/images${search}`), imageListSchema);
    },

    async getImage(id: number): Promise<AdminImageDetail> {
      return parseJson(await request("GET", `/images/${id}`), adminImageDetailSchema);
    },

    async updateImage(id: number, input: ImageUpdateInput): Promise<AdminImage> {
      return parseJson(await request("PATCH", `/images/${id}`, input), adminImageSchema);
    },

    async moveImages(ids: number[], folderId: number | null): Promise<void> {
      await request("POST", "/images/move", { ids, folderId });
    },

    /** 仍被文章引用的图片需要 force，否则返回 409（message 里列出了受影响的文章） */
    async deleteImages(ids: number[], force = false): Promise<number> {
      return (await parseJson(await request("POST", "/images/delete", { ids, force }), deletedSchema)).deleted;
    },

    async listFolders(): Promise<MediaFolder[]> {
      return parseJson(await request("GET", "/media-folders"), folderListSchema);
    },

    async createFolder(name: string): Promise<MediaFolder> {
      return parseJson(await request("POST", "/media-folders", { name }), mediaFolderSchema);
    },

    async renameFolder(id: number, name: string): Promise<void> {
      await request("PATCH", `/media-folders/${id}`, { name });
    },

    async deleteFolder(id: number): Promise<void> {
      await request("DELETE", `/media-folders/${id}`);
    },

    async listComments(status: CommentStatus): Promise<AdminComment[]> {
      return parseJson(await request("GET", `/comments?status=${status}`), commentListSchema);
    },

    async pendingCommentCount(): Promise<number> {
      return (await parseJson(await request("GET", "/comments/pending-count"), pendingCountSchema)).count;
    },

    async moderateComment(id: number, status: "approved" | "rejected"): Promise<void> {
      await request("PATCH", `/comments/${id}`, { status });
    },

    async deleteComment(id: number): Promise<void> {
      await request("DELETE", `/comments/${id}`);
    },

    async listCommenters(): Promise<AdminCommenter[]> {
      return parseJson(await request("GET", "/commenters"), commenterListSchema);
    },

    /** 加入白名单会同时通过他所有待审核的评论；拉黑会拒绝它们 */
    async setCommenterTrust(id: number, trust: CommenterTrust): Promise<AdminCommenter> {
      return parseJson(await request("PATCH", `/commenters/${id}`, { trust }), adminCommenterSchema);
    },

    /** 按 GitHub 用户名加入白名单 */
    async addTrustedCommenter(login: string): Promise<AdminCommenter> {
      return parseJson(await request("POST", "/commenters", { login }), adminCommenterSchema);
    },

    // ---------- 设置与状态页 ----------

    async getSettings(): Promise<SiteSettings> {
      return parseJson(await request("GET", "/settings"), siteSettingsSchema);
    },

    /** 只改给出的键，返回改完的完整设置 */
    async updateSettings(update: SiteSettingsUpdate): Promise<SiteSettings> {
      return parseJson(await request("PATCH", "/settings", update), siteSettingsSchema);
    },

    /** 各项依赖和定时任务的状态（只有状态，不含任何配置值） */
    async getStatus(): Promise<SystemStatus> {
      return parseJson(await request("GET", "/status"), systemStatusSchema);
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;

/** 页面里用的默认实例。 */
export const adminApi = createAdminApi();
