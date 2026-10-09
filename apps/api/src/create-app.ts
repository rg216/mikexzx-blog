import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { Db } from "./db/client.ts";
import { errorBody, HttpError, pgErrorCode } from "./lib/errors.ts";
import { adminRoutes } from "./routes/admin.ts";
import { publicRoutes } from "./routes/public.ts";

type AppOptions = {
  db: Db;
  adminToken: string;
  /** 测试里关掉，避免刷屏 */
  logRequests?: boolean;
};

/** 组装应用。依赖从外面传入（而不是在模块里直接连库），测试时可以换成测试库。 */
export function createApp({ db, adminToken, logRequests = false }: AppOptions) {
  const app = new Hono();

  if (logRequests) app.use(logger());
  app.use(secureHeaders());

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", publicRoutes(db));
  app.route("/admin", adminRoutes(db, adminToken));

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
