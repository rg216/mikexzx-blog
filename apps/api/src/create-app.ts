import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { AuthConfig } from "./auth/config.ts";
import { simpleWebAuthn, type WebAuthn } from "./auth/webauthn.ts";
import type { Db } from "./db/client.ts";
import { errorBody, HttpError, pgErrorCode } from "./lib/errors.ts";
import { createRateLimiter, unlimited } from "./lib/rate-limit.ts";
import { noopRevalidator, type Revalidator } from "./lib/revalidate.ts";
import { type AuthEnv, loadSession, requireSameOrigin } from "./middleware/auth.ts";
import { adminRoutes } from "./routes/admin.ts";
import type { RedisProvider } from "./redis.ts";
import { authRoutes } from "./routes/auth.ts";
import { internalRoutes } from "./routes/internal.ts";
import { publicRoutes } from "./routes/public.ts";
import { searchRoutes } from "./routes/search.ts";
import { viewRoutes } from "./routes/views.ts";
import type { ObjectStorage } from "./storage.ts";

type AppOptions = {
  db: Db;
  auth: AuthConfig;
  /** 测试时替换成假实现；默认用 SimpleWebAuthn */
  webauthn?: WebAuthn;
  /** 写入文章后通知前端失效缓存；默认不通知 */
  revalidate?: Revalidator;
  /** 限流与阅读计数用；不传则不限流、不计数 */
  redis?: RedisProvider | null;
  /** 图片上传用的对象存储；不传则上传接口返回 503 */
  storage?: ObjectStorage | null;
  /** 定时任务接口的密钥；不传则定时任务接口返回 503 */
  cronSecret?: string;
  /** 测试里关掉，避免刷屏 */
  logRequests?: boolean;
};

/** 组装应用。依赖从外面传入（而不是在模块里直接连库），测试时可以换成测试库。 */
export function createApp({
  db,
  auth,
  webauthn = simpleWebAuthn,
  revalidate = noopRevalidator,
  redis = null,
  storage = null,
  cronSecret,
  logRequests = false,
}: AppOptions) {
  const app = new Hono<AuthEnv>();
  const limiter = redis ? createRateLimiter(redis) : unlimited;

  if (logRequests) app.use(logger());
  app.use(secureHeaders());
  // 所有写请求先校验 Origin（CSRF），再加载 session
  app.use(requireSameOrigin(auth));
  app.use(loadSession(db, auth));

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", publicRoutes(db));
  app.route("/", viewRoutes(db, redis, limiter));
  app.route("/", searchRoutes(db, limiter));
  app.route("/auth", authRoutes(db, auth, webauthn, limiter));
  app.route("/admin", adminRoutes(db, revalidate, limiter, storage));
  app.route("/internal", internalRoutes(db, redis, storage, cronSecret));

  app.notFound((c) => c.json(errorBody("not_found", "接口不存在"), 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(errorBody(err.code, err.message), err.status);

    // Hono 自己抛出的客户端错误（如请求体不是合法 JSON）：保留状态码，不要当成 500
    if (err instanceof HTTPException && err.status < 500) {
      const code = err.status === 401 ? "unauthorized" : err.status === 404 ? "not_found" : "validation_error";
      return c.json(errorBody(code, err.message), err.status);
    }

    // 数据库约束兜底：并发请求可能绕过应用层检查，最终由数据库拒绝
    switch (pgErrorCode(err)) {
      case "23505": // unique_violation
        return c.json(errorBody("conflict", "slug 已被其他文章使用"), 409);
      case "23514": // check_violation
        return c.json(errorBody("validation_error", "已发布的文章必须有发布时间"), 400);
    }

    console.error(err);
    // 不把内部错误细节返回给客户端
    return c.json(errorBody("internal_error", "服务器内部错误"), 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
