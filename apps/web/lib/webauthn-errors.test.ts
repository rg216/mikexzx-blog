import { WebAuthnError } from "@simplewebauthn/browser";
import { describe, expect, it } from "vitest";
import { describeWebAuthnError } from "./webauthn-errors";

const webauthnError = (code: ConstructorParameters<typeof WebAuthnError>[0]["code"], name = "InvalidStateError") =>
  new WebAuthnError({ message: "x", code, name, cause: new Error("cause") });

describe("describeWebAuthnError", () => {
  it("explains an authenticator that already holds a passkey for this site", () => {
    expect(describeWebAuthnError(webauthnError("ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"))).toMatch(/已经有/);
  });

  it("explains cancellation / timeout (NotAllowedError)", () => {
    const error = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    expect(describeWebAuthnError(error)).toMatch(/已取消/);
  });

  it("explains an invalid domain", () => {
    expect(describeWebAuthnError(webauthnError("ERROR_INVALID_DOMAIN", "SecurityError"))).toMatch(/HTTPS/);
  });

  it("falls back to a generic message", () => {
    expect(describeWebAuthnError("weird")).toBe("Passkey 操作失败，请重试。");
  });
});
