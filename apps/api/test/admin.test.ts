import { adminPostSchema } from "@blog/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { setupTestApp, WEB_ORIGIN } from "./helpers.ts";

const { app, request, createPost, adminSessionCookie, revalidations } = setupTestApp();

describe("authentication", () => {
  it("rejects requests without a session", async () => {
    const res = await request("GET", "/admin/posts", { auth: false });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("rejects an unknown session cookie", async () => {
    const res = await request("GET", "/admin/posts", { auth: false, headers: { cookie: "__Host-session=forged" } });
    expect(res.status).toBe(401);
  });

  it("rejects writes without a session before touching the database", async () => {
    const res = await request("POST", "/admin/posts", { auth: false, body: { slug: "x", title: "x", contentMd: "" } });
    expect(res.status).toBe(401);
    expect((await request("GET", "/admin/posts")).body).toEqual([]);
  });

  it.each([
    ["no Origin header", null],
    ["a cross-site Origin", "https://evil.example"],
  ])("rejects writes with %s (CSRF)", async (_name, origin) => {
    const res = await request("POST", "/admin/posts", { origin, body: { slug: "x", title: "x", contentMd: "" } });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "forbidden" } });
    expect((await request("GET", "/admin/posts")).body).toEqual([]);
  });
});

describe("POST /admin/posts", () => {
  it("creates a draft by default and returns it with id, excerpt and Location", async () => {
    const res = await request("POST", "/admin/posts", {
      body: { slug: "hello", title: "  你好  ", contentMd: "# 标题\n\n正文第一段。" },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe("/admin/posts/1");
    const post = adminPostSchema.parse(res.body);
    expect(post).toMatchObject({ id: 1, title: "你好", status: "draft", publishedAt: null, excerpt: "正文第一段。", tags: [] });
  });

  it("sets publishedAt to now when created as published", async () => {
    const before = Date.now();
    const post = await createPost({ slug: "now", status: "published" });
    expect(Date.parse(post.publishedAt ?? "")).toBeGreaterThanOrEqual(before - 1000);
  });

  it("keeps an explicit publishedAt (importing old posts)", async () => {
    const post = await createPost({ slug: "old", status: "published", publishedAt: "2020-05-01T08:00:00+08:00" });
    expect(post.publishedAt).toBe("2020-05-01T00:00:00.000Z");
  });

  it("returns field-level validation errors", async () => {
    const res = await request("POST", "/admin/posts", {
      body: { slug: "Bad Slug", title: "", contentMd: "x", extra: true },
    });
    expect(res.status).toBe(400);
    const paths = (res.body as { error: { issues: { path: string }[] } }).error.issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["slug", "title"]));
    // strictObject：未知字段也会报错
    expect(JSON.stringify(res.body)).toContain("extra");
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await fetchRaw("POST", "/admin/posts", "{not json");
    expect(res.status).toBe(400);
  });

  it("returns 409 for a duplicate slug", async () => {
    await createPost({ slug: "taken" });
    const res = await request("POST", "/admin/posts", { body: { slug: "taken", title: "x", contentMd: "x" } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: "conflict" } });
  });

  it("upserts tags by slug and de-duplicates them within a post", async () => {
    await createPost({ slug: "p1", tags: [{ slug: "css", name: "css" }] });
    const res = await request("POST", "/admin/posts", {
      body: {
        slug: "p2",
        title: "p2",
        contentMd: "x",
        tags: [
          { slug: "css", name: "CSS" },
          { slug: "css", name: "duplicate" },
        ],
      },
    });
    expect(adminPostSchema.parse(res.body).tags).toEqual([{ slug: "css", name: "CSS" }]);
    // 同一个标签，名称以最新一次写入为准
    const first = adminPostSchema.parse((await request("GET", "/admin/posts/1")).body);
    expect(first.tags).toEqual([{ slug: "css", name: "CSS" }]);
  });
});

describe("PATCH /admin/posts/:id", () => {
  it("updates only the given fields and refreshes excerpt and updatedAt", async () => {
    const created = adminPostSchema.parse(
      (await request("POST", "/admin/posts", { body: { slug: "p", title: "旧标题", contentMd: "旧正文。" } })).body,
    );
    const res = await request("PATCH", `/admin/posts/${created.id}`, { body: { contentMd: "新正文。" } });
    const updated = adminPostSchema.parse(res.body);
    expect(updated).toMatchObject({ title: "旧标题", contentMd: "新正文。", excerpt: "新正文。", status: "draft" });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
  });

  it("sets publishedAt on first publish and keeps it when unpublished and republished", async () => {
    const { id } = await createPost({ slug: "p" });
    const published = adminPostSchema.parse((await request("PATCH", `/admin/posts/${id}`, { body: { status: "published" } })).body);
    expect(published.publishedAt).not.toBeNull();

    await request("PATCH", `/admin/posts/${id}`, { body: { status: "draft" } });
    const republished = adminPostSchema.parse(
      (await request("PATCH", `/admin/posts/${id}`, { body: { status: "published" } })).body,
    );
    expect(republished.publishedAt).toBe(published.publishedAt);
  });

  it("replaces tags when given, keeps them when omitted", async () => {
    const { id } = await createPost({ slug: "p", tags: [{ slug: "a", name: "A" }] });
    await request("PATCH", `/admin/posts/${id}`, { body: { title: "t" } });
    expect(adminPostSchema.parse((await request("GET", `/admin/posts/${id}`)).body).tags).toEqual([{ slug: "a", name: "A" }]);

    const res = await request("PATCH", `/admin/posts/${id}`, { body: { tags: [{ slug: "b", name: "B" }] } });
    expect(adminPostSchema.parse(res.body).tags).toEqual([{ slug: "b", name: "B" }]);
  });

  it("rejects clearing publishedAt on a published post (database CHECK constraint)", async () => {
    const { id } = await createPost({ slug: "p", status: "published" });
    const res = await request("PATCH", `/admin/posts/${id}`, { body: { publishedAt: null } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "validation_error" } });
  });

  it.each([
    ["an empty body", {}, 400],
    ["an unknown field", { nope: 1 }, 400],
  ])("rejects %s", async (_name, body, status) => {
    const { id } = await createPost({ slug: "p" });
    expect((await request("PATCH", `/admin/posts/${id}`, { body })).status).toBe(status);
  });

  it("returns 409 when renaming to an existing slug", async () => {
    await createPost({ slug: "taken" });
    const { id } = await createPost({ slug: "mine" });
    expect((await request("PATCH", `/admin/posts/${id}`, { body: { slug: "taken" } })).status).toBe(409);
  });

  it("returns 404 for a missing post", async () => {
    expect((await request("PATCH", "/admin/posts/999", { body: { title: "x" } })).status).toBe(404);
  });
});

describe("GET / DELETE /admin/posts/:id", () => {
  it("lists all posts including drafts", async () => {
    await createPost({ slug: "draft" });
    await createPost({ slug: "live", status: "published" });
    const list = z.array(adminPostSchema).parse((await request("GET", "/admin/posts")).body);
    expect(list.map((p) => p.slug).sort()).toEqual(["draft", "live"]);
  });

  it("deletes a post and its tag links, then 404s", async () => {
    const { id } = await createPost({ slug: "p", status: "published", tags: [{ slug: "a", name: "A" }] });
    const res = await request("DELETE", `/admin/posts/${id}`);
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect((await request("GET", `/admin/posts/${id}`)).status).toBe(404);
    expect((await request("DELETE", `/admin/posts/${id}`)).status).toBe(404);
    expect((await request("GET", "/tags", { auth: false })).body).toEqual([]);
  });

  it.each([["abc"], ["0"], ["-1"], ["1.5"], ["99999999999"]])("rejects id %s with 400", async (id) => {
    expect((await request("GET", `/admin/posts/${id}`)).status).toBe(400);
  });
});

/** 发送原始请求体（用来测试畸形 JSON，request() 会自动 JSON.stringify） */
async function fetchRaw(method: string, path: string, rawBody: string) {
  return app.request(path, {
    method,
    headers: { cookie: await adminSessionCookie(), origin: WEB_ORIGIN, "content-type": "application/json" },
    body: rawBody,
  });
}

describe("revalidating the public site", () => {
  it("does not notify for draft-only changes", async () => {
    const { id } = await createPost({ slug: "draft" });
    await request("PATCH", `/admin/posts/${id}`, { body: { title: "still a draft" } });
    await request("DELETE", `/admin/posts/${id}`);
    expect(revalidations).toEqual([]);
  });

  it("notifies when a post is published, edited, renamed, unpublished and deleted", async () => {
    const { id } = await createPost({ slug: "a" });
    await request("PATCH", `/admin/posts/${id}`, { body: { status: "published" } });
    await request("PATCH", `/admin/posts/${id}`, { body: { title: "edited" } });
    await request("PATCH", `/admin/posts/${id}`, { body: { slug: "b" } });
    await request("PATCH", `/admin/posts/${id}`, { body: { status: "draft" } });
    await request("PATCH", `/admin/posts/${id}`, { body: { status: "published" } });
    await request("DELETE", `/admin/posts/${id}`);

    expect(revalidations).toEqual([
      ["posts", "post:a"], // 发布
      ["posts", "post:a"], // 编辑已发布的文章
      ["posts", "post:a", "post:b"], // 改 slug：旧地址也要失效（变成 404）
      ["posts", "post:b"], // 撤回为草稿
      ["posts", "post:b"], // 重新发布
      ["posts", "post:b"], // 删除
    ]);
  });

  it("notifies when a post is created as published", async () => {
    await createPost({ slug: "live", status: "published" });
    expect(revalidations).toEqual([["posts", "post:live"]]);
  });

  it("does not notify when the write fails", async () => {
    await createPost({ slug: "taken", status: "published" });
    revalidations.length = 0;
    await request("POST", "/admin/posts", { body: { slug: "taken", title: "x", contentMd: "x", status: "published" } });
    await request("PATCH", "/admin/posts/999", { body: { title: "x" } });
    expect(revalidations).toEqual([]);
  });
});
