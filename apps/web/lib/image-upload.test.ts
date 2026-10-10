import type { AdminImage, ImageUpload } from "@blog/shared";
import { describe, expect, it, vi } from "vitest";
import { ImageUploadError, uploadImage } from "./image-upload";

const image: AdminImage = { id: 7, url: "https://img.test/images/2026/10/x.png", contentType: "image/png", size: 3, createdAt: "2026-10-10T00:00:00.000Z" };
const ticket: ImageUpload = {
  image,
  upload: { url: "https://s3.test/bucket/x.png?X-Amz-Signature=s", method: "PUT", headers: { "content-type": "image/png" }, expiresAt: "2026-10-10T00:05:00.000Z" },
};

function setup(storageResponse: Response | Error = new Response(null, { status: 200 })) {
  const api = { createImageUpload: vi.fn(async () => ticket), confirmImage: vi.fn(async () => image) };
  const prepared = new Blob(["abc"], { type: "image/png" });
  const prepare = vi.fn(async () => ({ blob: prepared, contentType: "image/png" as const }));
  const fetch = vi.fn<typeof globalThis.fetch>(async () => (storageResponse instanceof Error ? Promise.reject(storageResponse) : storageResponse));
  return { api, prepare, fetch, prepared };
}

describe("uploadImage", () => {
  it("asks for an upload with the prepared size, PUTs to storage with the signed headers, then confirms", async () => {
    const { api, prepare, fetch, prepared } = setup();
    expect(await uploadImage(new Blob(["original"]), { api, prepare, fetch })).toEqual(image);
    expect(api.createImageUpload).toHaveBeenCalledWith({ contentType: "image/png", size: 3 });
    expect(fetch).toHaveBeenCalledWith(ticket.upload.url, { method: "PUT", headers: ticket.upload.headers, body: prepared });
    expect(api.confirmImage).toHaveBeenCalledWith(7);
  });

  it("does not confirm when storage rejects the upload", async () => {
    const { api, prepare, fetch } = setup(new Response(null, { status: 403 }));
    await expect(uploadImage(new Blob(), { api, prepare, fetch })).rejects.toThrow(ImageUploadError);
    expect(api.confirmImage).not.toHaveBeenCalled();
  });

  it("explains network-level failures (CORS, expired URLs)", async () => {
    const { api, prepare, fetch } = setup(new TypeError("Failed to fetch"));
    await expect(uploadImage(new Blob(), { api, prepare, fetch })).rejects.toThrow("无法上传到图片存储");
  });

  it("refuses files still too large after processing, before asking the API", async () => {
    const { api, fetch } = setup();
    const prepare = vi.fn(async () => ({ blob: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), contentType: "image/png" as const }));
    await expect(uploadImage(new Blob(), { api, prepare, fetch })).rejects.toThrow("10MB");
    expect(api.createImageUpload).not.toHaveBeenCalled();
  });
});
