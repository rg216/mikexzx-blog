import { describe, expect, it, vi } from "vitest";
import { CommentApiError, createCommentsApi, githubLoginHref, parseLoginResult } from "./comments-api";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("createCommentsApi", () => {
  it("posts JSON to the proxied endpoint and parses the comment", async () => {
    const comment = { id: 1, author: { login: "a", name: null, avatarUrl: "https://x.test/a" }, bodyMd: "hi", createdAt: "2026-10-10T00:00:00.000Z", editedAt: null, deleted: false, mine: true, replyTo: null, status: "pending" };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(comment, 201));
    expect(await createCommentsApi(fetch).post("hello", { body: "hi" })).toEqual(comment);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/posts/hello/comments");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"body":"hi"}');
  });

  it.each([
    [json({ error: { code: "forbidden", message: "你已被禁止评论" } }, 403), "forbidden"],
    [json({ error: { code: "not_found", message: "评论不存在" } }, 404), "not_found"],
    [json({ error: { code: "unauthorized", message: "请先登录" } }, 401), "unauthorized"],
    [json({ error: { code: "validation_error", message: "评论不能为空" } }, 400), "invalid"],
    [json({ error: { code: "rate_limited", message: "x" } }, 429), "rate_limited"],
    // 上游（比如平台的限流）返回的不是 API 的错误格式，429 仍然按限流处理
    [new Response("Too Many Requests", { status: 429 }), "rate_limited"],
    [new Response("<html>", { status: 502 }), "unavailable"],
    // 不是 API 错误格式的 404（比如地址配错了）：不当成"评论不存在"
    [new Response("<html>404</html>", { status: 404 }), "unavailable"],
    [json({ items: "nope" }), "unavailable"],
  ])("turns error responses into reason codes instead of the API's Chinese message", async (response, reason) => {
    const error = await createCommentsApi(vi.fn(async () => response)).list("a").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommentApiError);
    expect((error as CommentApiError).reason).toBe(reason);
    expect((error as CommentApiError).message).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("reports network failures", async () => {
    const error = await createCommentsApi(vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")))).me().catch((e: unknown) => e);
    expect((error as CommentApiError).reason).toBe("network");
  });
});

describe("editing and deleting", () => {
  it("PATCHes the new body", async () => {
    const comment = { id: 3, author: { login: "a", name: null, avatarUrl: "https://x.test/a" }, bodyMd: "new", createdAt: "2026-10-10T00:00:00.000Z", editedAt: "2026-10-10T01:00:00.000Z", deleted: false, mine: true, replyTo: null, status: "approved" };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(comment));
    expect(await createCommentsApi(fetch).edit(3, "new")).toEqual(comment);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect([url, init?.method, init?.body]).toEqual(["/api/comments/3", "PATCH", '{"body":"new"}']);
  });

  it("treats deleting an already-deleted comment as success", async () => {
    await expect(createCommentsApi(vi.fn(async () => new Response(null, { status: 404 }))).remove(3)).resolves.toBeUndefined();
    await expect(createCommentsApi(vi.fn(async () => new Response(null, { status: 500 }))).remove(3)).rejects.toMatchObject({ reason: "unavailable" });
  });
});

describe("login helpers", () => {
  it("returns to the comments section after login", () => {
    expect(githubLoginHref("/posts/a")).toBe("/api/auth/github/start?next=%2Fposts%2Fa%23comments");
    expect(githubLoginHref("/en/posts/a")).toBe("/api/auth/github/start?next=%2Fen%2Fposts%2Fa%23comments");
  });

  it("returns to the browser URL, not the rewritten route path", () => {
    expect(githubLoginHref("/zh/posts/a")).toBe("/api/auth/github/start?next=%2Fposts%2Fa%23comments");
  });

  it("parses login results", () => {
    expect(parseLoginResult("cancelled")).toBe("cancelled");
    expect(parseLoginResult("failed")).toBe("failed");
    expect(parseLoginResult("unavailable")).toBe("unavailable");
    expect(parseLoginResult("<script>")).toBeNull();
    expect(parseLoginResult(null)).toBeNull();
  });
});
