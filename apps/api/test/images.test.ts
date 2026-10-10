import { adminImageSchema, imageUploadSchema, MAX_IMAGE_BYTES } from "@blog/shared";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { images } from "../src/db/schema.ts";
import { CRON_SECRET, setupTestApp } from "./helpers.ts";

const { db, request, storage } = setupTestApp({ withStorage: true });

const png = (size: number) => new Uint8Array(size).fill(0x89);

async function requestUpload(body: unknown = { contentType: "image/png", size: 100 }) {
  const res = await request("POST", "/admin/images", { body });
  expect(res.status).toBe(201);
  return imageUploadSchema.parse(res.body);
}

/** 像浏览器一样把文件 PUT 到预签名 URL（Node 的 fetch 会按请求体自动设置 Content-Length） */
function putFile(upload: { url: string; headers: Record<string, string> }, body: Uint8Array, headers: Record<string, string> = {}) {
  return fetch(upload.url, { method: "PUT", headers: { ...upload.headers, ...headers }, body });
}

const keyOf = async (id: number) => (await db.select({ key: images.key }).from(images).where(eq(images.id, id)))[0]?.key ?? "";

describe("image uploads", () => {
  it("uploads straight to storage with a presigned URL, then confirms", async () => {
    const { image, upload } = await requestUpload();
    expect(upload.method).toBe("PUT");
    expect(upload.headers).toEqual({ "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" });
    // key 带月份目录和不可猜的随机串
    expect(await keyOf(image.id)).toMatch(/^images\/\d{4}\/\d{2}\/[\w-]{16}\.png$/);

    expect((await putFile(upload, png(100))).status).toBe(200);
    const confirmed = await request("POST", `/admin/images/${image.id}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(adminImageSchema.parse(confirmed.body).url).toBe(image.url);

    // 公开地址无需签名即可访问，并带着长期缓存头
    const res = await fetch(image.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it("presigned URLs only accept the declared size, type and headers", async () => {
    const { upload } = await requestUpload();
    expect((await putFile(upload, png(101))).status).toBe(403);
    expect((await putFile(upload, png(100), { "content-type": "text/html" })).status).toBe(403);
    expect((await putFile(upload, png(100), { "cache-control": "no-store" })).status).toBe(403);
  });

  it("refuses to confirm before the file is uploaded", async () => {
    const { image } = await requestUpload();
    const res = await request("POST", `/admin/images/${image.id}/confirm`);
    expect(res.status).toBe(409);
    const [row] = await db.select().from(images).where(eq(images.id, image.id));
    expect(row?.confirmedAt).toBeNull();
  });

  it("deletes the file and the record when the stored object does not match", async () => {
    if (!storage) throw new Error("storage not configured");
    const { image } = await requestUpload({ contentType: "image/png", size: 100 });
    const key = await keyOf(image.id);
    // 绕过 API 的 URL，直接往同一个 key 传一个大小不同的文件（模拟签名之外的漏洞）
    const forged = storage.presignPut(key, { contentType: "image/png", size: 50, expiresIn: 60 });
    expect((await putFile(forged, png(50))).status).toBe(200);

    const res = await request("POST", `/admin/images/${image.id}/confirm`);
    expect(res.status).toBe(400);
    expect(await storage.head(key)).toBeNull();
    expect(await db.select().from(images).where(eq(images.id, image.id))).toEqual([]);
  });

  it("confirming twice is harmless", async () => {
    const { image, upload } = await requestUpload();
    await putFile(upload, png(100));
    const first = await request("POST", `/admin/images/${image.id}/confirm`);
    const second = await request("POST", `/admin/images/${image.id}/confirm`);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("returns 404 for unknown images", async () => {
    expect((await request("POST", "/admin/images/999/confirm")).status).toBe(404);
  });

  it.each([
    [{ contentType: "image/svg+xml", size: 100 }, "SVG can carry scripts"],
    [{ contentType: "image/png", size: MAX_IMAGE_BYTES + 1 }, "too large"],
    [{ contentType: "image/png", size: 0 }, "empty"],
    [{ contentType: "image/png", size: 100, key: "images/evil.png" }, "client-chosen key"],
  ])("rejects %j (%s)", async (body, _reason) => {
    expect((await request("POST", "/admin/images", { body })).status).toBe(400);
  });

  it("requires a session", async () => {
    expect((await request("POST", "/admin/images", { auth: false, body: { contentType: "image/png", size: 1 } })).status).toBe(401);
  });
});

describe("GET /internal/images/cleanup", () => {
  const cleanup = () => request("GET", "/internal/images/cleanup", { auth: false, headers: { authorization: `Bearer ${CRON_SECRET}` } });

  it("removes abandoned uploads older than a day, file included, and keeps the rest", async () => {
    if (!storage) throw new Error("storage not configured");
    const abandoned = await requestUpload();
    await putFile(abandoned.upload, png(100)); // 传了但没确认
    const recent = await requestUpload();
    const confirmed = await requestUpload();
    await putFile(confirmed.upload, png(100));
    await request("POST", `/admin/images/${confirmed.image.id}/confirm`);

    const twoDaysAgo = sql`now() - interval '2 days'`;
    for (const id of [abandoned.image.id, confirmed.image.id]) {
      await db.update(images).set({ createdAt: twoDaysAgo }).where(eq(images.id, id));
    }
    const abandonedKey = await keyOf(abandoned.image.id);

    const res = await cleanup();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
    expect(await storage.head(abandonedKey)).toBeNull();
    const remaining = await db.select({ id: images.id }).from(images);
    expect(remaining.map((r) => r.id).sort()).toEqual([recent.image.id, confirmed.image.id].sort());
  });

  it("requires the cron secret", async () => {
    expect((await request("GET", "/internal/images/cleanup", { auth: false })).status).toBe(401);
  });
});
