import { adminCommenterSchema, adminCommentSchema, commenterMeSchema, commentListSchema, publicCommentSchema } from "@blog/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { githubUser, setupTestApp } from "./helpers.ts";

const { request, createPost, loginCommenter, fakeGitHub, jar } = setupTestApp();

const alice = githubUser(101, "alice");
const bob = githubUser(102, "bob");

/** 以评论者身份请求（不带管理员 cookie） */
const as = (cookie: string | null) => ({ auth: false, useJar: false, headers: cookie ? { cookie } : ({} as Record<string, string>) });

async function comment(slug: string, cookie: string, body: string, parentId?: number) {
  const res = await request("POST", `/posts/${slug}/comments`, { ...as(cookie), body: { body, ...(parentId && { parentId }) } });
  expect(res.status).toBe(201);
  return publicCommentSchema.parse(res.body);
}

async function list(slug: string, cookie: string | null = null) {
  const res = await request("GET", `/posts/${slug}/comments`, as(cookie));
  expect(res.status).toBe(200);
  return commentListSchema.parse(res.body);
}

async function commenterId(login: string) {
  const res = await request("GET", "/admin/commenters");
  const found = z.array(adminCommenterSchema).parse(res.body).find((c) => c.login === login);
  if (!found) throw new Error(`no commenter ${login}`);
  return found.id;
}

async function trust(login: string, level: "default" | "trusted" | "blocked") {
  const res = await request("PATCH", `/admin/commenters/${await commenterId(login)}`, { body: { trust: level } });
  expect(res.status).toBe(200);
}

describe("GitHub login for commenters", () => {
  it("sends the browser to GitHub with a state cookie and a PKCE challenge", async () => {
    const res = await request("GET", "/auth/github/start?next=%2Fposts%2Fa%23comments", { auth: false });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("https://github.test");
    expect(location.searchParams.get("state")).toBe(jar.get("__Host-oauth"));
    expect(location.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
  });

  it("logs in, returns to the original page, and reports who is logged in", async () => {
    const start = await request("GET", "/auth/github/start?next=%2Fposts%2Fa%23comments", { auth: false });
    const authorizeUrl = start.headers.get("location") ?? "";
    const code = fakeGitHub.approve(authorizeUrl, alice);
    const state = new URL(authorizeUrl).searchParams.get("state") ?? "";
    const callback = await request("GET", `/auth/github/callback?code=${code}&state=${state}`, { auth: false });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/posts/a#comments");
    // state cookie 用过即清
    expect(jar.has("__Host-oauth")).toBe(false);

    const me = commenterMeSchema.parse((await request("GET", "/auth/github/me", { auth: false })).body);
    expect(me).toEqual({ configured: true, commenter: { login: "alice", name: null, avatarUrl: alice.avatarUrl, trust: "default" } });
  });

  it("refuses a callback whose state does not match the browser's cookie (login CSRF)", async () => {
    // 攻击者自己发起登录、拿到授权码，再把回调链接发给受害者
    const attacker = await request("GET", "/auth/github/start", { auth: false, useJar: false });
    const authorizeUrl = attacker.headers.get("location") ?? "";
    const code = fakeGitHub.approve(authorizeUrl, bob);
    const state = new URL(authorizeUrl).searchParams.get("state") ?? "";

    const res = await request("GET", `/auth/github/callback?code=${code}&state=${state}`, { auth: false });
    expect(res.headers.get("location")).toBe("/?login=failed");
    expect(jar.has("__Host-commenter")).toBe(false);
  });

  it("does not accept the same state twice", async () => {
    const start = await request("GET", "/auth/github/start", { auth: false });
    const authorizeUrl = start.headers.get("location") ?? "";
    const state = new URL(authorizeUrl).searchParams.get("state") ?? "";
    const oauthCookie = `__Host-oauth=${jar.get("__Host-oauth")}`;
    await request("GET", `/auth/github/callback?code=${fakeGitHub.approve(authorizeUrl, alice)}&state=${state}`, { auth: false });

    const replay = await request("GET", `/auth/github/callback?code=${fakeGitHub.approve(authorizeUrl, alice)}&state=${state}`, {
      auth: false,
      useJar: false,
      headers: { cookie: oauthCookie },
    });
    expect(replay.headers.get("location")).toBe("/?login=failed");
  });

  it("reports a cancelled authorization and GitHub failures back to the page", async () => {
    await request("GET", "/auth/github/start?next=%2Fposts%2Fa", { auth: false });
    const state = jar.get("__Host-oauth");
    const cancelled = await request("GET", `/auth/github/callback?error=access_denied&state=${state}`, { auth: false });
    expect(cancelled.headers.get("location")).toBe("/posts/a?login=cancelled");

    const start = await request("GET", "/auth/github/start?next=%2Fposts%2Fa", { auth: false });
    const authorizeUrl = start.headers.get("location") ?? "";
    fakeGitHub.failNextExchange();
    const failed = await request("GET", `/auth/github/callback?code=${fakeGitHub.approve(authorizeUrl, alice)}&state=${jar.get("__Host-oauth")}`, {
      auth: false,
    });
    expect(failed.headers.get("location")).toBe("/posts/a?login=failed");
  });

  it("never redirects off-site after login", async () => {
    const res = await request("GET", "/auth/github/start?next=https%3A%2F%2Fevil.example", { auth: false });
    const authorizeUrl = res.headers.get("location") ?? "";
    const callback = await request("GET", `/auth/github/callback?code=${fakeGitHub.approve(authorizeUrl, alice)}&state=${jar.get("__Host-oauth")}`, {
      auth: false,
    });
    expect(callback.headers.get("location")).toBe("/");
  });

  it("updates the profile on each login (GitHub users can rename themselves)", async () => {
    await loginCommenter(alice);
    const cookie = await loginCommenter({ ...alice, login: "alice-renamed" });
    const me = commenterMeSchema.parse((await request("GET", "/auth/github/me", as(cookie))).body);
    expect(me.commenter?.login).toBe("alice-renamed");
    expect((await request("GET", "/admin/commenters")).body).toHaveLength(1);
  });

  it("logs out", async () => {
    const cookie = await loginCommenter(alice);
    expect((await request("POST", "/auth/github/logout", as(cookie))).status).toBe(204);
    const me = commenterMeSchema.parse((await request("GET", "/auth/github/me", as(cookie))).body);
    expect(me.commenter).toBeNull();
  });

  it("does not let a commenter session reach admin endpoints", async () => {
    const cookie = await loginCommenter(alice);
    expect((await request("GET", "/admin/comments", as(cookie))).status).toBe(401);
  });
});

describe("posting and reading comments", () => {
  it("holds comments from non-whitelisted users for review, visible only to their author", async () => {
    await createPost({ slug: "a", status: "published" });
    const cookie = await loginCommenter(alice);
    const created = await comment("a", cookie, "第一条评论");
    expect(created.status).toBe("pending");

    const own = await list("a", cookie);
    expect(own.threads.map((t) => [t.bodyMd, t.status])).toEqual([["第一条评论", "pending"]]);
    expect(own.count).toBe(0);
    expect(await list("a")).toEqual({ threads: [], count: 0 });
    expect(await list("a", await loginCommenter(bob))).toEqual({ threads: [], count: 0 });
  });

  it("shows comments from whitelisted users right away", async () => {
    await createPost({ slug: "a", status: "published" });
    const cookie = await loginCommenter(alice);
    await trust("alice", "trusted");
    expect((await comment("a", cookie, "白名单")).status).toBe("approved");
    expect((await list("a")).count).toBe(1);
  });

  it("refuses comments from blocked users", async () => {
    await createPost({ slug: "a", status: "published" });
    const cookie = await loginCommenter(alice);
    await trust("alice", "blocked");
    const res = await request("POST", "/posts/a/comments", { ...as(cookie), body: { body: "垃圾" } });
    expect(res.status).toBe(403);
  });

  it("builds two-level threads and marks replies to replies", async () => {
    await createPost({ slug: "a", status: "published" });
    const a = await loginCommenter(alice);
    const b = await loginCommenter(bob);
    await trust("alice", "trusted");
    await trust("bob", "trusted");

    const root = await comment("a", a, "楼主");
    const reply = await comment("a", b, "直接回复楼主", root.id);
    const nested = await comment("a", a, "回复 bob", reply.id);
    expect(reply.replyTo).toBeNull();
    expect(nested.replyTo).toEqual({ login: "bob" });

    const { threads, count } = await list("a");
    expect(count).toBe(3);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.replies.map((r) => [r.bodyMd, r.replyTo?.login ?? null])).toEqual([
      ["直接回复楼主", null],
      ["回复 bob", "bob"],
    ]);
  });

  it("only allows replying to visible comments on the same post", async () => {
    await createPost({ slug: "a", status: "published" });
    await createPost({ slug: "b", status: "published" });
    const a = await loginCommenter(alice);
    const pending = await comment("a", a, "待审核");
    const reply = (parentId: number, slug = "a") => request("POST", `/posts/${slug}/comments`, { ...as(a), body: { body: "回复", parentId } });
    expect((await reply(pending.id)).status).toBe(404);

    await trust("alice", "trusted");
    const approved = await comment("a", a, "已显示");
    expect((await reply(approved.id, "b")).status).toBe(404);
    expect((await reply(approved.id)).status).toBe(201);
  });

  it("hides a whole thread when its first comment is rejected", async () => {
    await createPost({ slug: "a", status: "published" });
    const a = await loginCommenter(alice);
    await trust("alice", "trusted");
    const root = await comment("a", a, "楼主");
    await comment("a", a, "回复", root.id);
    await request("PATCH", `/admin/comments/${root.id}`, { body: { status: "rejected" } });
    expect(await list("a")).toEqual({ threads: [], count: 0 });
  });

  it("requires a GitHub login and validates the body", async () => {
    await createPost({ slug: "a", status: "published" });
    expect((await request("POST", "/posts/a/comments", { ...as(null), body: { body: "匿名" } })).status).toBe(401);
    const cookie = await loginCommenter(alice);
    for (const body of [{ body: "   " }, { body: "x".repeat(5001) }, { body: "ok", extra: 1 }]) {
      expect((await request("POST", "/posts/a/comments", { ...as(cookie), body })).status).toBe(400);
    }
  });

  it("returns 404 for drafts and unknown posts", async () => {
    await createPost({ slug: "draft" });
    const cookie = await loginCommenter(alice);
    expect((await request("GET", "/posts/draft/comments", as(null))).status).toBe(404);
    expect((await request("POST", "/posts/nope/comments", { ...as(cookie), body: { body: "x" } })).status).toBe(404);
  });

  it("is never cached by shared caches", async () => {
    await createPost({ slug: "a", status: "published" });
    expect((await request("GET", "/posts/a/comments", as(null))).headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("moderation", () => {
  const adminList = async (status = "pending") =>
    z.array(adminCommentSchema).parse((await request("GET", `/admin/comments?status=${status}`)).body);

  it("lists the review queue oldest first, with post and reply context", async () => {
    await createPost({ slug: "a", title: "文章 A", status: "published" });
    const a = await loginCommenter(alice);
    const b = await loginCommenter(bob);
    await trust("alice", "trusted");
    const root = await comment("a", a, "**楼主**");
    await comment("a", b, "第一条待审");
    await comment("a", b, "回复楼主", root.id);
    // 引用的上下文是纯文本

    const queue = await adminList();
    expect(queue.map((c) => c.bodyMd)).toEqual(["第一条待审", "回复楼主"]);
    expect(queue[0]?.post).toEqual({ slug: "a", title: "文章 A" });
    expect(queue[1]?.parent).toEqual({ id: root.id, login: "alice", excerpt: "楼主" });
    expect((await request("GET", "/admin/comments/pending-count")).body).toEqual({ count: 2 });
  });

  it("approves and rejects", async () => {
    await createPost({ slug: "a", status: "published" });
    const b = await loginCommenter(bob);
    const first = await comment("a", b, "通过我");
    const second = await comment("a", b, "拒绝我");
    await request("PATCH", `/admin/comments/${first.id}`, { body: { status: "approved" } });
    await request("PATCH", `/admin/comments/${second.id}`, { body: { status: "rejected" } });
    expect((await list("a")).threads.map((t) => t.bodyMd)).toEqual(["通过我"]);
    expect((await adminList("rejected")).map((c) => c.bodyMd)).toEqual(["拒绝我"]);
  });

  it("whitelisting approves the user's pending comments; blocking rejects them", async () => {
    await createPost({ slug: "a", status: "published" });
    const a = await loginCommenter(alice);
    const b = await loginCommenter(bob);
    await comment("a", a, "alice 待审");
    await comment("a", b, "bob 待审");
    await trust("alice", "trusted");
    await trust("bob", "blocked");
    expect((await list("a")).threads.map((t) => t.bodyMd)).toEqual(["alice 待审"]);
    expect((await adminList("rejected")).map((c) => c.bodyMd)).toEqual(["bob 待审"]);
  });

  it("deleting a first comment deletes the whole thread", async () => {
    await createPost({ slug: "a", status: "published" });
    const a = await loginCommenter(alice);
    await trust("alice", "trusted");
    const root = await comment("a", a, "楼主");
    const reply = await comment("a", a, "回复", root.id);
    await comment("a", a, "回复的回复", reply.id);
    expect((await request("DELETE", `/admin/comments/${root.id}`)).status).toBe(204);
    expect((await list("a")).count).toBe(0);
    expect((await request("DELETE", `/admin/comments/${root.id}`)).status).toBe(404);
  });

  it("deleting a reply keeps the replies to it", async () => {
    await createPost({ slug: "a", status: "published" });
    const a = await loginCommenter(alice);
    await trust("alice", "trusted");
    const root = await comment("a", a, "楼主");
    const reply = await comment("a", a, "回复", root.id);
    await comment("a", a, "回复的回复", reply.id);
    await request("DELETE", `/admin/comments/${reply.id}`);
    const [thread] = (await list("a")).threads;
    expect(thread?.replies.map((r) => [r.bodyMd, r.replyTo])).toEqual([["回复的回复", null]]);
  });

  it("adds people to the whitelist by GitHub username before they ever comment", async () => {
    fakeGitHub.directory.set("carol", githubUser(103, "Carol"));
    const res = await request("POST", "/admin/commenters", { body: { login: "carol" } });
    expect(res.status).toBe(201);
    expect(adminCommenterSchema.parse(res.body)).toMatchObject({ login: "Carol", githubId: 103, trust: "trusted" });

    // 之后 carol 第一次登录评论就直接显示
    await createPost({ slug: "a", status: "published" });
    const cookie = await loginCommenter(githubUser(103, "Carol"));
    expect((await comment("a", cookie, "你好")).status).toBe("approved");

    expect((await request("POST", "/admin/commenters", { body: { login: "nobody" } })).status).toBe(404);
    expect((await request("POST", "/admin/commenters", { body: { login: "bad name!" } })).status).toBe(400);
  });
});
