import { adminImageDetailSchema, adminImageSchema, imageUploadSchema, mediaFolderSchema, postSchema } from "@blog/shared";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { images } from "../src/db/schema.ts";
import { variantKey } from "../src/services/images.ts";
import { PNG_37x23 } from "./fixtures.ts";
import { CRON_SECRET, setupTestApp } from "./helpers.ts";

const { db, request, storage, createPost } = setupTestApp({ withStorage: true });

const put = (upload: { url: string; headers: Record<string, string> }, body: Uint8Array) =>
  fetch(upload.url, { method: "PUT", headers: upload.headers, body });

/** 走完整的上传流程：申请 → PUT 原图和各尺寸版本 → 确认 */
async function upload({ filename = "photo.png", variants = [] as number[], folderId = null as number | null } = {}) {
  const variantBody = new Uint8Array(10).fill(1);
  const res = await request("POST", "/admin/images", {
    body: { contentType: "image/png", size: PNG_37x23.length, filename, variants: variants.map((width) => ({ width, size: variantBody.length })), folderId },
  });
  expect(res.status).toBe(201);
  const ticket = imageUploadSchema.parse(res.body);
  expect((await put(ticket.upload, PNG_37x23)).status).toBe(200);
  for (const variant of ticket.variants) expect((await put(variant, variantBody)).status).toBe(200);
  const confirmed = await request("POST", `/admin/images/${ticket.image.id}/confirm`);
  expect(confirmed.status).toBe(200);
  return adminImageSchema.parse(confirmed.body);
}

const list = async (query = "") => z.array(adminImageSchema).parse((await request("GET", `/admin/images${query}`)).body);
const detail = async (id: number) => adminImageDetailSchema.parse((await request("GET", `/admin/images/${id}`)).body);
const keyOf = async (id: number) => (await db.select({ key: images.key }).from(images).where(eq(images.id, id)))[0]?.key ?? "";

describe("uploading", () => {
  it("reads the real dimensions from the file instead of trusting the browser", async () => {
    const image = await upload();
    expect(image).toMatchObject({ width: 37, height: 23, filename: "photo.png", variants: [], usage: 0 });
  });

  it("uploads smaller variants next to the original", async () => {
    const image = await upload({ variants: [640, 1280] });
    expect(image.variants).toEqual([640, 1280]);
    const key = await keyOf(image.id);
    expect(await storage?.head(variantKey(key, 640))).toMatchObject({ size: 10 });
  });

  it("rejects the upload when a variant is missing", async () => {
    const res = await request("POST", "/admin/images", {
      body: { contentType: "image/png", size: PNG_37x23.length, variants: [{ width: 640, size: 10 }] },
    });
    const ticket = imageUploadSchema.parse(res.body);
    await put(ticket.upload, PNG_37x23);
    const key = await keyOf(ticket.image.id);
    expect((await request("POST", `/admin/images/${ticket.image.id}/confirm`)).status).toBe(400);
    expect(await storage?.head(key)).toBeNull();
  });

  it.each([
    [[{ width: 500, size: 10 }], "an arbitrary width"],
    [[{ width: 640, size: 10 }, { width: 640, size: 10 }], "duplicate widths"],
  ])("rejects variants with %j (%s)", async (variants, _reason) => {
    const res = await request("POST", "/admin/images", { body: { contentType: "image/png", size: 100, variants } });
    expect(res.status).toBe(400);
  });
});

describe("library", () => {
  it("filters by folder, searches names and descriptions, and finds unused images", async () => {
    const folder = mediaFolderSchema.parse((await request("POST", "/admin/media-folders", { body: { name: "截图" } })).body);
    const shot = await upload({ filename: "settings-screenshot.png", folderId: folder.id });
    const photo = await upload({ filename: "IMG_0001.png" });
    await request("PATCH", `/admin/images/${photo.id}`, { body: { description: "日落时的海边" } });
    await createPost({ slug: "a", contentMd: `![](${shot.url})` });

    expect((await list()).map((i) => i.id)).toEqual([photo.id, shot.id]);
    expect((await list(`?folder=${folder.id}`)).map((i) => i.id)).toEqual([shot.id]);
    expect((await list("?folder=none")).map((i) => i.id)).toEqual([photo.id]);
    expect((await list("?q=SCREENSHOT")).map((i) => i.id)).toEqual([shot.id]);
    expect((await list(`?q=${encodeURIComponent("海边")}`)).map((i) => i.id)).toEqual([photo.id]);
    expect((await list("?unused=1")).map((i) => i.id)).toEqual([photo.id]);
    expect((await list()).find((i) => i.id === shot.id)?.usage).toBe(1);
    // LIKE 的通配符按字面匹配
    expect(await list("?q=%25")).toEqual([]);
  });

  it("moves images between folders; deleting a folder keeps its images", async () => {
    const folder = mediaFolderSchema.parse((await request("POST", "/admin/media-folders", { body: { name: "旅行" } })).body);
    const a = await upload();
    const b = await upload();
    expect((await request("POST", "/admin/images/move", { body: { ids: [a.id, b.id], folderId: folder.id } })).body).toEqual({ moved: 2 });
    expect(z.array(mediaFolderSchema).parse((await request("GET", "/admin/media-folders")).body)).toEqual([{ id: folder.id, name: "旅行", imageCount: 2 }]);

    await request("DELETE", `/admin/media-folders/${folder.id}`);
    expect((await list("?folder=none")).map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("refuses duplicate folder names and moving into a missing folder", async () => {
    await request("POST", "/admin/media-folders", { body: { name: "截图" } });
    expect((await request("POST", "/admin/media-folders", { body: { name: "截图" } })).status).toBe(409);
    const image = await upload();
    expect((await request("POST", "/admin/images/move", { body: { ids: [image.id], folderId: 999 } })).status).toBe(404);
  });
});

describe("references from posts", () => {
  it("tracks which posts use an image, from the post content, whatever host or size the URL uses", async () => {
    const image = await upload({ variants: [640] });
    const otherHost = image.url.replace(/^https?:\/\/[^/]+\/[^/]+/, "https://img.example.com");
    const post = await createPost({ slug: "a", title: "用了图的文章", contentMd: `![](${image.url}#small)\n\n![](${otherHost.replace(".png", "-640w.png")})` });
    expect((await detail(image.id)).posts.map((p) => p.title)).toEqual(["用了图的文章"]);

    await request("PATCH", `/admin/posts/${post.id}`, { body: { contentMd: "图删掉了" } });
    expect((await detail(image.id)).usage).toBe(0);

    await request("PATCH", `/admin/posts/${post.id}`, { body: { contentMd: `![](${image.url})` } });
    await request("DELETE", `/admin/posts/${post.id}`);
    expect((await detail(image.id)).usage).toBe(0);
  });

  it("gives published posts the dimensions and variants of their images", async () => {
    const image = await upload({ variants: [640] });
    await createPost({ slug: "a", status: "published", contentMd: `![](${image.url})` });
    const post = postSchema.parse((await request("GET", "/posts/a", { auth: false })).body);
    expect(post.images).toEqual({ [await keyOf(image.id)]: { width: 37, height: 23, variants: [640] } });
  });
});

describe("deleting", () => {
  it("asks for confirmation before deleting images that posts still use", async () => {
    const image = await upload({ variants: [640] });
    await createPost({ slug: "a", title: "引用它的文章", contentMd: `![](${image.url})` });

    const refused = await request("POST", "/admin/images/delete", { body: { ids: [image.id] } });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain("引用它的文章");

    const key = await keyOf(image.id);
    expect((await request("POST", "/admin/images/delete", { body: { ids: [image.id], force: true } })).body).toEqual({ deleted: 1 });
    expect(await storage?.head(key)).toBeNull();
    expect(await storage?.head(variantKey(key, 640))).toBeNull();
    expect(await list()).toEqual([]);
  });

  it("deletes several unused images at once", async () => {
    const a = await upload();
    const b = await upload();
    expect((await request("POST", "/admin/images/delete", { body: { ids: [a.id, b.id] } })).body).toEqual({ deleted: 2 });
  });
});

describe("daily maintenance", () => {
  it("fills in missing dimensions of older images", async () => {
    const image = await upload();
    await db.update(images).set({ width: null, height: null }).where(eq(images.id, image.id));
    const res = await request("GET", "/internal/images/cleanup", { auth: false, headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(res.body).toEqual({ deleted: 0, dimensionsFilled: 1 });
    expect((await detail(image.id)).width).toBe(37);
  });

  it("removes the variants of abandoned uploads too", async () => {
    const res = await request("POST", "/admin/images", { body: { contentType: "image/png", size: PNG_37x23.length, variants: [{ width: 640, size: 10 }] } });
    const ticket = imageUploadSchema.parse(res.body);
    await put(ticket.upload, PNG_37x23);
    await put(ticket.variants[0] ?? ticket.upload, new Uint8Array(10).fill(1));
    await db.update(images).set({ createdAt: sql`now() - interval '2 days'` }).where(eq(images.id, ticket.image.id));
    const key = await keyOf(ticket.image.id);

    await request("GET", "/internal/images/cleanup", { auth: false, headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(await storage?.head(variantKey(key, 640))).toBeNull();
  });
});
