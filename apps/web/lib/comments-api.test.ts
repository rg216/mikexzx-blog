import { describe, expect, it, vi } from "vitest";
import { CommentApiError, createCommentsApi, githubLoginHref, loginResultMessage } from "./comments-api";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("createCommentsApi", () => {
  it("posts JSON to the proxied endpoint and parses the comment", async () => {
    const comment = { id: 1, author: { login: "a", name: null, avatarUrl: "https://x.test/a" }, bodyMd: "hi", createdAt: "2026-10-10T00:00:00.000Z", replyTo: null, status: "pending" };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(comment, 201));
    expect(await createCommentsApi(fetch).post("hello", { body: "hi" })).toEqual(comment);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/posts/hello/comments");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"body":"hi"}');
  });

  it.each([
    [json({ error: { code: "forbidden", message: "你已被禁止评论" } }, 403), "你已被禁止评论"],
    [json({ error: { code: "rate_limited", message: "x" } }, 429), "评论太频繁，请过几分钟再试"],
    [new Response("<html>", { status: 502 }), "服务暂时不可用，请稍后重试"],
  ])("turns error responses into readable messages", async (response, message) => {
    const error = await createCommentsApi(vi.fn(async () => response)).list("a").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommentApiError);
    expect((error as CommentApiError).message).toBe(message);
  });
});

describe("login helpers", () => {
  it("returns to the comments section after login", () => {
    expect(githubLoginHref("/posts/a")).toBe("/api/auth/github/start?next=%2Fposts%2Fa%23comments");
  });

  it("explains login results", () => {
    expect(loginResultMessage("cancelled")).toContain("取消");
    expect(loginResultMessage(null)).toBeNull();
  });
});
