import { createHash, createHmac } from "node:crypto";

/*
 * AWS Signature Version 4（S3 协议的请求签名），R2 / 本地 S3 服务都用它。
 * 没用 AWS SDK：我们只需要"签名一个 URL / 一个请求"，SDK 为此要拉进几十个包；
 * 签名算法本身是公开规范，加上官方文档的测试向量，自己实现也能验证正确性。
 * 规范：https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html
 */

export type Credentials = { accessKeyId: string; secretAccessKey: string };

type SignTarget = {
  method: string;
  /** 完整 URL；路径必须已按 uriEncodePath 编码 */
  url: URL;
  region: string;
  credentials: Credentials;
  now?: Date;
};

/** 空请求体的 SHA-256（HEAD、DELETE 用） */
export const EMPTY_PAYLOAD_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
/** 预签名 URL 不签请求体：签名时还不知道浏览器会上传什么内容（大小和类型另外用签名的请求头约束） */
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
const ALGORITHM = "AWS4-HMAC-SHA256";

const sha256Hex = (data: string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 编码：encodeURIComponent 不编码 !'()*，而 SigV4 要求编码 */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 对象 key 用作路径：每段分别编码，保留 "/" */
export function uriEncodePath(key: string): string {
  return key.split("/").map(uriEncode).join("/");
}

/** 20130524T000000Z 与 20130524 */
function timestamps(now: Date) {
  const dateTime = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { dateTime, date: dateTime.slice(0, 8) };
}

/** 规范查询串：键值分别编码，按编码后的键排序（同键再按值） */
function canonicalQuery(params: [string, string][]): string {
  return params
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

function sign(target: SignTarget, query: [string, string][], headers: Record<string, string>, payloadHash: string, dateTime: string, date: string) {
  const scope = `${date}/${target.region}/s3/aws4_request`;
  // 头名小写、值去掉首尾空白并合并连续空白，按名字排序
  const normalized = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const signedHeaders = normalized.map(([name]) => name).join(";");

  const canonicalRequest = [
    target.method,
    target.url.pathname,
    canonicalQuery(query),
    normalized.map(([name, value]) => `${name}:${value}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [ALGORITHM, dateTime, scope, sha256Hex(canonicalRequest)].join("\n");

  // 派生签名密钥：密钥只对这一天、这个区域、这个服务有效
  const kDate = hmac(`AWS4${target.credentials.secretAccessKey}`, date);
  const kSigning = hmac(hmac(hmac(kDate, target.region), "s3"), "aws4_request");
  return { signature: hmac(kSigning, stringToSign).toString("hex"), signedHeaders, scope };
}

/**
 * 预签名 URL：把签名放进查询参数，拿到 URL 的人在有效期内可以不带密钥发出这一个请求。
 * headers 里的头也参与签名：使用者必须原样带上（例如 content-type、content-length），否则签名不匹配。
 */
export function presignUrl(target: SignTarget & { headers?: Record<string, string>; expiresIn: number }): string {
  const { dateTime, date } = timestamps(target.now ?? new Date());
  const headers = { host: target.url.host, ...target.headers };
  const signedHeaders = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort()
    .join(";");

  const query: [string, string][] = [
    ...target.url.searchParams,
    ["X-Amz-Algorithm", ALGORITHM],
    ["X-Amz-Credential", `${target.credentials.accessKeyId}/${date}/${target.region}/s3/aws4_request`],
    ["X-Amz-Date", dateTime],
    ["X-Amz-Expires", String(target.expiresIn)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  const { signature } = sign(target, query, headers, UNSIGNED_PAYLOAD, dateTime, date);

  const url = new URL(target.url);
  // 自己拼查询串而不是用 URLSearchParams：后者把空格编码成 "+"，与签名时的编码规则不同
  url.search = `${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
  return url.toString();
}

/**
 * 签名一个由服务端直接发出的请求（Authorization 头方式）。返回要附加的请求头；
 * host 也参与了签名，但不返回——fetch 会根据 URL 自动设置，手动设置反而会被忽略。
 */
export function signRequest(target: SignTarget & { headers?: Record<string, string>; payloadHash?: string }): Record<string, string> {
  const { dateTime, date } = timestamps(target.now ?? new Date());
  const payloadHash = target.payloadHash ?? EMPTY_PAYLOAD_SHA256;
  const headers = { ...target.headers, "x-amz-content-sha256": payloadHash, "x-amz-date": dateTime };
  const { signature, signedHeaders, scope } = sign(target, [...target.url.searchParams], { host: target.url.host, ...headers }, payloadHash, dateTime, date);
  return {
    ...headers,
    authorization: `${ALGORITHM} Credential=${target.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
