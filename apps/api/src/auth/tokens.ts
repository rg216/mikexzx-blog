import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 256 位随机令牌，base64url 编码（可直接放进 cookie） */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * 常量时间比较两个字符串。先各自做 SHA-256：timingSafeEqual 要求等长，哈希后长度固定；
 * 直接用 === 会在第一个不同字符处提前返回，响应时间会泄露"猜对了几位"。
 */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
