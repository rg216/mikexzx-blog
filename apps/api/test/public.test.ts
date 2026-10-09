import { postSchema, postSummaryPageSchema, tagWithCountSchema } from "@blog/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { setupTestApp } from "./helpers.ts";

const { request, createPost } = setupTestApp();

describe("GET /posts", () => {
  it("lists only published posts, newest first, matching the shared schema", async () => {
    await createPost({ slug: "old", status: "published", publishedAt: "2026-01-01T00:00:00Z" });
    await createPost({ slug: "draft", status: "draft" });
    await createPost({ slug: "new", status: "published", publishedAt: "2026-02-01T00:00:00Z" });

    const res = await request("GET", "/posts", { token: null });
    expect(res.status).toBe(200);
    const page = postSummaryPageSchema.parse(res.body);
    expect(page.items.map((p) => p.slug)).toEqual(["new", "old"]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).not.toHaveProperty("contentMd");
  });

  it("paginates with a cursor without skipping or repeating posts", async () => {
    // 两篇发布时间相同：验证游标用 id 打破平局
    for (const [slug, publishedAt] of [
      ["a", "2026-01-05T00:00:00Z"],
      ["b", "2026-01-04T00:00:00Z"],
      ["c", "2026-01-04T00:00:00Z"],
      ["d", "2026-01-02T00:00:00Z"],
      ["e", "2026-01-01T00:00:00Z"],
    ] as const) {
      await createPost({ slug, status: "published", publishedAt });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `?limit=2&cursor=${cursor}` : "?limit=2";
      const page = postSummaryPageSchema.parse((await request("GET", `/posts${query}`, { token: null })).body);
      seen.push(...page.items.map((p) => p.slug));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual(["a", "c", "b", "d", "e"]);
  });

  it.each([["?limit=0"], ["?limit=51"], ["?limit=abc"], ["?cursor=not-a-cursor"]])("rejects %s with 400", async (query) => {
    const res = await request("GET", `/posts${query}`, { token: null });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "validation_error" } });
  });
});

describe("GET /posts/:slug", () => {
  it("returns a published post with content and tags in author order", async () => {
    await createPost({
      slug: "hello",
      status: "published",
      contentMd: "第一段。\n\n第二段。",
      tags: [
        { slug: "zeta", name: "Z" },
        { slug: "alpha", name: "A" },
      ],
    });

    const res = await request("GET", "/posts/hello", { token: null });
    expect(res.status).toBe(200);
    const post = postSchema.parse(res.body);
    expect(post.contentMd).toBe("第一段。\n\n第二段。");
    expect(post.excerpt).toBe("第一段。第二段。");
    expect(post.tags.map((t) => t.slug)).toEqual(["zeta", "alpha"]);
  });

  it.each([
    ["a draft", "secret"],
    ["an unknown slug", "nope"],
    ["an invalid slug", "Not_A_Slug"],
  ])("returns 404 for %s", async (_name, slug) => {
    await createPost({ slug: "secret", status: "draft" });
    const res = await request("GET", `/posts/${slug}`, { token: null });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "not_found" } });
  });
});

describe("GET /tags", () => {
  it("counts published posts per tag, ignoring drafts", async () => {
    const fullstack = { slug: "fullstack", name: "全栈" };
    const design = { slug: "design", name: "设计" };
    await createPost({ slug: "p1", status: "published", tags: [fullstack, design] });
    await createPost({ slug: "p2", status: "published", tags: [fullstack] });
    await createPost({ slug: "d1", status: "draft", tags: [fullstack, { slug: "secret", name: "秘密" }] });

    const res = await request("GET", "/tags", { token: null });
    expect(z.array(tagWithCountSchema).parse(res.body)).toEqual([
      { ...fullstack, count: 2 },
      { ...design, count: 1 },
    ]);
  });
});

describe("misc", () => {
  it("returns a JSON 404 for unknown routes", async () => {
    const res = await request("GET", "/nope", { token: null });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "not_found" } });
  });

  it("sets security headers", async () => {
    const res = await request("GET", "/health", { token: null });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
