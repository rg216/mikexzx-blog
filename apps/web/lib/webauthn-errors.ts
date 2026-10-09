import { WebAuthnError } from "@simplewebauthn/browser";

/**
 * 把浏览器 WebAuthn 调用的失败翻译成用户能看懂的话。
 * 注意：用户点了"取消"、超时、没有可用的 Passkey，浏览器出于隐私都只报 NotAllowedError，无法区分。
 */
export function describeWebAuthnError(error: unknown): string {
  if (error instanceof WebAuthnError) {
    switch (error.code) {
      case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
        return "这台设备上已经有这个网站的 Passkey 了，可以直接用它登录。";
      case "ERROR_CEREMONY_ABORTED":
        return "操作已中止，请重试。";
      case "ERROR_INVALID_DOMAIN":
      case "ERROR_INVALID_RP_ID":
        return "当前网址不能使用 Passkey（需要 HTTPS 或 localhost）。";
      case "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT":
      case "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT":
        return "这个认证器不支持 Passkey 所需的功能，请换一台设备或密码管理器。";
    }
  }
  if (error instanceof Error && error.name === "NotAllowedError") {
    return "已取消、超时，或这台设备上没有可用的 Passkey。";
  }
  return "Passkey 操作失败，请重试。";
}
