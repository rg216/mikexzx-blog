import { appAuthCodeSchema, appTokenSchema, sessionInfoSchema } from "@blog/shared";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth/tokens.ts";
import { appAuthCodes, sessions } from "../src/db/schema.ts";
import { setupTestApp } from "./helpers.ts";

const { db, request } = setupTestApp();

const VERIFIER = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEFG";
const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** 网站上的授权页：已登录的管理员允许 App 登录（cookie session、同源 Origin） */
async function issueCode(verifier = VERIFIER, deviceName = "Mike 的 iPhone") {
  const res = await request("POST", "/auth/app/codes", { body: { codeChallenge: challengeOf(verifier), deviceName } });
  expect(res.status).toBe(201);
  return appAuthCodeSchema.parse(res.body).code;
}

/** App 换 token：不带 cookie、不带 Origin（原生 App 发不出、也不需要） */
function exchange(code: string, codeVerifier = VERIFIER) {
  return request("POST", "/auth/app/token", { auth: false, origin: null, useJar: false, body: { code, codeVerifier } });
}

/** App 之后的请求：只有 Bearer 头 */
function asApp(method: string, path: string, token: string, body?: unknown) {
  return request(method, path, { auth: false, origin: null, useJar: false, headers: { authorization: `Bearer ${token}` }, body });
}

describe("native app login", () => {
  it("issues a code only to a signed-in admin", async () => {
    const res = await request("POST", "/auth/app/codes", {
      auth: false,
      body: { codeChallenge: challengeOf(VERIFIER), deviceName: "iPhone" },
    });
    expect(res.status).toBe(401);
  });

  it("checks the Origin when issuing a code: it is a cookie-authenticated write", async () => {
    const res = await request("POST", "/auth/app/codes", {
      origin: "https://evil.example",
      body: { codeChallenge: challengeOf(VERIFIER), deviceName: "iPhone" },
    });
    expect(res.status).toBe(403);
  });

  it("stores only a hash of the code", async () => {
    const code = await issueCode();
    const [row] = await db.select().from(appAuthCodes);
    expect(row?.id).toBe(sha256Hex(code));
    expect(row?.deviceName).toBe("Mike 的 iPhone");
  });

  it("exchanges the code and verifier for a bearer session that works on admin endpoints", async () => {
    const token = appTokenSchema.parse((await exchange(await issueCode())).body);
    expect(token.user.displayName).toBe("管理员");

    const session = await asApp("GET", "/auth/session", token.token);
    expect(session.status).toBe(200);
    expect(sessionInfoSchema.parse(session.body).user.displayName).toBe("管理员");

    // 写操作不带 Origin 也可以：只有 Bearer、没有 cookie，不存在 CSRF
    const created = await asApp("POST", "/admin/posts", token.token, { slug: "from-app", title: "From the app", contentMd: "" });
    expect(created.status).toBe(201);

    // session 记下是哪台设备
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sha256Hex(token.token)));
    expect(row?.userAgent).toBe("App: Mike 的 iPhone");
  });

  it("uses each code once", async () => {
    const code = await issueCode();
    expect((await exchange(code)).status).toBe(201);
    expect((await exchange(code)).status).toBe(400);
  });

  it("rejects a wrong verifier and burns the code", async () => {
    const code = await issueCode();
    expect((await exchange(code, `${VERIFIER}-wrong`)).status).toBe(400);
    // 猜错一次授权码就作废，正确的 verifier 也换不到了
    expect((await exchange(code)).status).toBe(400);
  });

  it("rejects an expired code", async () => {
    const code = await issueCode();
    await db.update(appAuthCodes).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await exchange(code)).status).toBe(400);
  });

  it("rejects malformed challenges and verifiers", async () => {
    const bad = await request("POST", "/auth/app/codes", { body: { codeChallenge: "short", deviceName: "iPhone" } });
    expect(bad.status).toBe(400);
    expect((await exchange("whatever", "too-short")).status).toBe(400);
  });

  it("signs the app out by revoking its session", async () => {
    const token = appTokenSchema.parse((await exchange(await issueCode())).body).token;
    expect((await asApp("POST", "/auth/logout", token)).status).toBe(204);
    expect((await asApp("GET", "/auth/session", token)).status).toBe(401);
  });

  it("does not accept an unknown or malformed bearer token", async () => {
    expect((await asApp("GET", "/admin/posts", "not-a-real-token")).status).toBe(401);
    const malformed = await request("GET", "/admin/posts", { auth: false, useJar: false, headers: { authorization: "Bearer a b" } });
    expect(malformed.status).toBe(401);
  });

  it("still checks the Origin when a bearer request also carries cookies", async () => {
    const token = appTokenSchema.parse((await exchange(await issueCode())).body).token;
    // 有 cookie 的请求可能来自浏览器：照常要求同源
    const res = await request("POST", "/admin/posts", {
      origin: null,
      headers: { authorization: `Bearer ${token}` },
      body: { slug: "x", title: "x", contentMd: "" },
    });
    expect(res.status).toBe(403);
  });
});
