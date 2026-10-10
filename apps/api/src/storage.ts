import { type Credentials, presignUrl, signRequest, uriEncodePath } from "./lib/sigv4.ts";

/*
 * 对象存储客户端（S3 协议）：线上是 Cloudflare R2，本地是 Docker 里的 S3 兼容服务。
 * 只实现用到的三个操作：签发上传 URL、查询对象（HEAD）、删除对象。
 * 一律用路径风格地址（endpoint/bucket/key）：R2 和本地服务都支持，本地也不用给 bucket 配子域名。
 */

export type StorageConfig = {
  /** S3 API 地址，如 https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  /** R2 固定用 "auto" */
  region: string;
  bucket: string;
  credentials: Credentials;
  /** 对象的公开访问地址前缀（R2 的自定义域名或 r2.dev 地址），图片 URL = publicUrl/key */
  publicUrl: string;
};

export type ObjectInfo = { size: number; contentType: string | null };

export class StorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageError";
  }
}

const TIMEOUT_MS = 5000;

export function createObjectStorage(config: StorageConfig, fetchImpl: typeof fetch = fetch) {
  const endpoint = config.endpoint.replace(/\/+$/, "");
  const publicBase = config.publicUrl.replace(/\/+$/, "");
  const objectUrl = (key: string) => new URL(`${endpoint}/${config.bucket}/${uriEncodePath(key)}`);

  async function send(method: "HEAD" | "DELETE", key: string): Promise<Response> {
    const url = objectUrl(key);
    const headers = signRequest({ method, url, region: config.region, credentials: config.credentials });
    try {
      return await fetchImpl(url, { method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new StorageError(`${method} ${key} failed`, { cause: error });
    }
  }

  return {
    publicUrl(key: string): string {
      return `${publicBase}/${uriEncodePath(key)}`;
    },

    /**
     * 签发上传 URL。类型、大小、缓存策略都签进去：浏览器必须带上完全相同的头，
     * 换成别的类型或别的大小，存储服务会因签名不匹配而拒绝。
     * 返回的 headers 是浏览器要设置的；content-length 不在里面——浏览器按请求体自动设置，也不允许手动设置。
     */
    presignPut(key: string, { contentType, size, expiresIn }: { contentType: string; size: number; expiresIn: number }) {
      const headers = {
        "content-type": contentType,
        // key 带随机串、内容永不改变，可以让浏览器和 CDN 缓存一年
        "cache-control": "public, max-age=31536000, immutable",
      };
      const url = presignUrl({
        method: "PUT",
        url: objectUrl(key),
        region: config.region,
        credentials: config.credentials,
        expiresIn,
        headers: { ...headers, "content-length": String(size) },
      });
      return { url, headers };
    },

    /** 对象的大小和类型；不存在返回 null */
    async head(key: string): Promise<ObjectInfo | null> {
      const res = await send("HEAD", key);
      if (res.status === 404) return null;
      if (!res.ok) throw new StorageError(`HEAD ${key}: HTTP ${res.status}`);
      return { size: Number(res.headers.get("content-length")), contentType: res.headers.get("content-type") };
    },

    /** 删除对象；本来就不存在也算成功（S3 协议的 DELETE 本身就是幂等的） */
    async delete(key: string): Promise<void> {
      const res = await send("DELETE", key);
      if (!res.ok && res.status !== 404) throw new StorageError(`DELETE ${key}: HTTP ${res.status}`);
    },
  };
}

export type ObjectStorage = ReturnType<typeof createObjectStorage>;
