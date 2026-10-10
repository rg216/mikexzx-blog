import { describe, expect, it, vi } from "vitest";
import { codeChallengeFor, createGitHub } from "./github.ts";

const config = { clientId: "Iv23client", clientSecret: "secret", redirectUri: "https://blog.test/api/auth/github/callback" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("codeChallengeFor", () => {
  it("matches the RFC 7636 example", () => {
    // RFC 7636 附录 B 的示例
    expect(codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("createGitHub", () => {
  it("builds the authorize URL without scopes, with state and an S256 challenge", () => {
    const url = new URL(createGitHub(config).authorizeUrl("state-1", "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "Iv23client",
      redirect_uri: config.redirectUri,
      state: "state-1",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      allow_signup: "false",
    });
  });

  it("exchanges the code with the verifier and client secret", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ access_token: "ghu_x", token_type: "bearer", scope: "" }));
    expect(await createGitHub(config, fetch).exchangeCode("code-1", "verifier")).toBe("ghu_x");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: "Iv23client",
      client_secret: "secret",
      code: "code-1",
      redirect_uri: config.redirectUri,
      code_verifier: "verifier",
    });
  });

  it("treats GitHub's 200-with-error token responses as failures", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ error: "bad_verification_code", error_description: "expired" }));
    await expect(createGitHub(config, fetch).exchangeCode("old", "v")).rejects.toThrow("bad_verification_code");
  });

  it("reads the public profile and normalizes an empty name to null", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ id: 1, login: "octocat", name: "", avatar_url: "https://avatars.test/1", email: null }));
    expect(await createGitHub(config, fetch).fetchUser("ghu_x")).toEqual({ id: 1, login: "octocat", name: null, avatarUrl: "https://avatars.test/1" });
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer ghu_x");
    expect(headers.get("user-agent")).toBeTruthy();
  });

  it("returns null for unknown usernames", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ message: "Not Found" }, 404));
    expect(await createGitHub(config, fetch).fetchUserByLogin("nobody")).toBeNull();
  });
});
