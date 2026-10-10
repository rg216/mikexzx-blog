import { describe, expect, it } from "vitest";
import { githubUser, setupTestApp } from "./helpers.ts";

const { request, createPost, loginCommenter } = setupTestApp({ withRedis: true });

describe("rate limits on auth and admin endpoints", () => {
  it("limits passkey ceremonies per IP", async () => {
    const options = (ip: string) =>
      request("POST", "/auth/authentication/options", { auth: false, headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < 20; i++) expect((await options("203.0.113.5")).status).toBe(200);
    expect((await options("203.0.113.5")).status).toBe(429);
    expect((await options("203.0.113.6")).status).toBe(200);
  });

  it("limits admin writes per user but leaves reads alone", async () => {
    const write = await request("POST", "/admin/posts", { body: { slug: "x", title: "x", contentMd: "x" } });
    expect(write.headers.get("ratelimit-policy")).toBe('"admin-write";q=120;w=60');
    const read = await request("GET", "/admin/posts");
    expect(read.headers.get("ratelimit-policy")).toBeNull();
  });
});

describe("rate limit on search", () => {
  it("limits searches per IP", async () => {
    const search = (ip: string) => request("GET", "/search?q=test", { auth: false, headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < 60; i++) expect((await search("203.0.113.7")).status).toBe(200);
    expect((await search("203.0.113.7")).status).toBe(429);
    expect((await search("203.0.113.8")).status).toBe(200);
  });
});

describe("rate limit on comments", () => {
  it("limits each commenter to 10 comments per 10 minutes", async () => {
    await createPost({ slug: "a", status: "published" });
    const cookie = await loginCommenter(githubUser(1, "spammer"));
    const post = () => request("POST", "/posts/a/comments", { auth: false, useJar: false, headers: { cookie }, body: { body: "hi" } });
    for (let i = 0; i < 10; i++) expect((await post()).status).toBe(201);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("ratelimit-policy")).toBe('"comment";q=10;w=600');
  });
});

