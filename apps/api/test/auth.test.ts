import { authStatusSchema, passkeySchema, sessionInfoSchema } from "@blog/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAuthConfig } from "../src/auth/config.ts";
import { sha256Hex } from "../src/auth/tokens.ts";
import { createApp } from "../src/create-app.ts";
import { authChallenges, passkeys, sessions, users } from "../src/db/schema.ts";
import {
  authenticationResponse,
  createFakeWebAuthn,
  registrationResponse,
  SETUP_TOKEN,
  setupTestApp,
  WEB_ORIGIN,
} from "./helpers.ts";

const { db, request, jar, calls } = setupTestApp();

type Options = { challenge: string; user?: { id: string } };

/** 首次设置：用设置口令注册第一个 Passkey（未登录） */
async function setupFirstPasskey(id = "cred-1") {
  const options = await request("POST", "/auth/registration/options", { auth: false, body: { setupToken: SETUP_TOKEN } });
  expect(options.status).toBe(200);
  const { challenge, user } = options.body as Options;
  const verify = await request("POST", "/auth/registration/verify", {
    auth: false,
    body: { response: registrationResponse(id, challenge), name: "MacBook" },
  });
  return { verify, userHandle: user?.id ?? "" };
}

/** 完整的登录流程，返回 verify 的响应 */
async function login(credentialId: string, opts: Parameters<typeof authenticationResponse>[2] = {}) {
  const options = await request("POST", "/auth/authentication/options", { auth: false });
  const { challenge } = options.body as Options;
  return request("POST", "/auth/authentication/verify", {
    auth: false,
    body: { response: authenticationResponse(credentialId, challenge, opts) },
  });
}

describe("first-time setup", () => {
  it("reports whether any passkey exists", async () => {
    expect(authStatusSchema.parse((await request("GET", "/auth/status", { auth: false })).body)).toEqual({ hasPasskeys: false });
    await setupFirstPasskey();
    expect((await request("GET", "/auth/status", { auth: false })).body).toEqual({ hasPasskeys: true });
  });

  it.each([
    ["no setup token", {}],
    ["a wrong setup token", { setupToken: "wrong" }],
  ])("refuses registration options with %s", async (_name, body) => {
    const res = await request("POST", "/auth/registration/options", { auth: false, body });
    expect(res.status).toBe(401);
    expect(jar.size).toBe(0);
  });

  it("asks for a discoverable, user-verified passkey bound to the web origin's host", async () => {
    const res = await request("POST", "/auth/registration/options", { auth: false, body: { setupToken: SETUP_TOKEN } });
    expect(res.body).toMatchObject({
      rp: { id: "blog.test", name: "mikexxz" },
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    // challenge id 放在 httpOnly 的 __Host- cookie 里
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/__Host-webauthn=[^;]+;.*HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Strict/);
  });

  it("creates the user, stores the passkey and signs in", async () => {
    const { verify, userHandle } = await setupFirstPasskey();
    expect(verify.status).toBe(201);
    expect(passkeySchema.parse(verify.body)).toMatchObject({ id: "cred-1", name: "MacBook", deviceType: "multiDevice" });

    // 传给库的期望值来自 WEB_ORIGIN，且要求用户验证
    expect(calls.at(-1)).toMatchObject({ expectedOrigin: WEB_ORIGIN, expectedRPID: "blog.test", requireUserVerification: true });

    const [user] = await db.select().from(users);
    expect(user?.webauthnUserId).toBe(userHandle);

    // 注册即登录：session cookie 已设置，属性正确
    const setCookie = verify.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/__Host-session=[^;]+;.*HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Domain=/i);
    expect(sessionInfoSchema.parse((await request("GET", "/auth/session", { auth: false })).body).user.displayName).toBe("管理员");
  });

  it("stores only the SHA-256 of the session token, never the token itself", async () => {
    await setupFirstPasskey();
    const token = jar.get("__Host-session") ?? "";
    const rows = await db.select({ id: sessions.id }).from(sessions);
    expect(rows).toEqual([{ id: sha256Hex(token) }]);
  });

  it("uses each challenge only once (replay protection)", async () => {
    const options = await request("POST", "/auth/registration/options", { auth: false, body: { setupToken: SETUP_TOKEN } });
    const { challenge } = options.body as Options;
    const challengeCookie = jar.get("__Host-webauthn") ?? "";
    const body = { response: registrationResponse("cred-1", challenge) };

    expect((await request("POST", "/auth/registration/verify", { auth: false, body })).status).toBe(201);
    // 攻击者截获了 challenge cookie 和签过名的响应，在另一个客户端重放
    const replay = await request("POST", "/auth/registration/verify", {
      auth: false,
      useJar: false,
      body: { response: registrationResponse("cred-2", challenge) },
      headers: { cookie: `__Host-webauthn=${challengeCookie}` },
    });
    expect(replay.status).toBe(400);
    expect(await db.select().from(passkeys)).toHaveLength(1);
  });

  it("rejects an expired challenge", async () => {
    const options = await request("POST", "/auth/registration/options", { auth: false, body: { setupToken: SETUP_TOKEN } });
    await db.update(authChallenges).set({ expiresAt: new Date(Date.now() - 1000) });
    const res = await request("POST", "/auth/registration/verify", {
      auth: false,
      body: { response: registrationResponse("cred-1", (options.body as Options).challenge) },
    });
    expect(res.status).toBe(400);
  });

  it("rejects a response signed over a different challenge", async () => {
    await request("POST", "/auth/registration/options", { auth: false, body: { setupToken: SETUP_TOKEN } });
    const res = await request("POST", "/auth/registration/verify", {
      auth: false,
      body: { response: registrationResponse("cred-1", "some-other-challenge") },
    });
    expect(res.status).toBe(400);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("refuses setup when no setup token is configured (entrance closed)", async () => {
    // 生产环境用完设置口令后会删掉环境变量：此时即使猜中旧口令也不能注册
    const closed = createApp({ db, auth: createAuthConfig({ webOrigin: WEB_ORIGIN }), webauthn: createFakeWebAuthn().webauthn });
    const res = await closed.request("/auth/registration/options", {
      method: "POST",
      headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ setupToken: SETUP_TOKEN }),
    });
    expect(res.status).toBe(401);
  });
});

describe("login", () => {
  it("signs in with a registered passkey and records the new counter", async () => {
    await setupFirstPasskey();
    jar.clear(); // 模拟另一台设备 / 已登出

    const res = await login("cred-1", { counter: 5 });
    expect(res.status).toBe(200);
    expect(sessionInfoSchema.parse(res.body).user.displayName).toBe("管理员");
    const [row] = await db.select().from(passkeys).where(eq(passkeys.id, "cred-1"));
    expect(row?.counter).toBe(5);
    expect(row?.lastUsedAt).not.toBeNull();
    expect((await request("GET", "/auth/session", { auth: false })).status).toBe(200);
  });

  it("issues a fresh session on every login (no session fixation)", async () => {
    await setupFirstPasskey();
    const before = jar.get("__Host-session");
    await login("cred-1", { counter: 1 });
    expect(jar.get("__Host-session")).not.toBe(before);
  });

  it.each([
    ["an unknown credential", "nope", {}],
    ["an invalid signature", "cred-1", { signature: "forged" }],
    ["a counter that went backwards (cloned authenticator)", "cred-1", { counter: 3 }],
    ["a mismatched user handle", "cred-1", { counter: 9, userHandle: "someone-else" }],
  ])("rejects %s", async (_name, credentialId, opts) => {
    await setupFirstPasskey();
    await db.update(passkeys).set({ counter: 5 });
    jar.clear();

    const res = await login(credentialId, opts);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "unauthorized", message: "Passkey 验证失败" } });
    expect(jar.has("__Host-session")).toBe(false);
  });

  it("requires the challenge cookie from the same browser", async () => {
    await setupFirstPasskey();
    const options = await request("POST", "/auth/authentication/options", { auth: false });
    jar.delete("__Host-webauthn");
    const res = await request("POST", "/auth/authentication/verify", {
      auth: false,
      body: { response: authenticationResponse("cred-1", (options.body as Options).challenge) },
    });
    expect(res.status).toBe(400);
  });

  it("rejects login requests from another origin (CSRF)", async () => {
    const res = await request("POST", "/auth/authentication/options", { auth: false, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("session lifecycle", () => {
  async function signedIn() {
    await setupFirstPasskey();
    return sha256Hex(jar.get("__Host-session") ?? "");
  }

  it("expires after 7 days of inactivity", async () => {
    const id = await signedIn();
    await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) }).where(eq(sessions.id, id));
    expect((await request("GET", "/auth/session", { auth: false })).status).toBe(401);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("expires at the absolute limit even when active", async () => {
    const id = await signedIn();
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, id));
    expect((await request("GET", "/auth/session", { auth: false })).status).toBe(401);
  });

  it("refreshes lastSeenAt at most once an hour", async () => {
    const id = await signedIn();
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    await db.update(sessions).set({ lastSeenAt: twoHoursAgo }).where(eq(sessions.id, id));
    await request("GET", "/auth/session", { auth: false });
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
    expect(row?.lastSeenAt.getTime()).toBeGreaterThan(twoHoursAgo.getTime() + 3600 * 1000);
  });

  it("logs out: deletes the session and clears the cookie", async () => {
    await signedIn();
    const res = await request("POST", "/auth/logout", { auth: false });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().join("\n")).toMatch(/__Host-session=;.*Max-Age=0/);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect((await request("GET", "/admin/posts", { auth: false })).status).toBe(401);
  });

  it("logs out everywhere", async () => {
    await signedIn();
    await login("cred-1", { counter: 1 }); // 第二个 session
    expect(await db.select().from(sessions)).toHaveLength(2);
    expect((await request("POST", "/auth/logout-all", { auth: false })).status).toBe(204);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});

describe("managing passkeys", () => {
  /** 已登录状态下添加第二个 Passkey */
  async function addPasskey(id: string) {
    const options = await request("POST", "/auth/registration/options", { auth: false, body: {} });
    expect(options.status).toBe(200);
    return request("POST", "/auth/registration/verify", {
      auth: false,
      body: { response: registrationResponse(id, (options.body as Options).challenge), name: "iPhone" },
    });
  }

  it("lets a signed-in user add another passkey without the setup token, excluding existing ones", async () => {
    await setupFirstPasskey();
    const options = await request("POST", "/auth/registration/options", { auth: false, body: {} });
    expect(options.body).toMatchObject({ excludeCredentials: [{ id: "cred-1" }] });
    const sessionsBefore = (await db.select().from(sessions)).length;

    const res = await request("POST", "/auth/registration/verify", {
      auth: false,
      body: { response: registrationResponse("cred-2", (options.body as Options).challenge) },
    });
    expect(res.status).toBe(201);
    // 已登录时添加设备不会再创建新 session
    expect(await db.select().from(sessions)).toHaveLength(sessionsBefore);
    const list = z.array(passkeySchema).parse((await request("GET", "/auth/passkeys", { auth: false })).body);
    expect(list.map((p) => p.id)).toEqual(["cred-1", "cred-2"]);
  });

  it("returns 409 when registering the same credential twice", async () => {
    await setupFirstPasskey();
    expect((await addPasskey("cred-1")).status).toBe(409);
  });

  it("renames a passkey", async () => {
    await setupFirstPasskey();
    const res = await request("PATCH", "/auth/passkeys/cred-1", { auth: false, body: { name: "  工作电脑  " } });
    expect(passkeySchema.parse(res.body).name).toBe("工作电脑");
  });

  it("deletes a passkey but never the last one", async () => {
    await setupFirstPasskey();
    expect((await request("DELETE", "/auth/passkeys/cred-1", { auth: false })).status).toBe(409);

    await addPasskey("cred-2");
    expect((await request("DELETE", "/auth/passkeys/cred-1", { auth: false })).status).toBe(204);
    expect((await request("DELETE", "/auth/passkeys/cred-1", { auth: false })).status).toBe(404);
    // 删除后不能再用它登录
    jar.clear();
    expect((await login("cred-1", { counter: 1 })).status).toBe(401);
  });

  it("requires a session to list or manage passkeys", async () => {
    expect((await request("GET", "/auth/passkeys", { auth: false })).status).toBe(401);
    expect((await request("DELETE", "/auth/passkeys/x", { auth: false })).status).toBe(401);
  });
});
