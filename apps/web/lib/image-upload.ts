import { type AdminImage, MAX_IMAGE_BYTES } from "@blog/shared";
import { type AdminApi, adminApi } from "./admin-api";
import { prepareImage } from "./image-prepare";

type Deps = {
  api?: Pick<AdminApi, "createImageUpload" | "confirmImage">;
  prepare?: typeof prepareImage;
  fetch?: typeof fetch;
};

export class ImageUploadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ImageUploadError";
  }
}

/**
 * 上传一张图片的完整流程：
 *   1. 浏览器里缩放、去元数据（prepareImage）
 *   2. 向 API 申请上传：API 记一笔待确认的图片，返回只能上传这个类型和大小的预签名 URL
 *   3. 浏览器直接 PUT 到对象存储（不经过 API 和 /api 代理）
 *   4. 请 API 核对存储里的文件并确认
 * 任何一步失败都抛错；没确认的图片由 API 的定时任务清理，这里不用善后。
 */
export async function uploadImage(file: Blob, { api = adminApi, prepare = prepareImage, fetch: fetchImpl = (...args) => fetch(...args) }: Deps = {}): Promise<AdminImage> {
  const { blob, contentType } = await prepare(file);
  if (blob.size > MAX_IMAGE_BYTES) throw new ImageUploadError("图片处理后仍超过 10MB，请先压缩");

  const { image, upload } = await api.createImageUpload({ contentType, size: blob.size });

  let res: Response;
  try {
    res = await fetchImpl(upload.url, { method: upload.method, headers: upload.headers, body: blob });
  } catch (error) {
    // 跨域请求失败（CORS 没配好、URL 过期时存储返回的 403 也不带 CORS 头）在浏览器里都表现为网络错误
    throw new ImageUploadError("无法上传到图片存储，请检查网络后重试", { cause: error });
  }
  if (!res.ok) throw new ImageUploadError(`图片存储拒绝了上传（HTTP ${res.status}），请重试`);

  return api.confirmImage(image.id);
}
