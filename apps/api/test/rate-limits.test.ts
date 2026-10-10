import { describe, expect, it } from "vitest";
import { setupTestApp } from "./helpers.ts";

const { request } = setupTestApp({ withRedis: true });

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
