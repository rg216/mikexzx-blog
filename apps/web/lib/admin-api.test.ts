import type { AdminPost } from "@blog/shared";
import { describe, expect, it, vi } from "vitest";
import { AdminApiError, createAdminApi, toAdminApiError } from "./admin-api";

const post: AdminPost = {
  id: 1,
  slug: "hello",
  title: "你好",
  contentMd: "正文",
  excerpt: "正文",
  status: "draft",
  publishedAt: null,
  tags: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** 假 fetch：记录调用，返回给定的响应。 */
function setup(response: Response | Error) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const onUnauthorized = vi.fn();
  const api = createAdminApi({ fetch, onUnauthorized });
  return { api, fetch, onUnauthorized };
}

async function catchError(promise: Promise<unknown>): Promise<AdminApiError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof AdminApiError)) throw new Error(`expected AdminApiError, got ${String(error)}`);
  return error;
}

describe("toAdminApiError", () => {
  it("keeps code, message and issues from a well-formed error body", () => {
    const error = toAdminApiError(400, {
      error: { code: "validation_error", message: "请求参数无效", issues: [{ path: "slug", message: "格式不对" }] },
    });
    expect(error).toMatchObject({
      status: 400,
      code: "validation_error",
      message: "请求参数无效",
      issues: [{ path: "slug", message: "格式不对" }],
    });
  });

  it("falls back to a code derived from the status when the body is not an API error", () => {
    expect(toAdminApiError(409, "<html>")).toMatchObject({ code: "conflict", issues: [] });
    expect(toAdminApiError(502, undefined)).toMatchObject({ status: 502, code: "internal_error" });
  });
});

describe("createAdminApi", () => {
  it("sends JSON with same-origin credentials to the proxied path", async () => {
    const { api, fetch } = setup(jsonResponse(201, post));
    await api.createPost({ title: "你好", slug: "hello", contentMd: "正文" });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/posts");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ title: "你好", slug: "hello", contentMd: "正文" });
  });

  it("PATCHes only the given fields", async () => {
    const { api, fetch } = setup(jsonResponse(200, post));
    await api.updatePost(1, { status: "published" });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/admin/posts/1");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe('{"status":"published"}');
  });

  it("validates responses against the shared schema", async () => {
    const { api } = setup(jsonResponse(200, [{ ...post, status: "archived" }]));
    const error = await catchError(api.listPosts());
    expect(error.code).toBe("bad_response");
  });

  it("returns nothing for 204 on delete", async () => {
    const { api } = setup(new Response(null, { status: 204 }));
    await expect(api.deletePost(1)).resolves.toBeUndefined();
  });

  it("calls onUnauthorized on 401 and still rejects", async () => {
    const { api, onUnauthorized } = setup(jsonResponse(401, { error: { code: "unauthorized", message: "未登录" } }));
    const error = await catchError(api.getPost(1));
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(error).toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("does not call onUnauthorized for other errors", async () => {
    const { api, onUnauthorized } = setup(jsonResponse(409, { error: { code: "conflict", message: "slug 已被使用" } }));
    const error = await catchError(api.updatePost(1, { slug: "taken" }));
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(error).toMatchObject({ status: 409, code: "conflict", message: "slug 已被使用" });
  });

  it("wraps network failures", async () => {
    const { api } = setup(new TypeError("Failed to fetch"));
    const error = await catchError(api.listPosts());
    expect(error).toMatchObject({ status: 0, code: "network_error" });
    expect(error.cause).toBeInstanceOf(TypeError);
  });
});
