import { z } from "zod";

const isoDateTime = z.iso.datetime({ offset: true });

/*
 * 浏览器 navigator.credentials.create()/get() 的结果（由 @simplewebauthn/browser 序列化成 JSON）。
 * 这里只校验外层结构和大小，防止明显畸形的输入；签名、challenge、来源等由 @simplewebauthn/server 验证。
 */
const base64url = z.string().min(1).max(16_384).regex(/^[A-Za-z0-9_-]+$/, "必须是 base64url");
export const webauthnResponseSchema = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  response: z.looseObject({ clientDataJSON: base64url }),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
});

// ---------- 输入 ----------

export const registrationOptionsInputSchema = z.strictObject({
  /** 首次设置 / 恢复时需要（ADMIN_SETUP_TOKEN）；已登录时添加新 Passkey 不需要 */
  setupToken: z.string().min(1).max(200).optional(),
});
export type RegistrationOptionsInput = z.infer<typeof registrationOptionsInputSchema>;

export const passkeyNameSchema = z.string().trim().min(1).max(50);

export const registrationVerifyInputSchema = z.strictObject({
  response: webauthnResponseSchema,
  /** 方便辨认的名称，如 "MacBook Touch ID" */
  name: passkeyNameSchema.optional(),
});

export const authenticationVerifyInputSchema = z.strictObject({
  response: webauthnResponseSchema,
});

export const passkeyUpdateInputSchema = z.strictObject({ name: passkeyNameSchema });

// ---------- 输出 ----------

/** 公开：登录页据此决定显示"登录"还是"首次设置" */
export const authStatusSchema = z.object({ hasPasskeys: z.boolean() });
export type AuthStatus = z.infer<typeof authStatusSchema>;

export const sessionInfoSchema = z.object({
  user: z.object({ displayName: z.string() }),
  /** session 的绝对过期时间（闲置过久会更早失效） */
  expiresAt: isoDateTime,
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export const passkeySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** multiDevice：可同步的 Passkey（如 iCloud 钥匙串）；singleDevice：绑定单台设备（如硬件安全密钥） */
  deviceType: z.enum(["singleDevice", "multiDevice"]),
  backedUp: z.boolean(),
  createdAt: isoDateTime,
  lastUsedAt: isoDateTime.nullable(),
});
export type Passkey = z.infer<typeof passkeySchema>;
