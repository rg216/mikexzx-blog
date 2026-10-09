import {
  authStatusSchema,
  type Passkey,
  passkeySchema,
  type SessionInfo,
  sessionInfoSchema,
} from "@blog/shared";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { z } from "zod";
import { createJsonClient, redirectToLogin } from "./admin-api";

/*
 * 登录 / Passkey 接口客户端（浏览器端，走同源 /api/auth/*）。
 *
 * 登录相关接口的 401 是正常结果（Passkey 验证失败、还没登录），由调用方显示错误，不自动跳转；
 * 只有"已登录才能做"的管理操作（Passkey 列表等）收到 401 才跳回登录页。
 */

// WebAuthn 选项由服务端生成、原样交给浏览器 API：这里只确认有 challenge，细节交给 @simplewebauthn/browser
const optionsSchema = z.looseObject({ challenge: z.string().min(1) });

export function createAuthApi(options: { fetch?: typeof fetch } = {}) {
  const auth = createJsonClient({ ...options, basePath: "/api/auth", onUnauthorized: () => {} });
  const managed = createJsonClient({ ...options, basePath: "/api/auth", onUnauthorized: redirectToLogin });

  return {
    async status() {
      return auth.parseJson(await auth.request("GET", "/status"), authStatusSchema);
    },

    /** 当前 session；未登录时抛出 status 为 401 的 AdminApiError */
    async session(): Promise<SessionInfo> {
      return auth.parseJson(await auth.request("GET", "/session"), sessionInfoSchema);
    },

    async loginOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
      const json = await auth.parseJson(await auth.request("POST", "/authentication/options"), optionsSchema);
      return json as unknown as PublicKeyCredentialRequestOptionsJSON;
    },

    async loginVerify(response: AuthenticationResponseJSON): Promise<SessionInfo> {
      return auth.parseJson(await auth.request("POST", "/authentication/verify", { response }), sessionInfoSchema);
    },

    /** 未登录时需要 setupToken（首次设置 / 恢复）；已登录时添加新 Passkey 不需要 */
    async registrationOptions(setupToken?: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
      const body = setupToken ? { setupToken } : {};
      const json = await auth.parseJson(await auth.request("POST", "/registration/options", body), optionsSchema);
      return json as unknown as PublicKeyCredentialCreationOptionsJSON;
    },

    async registrationVerify(response: RegistrationResponseJSON, name?: string): Promise<Passkey> {
      const body = name ? { response, name } : { response };
      return auth.parseJson(await auth.request("POST", "/registration/verify", body), passkeySchema);
    },

    async logout(): Promise<void> {
      await auth.request("POST", "/logout");
    },

    async logoutAll(): Promise<void> {
      await managed.request("POST", "/logout-all");
    },

    async listPasskeys(): Promise<Passkey[]> {
      return managed.parseJson(await managed.request("GET", "/passkeys"), z.array(passkeySchema));
    },

    async renamePasskey(id: string, name: string): Promise<Passkey> {
      return managed.parseJson(await managed.request("PATCH", `/passkeys/${encodeURIComponent(id)}`, { name }), passkeySchema);
    },

    async deletePasskey(id: string): Promise<void> {
      await managed.request("DELETE", `/passkeys/${encodeURIComponent(id)}`);
    },
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
