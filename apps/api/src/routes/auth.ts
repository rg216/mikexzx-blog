import {
  authenticationVerifyInputSchema,
  passkeyUpdateInputSchema,
  registrationOptionsInputSchema,
  registrationVerifyInputSchema,
  type SessionInfo,
} from "@blog/shared";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { Hono } from "hono";
import { z } from "zod";
import { consumeChallenge, saveChallenge } from "../auth/challenges.ts";
import type { AuthConfig } from "../auth/config.ts";
import {
  clearChallengeCookie,
  clearSessionCookie,
  getChallengeCookie,
  setChallengeCookie,
  setSessionCookie,
} from "../auth/cookies.ts";
import { createSession, deleteExpiredSessions, revokeAllSessions, revokeSession } from "../auth/sessions.ts";
import { randomToken, safeEqual } from "../auth/tokens.ts";
import type { WebAuthn } from "../auth/webauthn.ts";
import type { Db } from "../db/client.ts";
import { clientIp } from "../lib/client-ip.ts";
import { HttpError } from "../lib/errors.ts";
import { type RateLimiter, rateLimit, rules } from "../lib/rate-limit.ts";
import { validate } from "../lib/validate.ts";
import { type AuthEnv, requireSession, sessionOf } from "../middleware/auth.ts";
import {
  countPasskeys,
  deletePasskey,
  findPasskey,
  getAdminUser,
  getUserById,
  listPasskeys,
  markPasskeyUsed,
  renamePasskey,
  saveNewPasskey,
  toPasskey,
} from "../services/passkeys.ts";

const passkeyIdParam = z.object({ id: z.string().min(1).max(1024) });

const toBytes = (base64url: string) => new Uint8Array(Buffer.from(base64url, "base64url"));
const toBase64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/*
 * zod 只校验了外层结构（见 webauthnResponseSchema），内部字段的格式与签名由 SimpleWebAuthn 验证。
 * 这里把校验后的值交给库，类型上需要一次转换。
 */
const asRegistrationResponse = (value: unknown) => value as RegistrationResponseJSON;
const asAuthenticationResponse = (value: unknown) => value as AuthenticationResponseJSON;

export function authRoutes(db: Db, config: AuthConfig, webauthn: WebAuthn, limiter: RateLimiter) {
  const { webOrigin, rpID, rpName } = config;
  // 登录 / 注册相关的接口按 IP 限流（设置口令虽然猜不中，也不该允许无限次尝试）
  const limitByIp = rateLimit(limiter, rules.auth, (c) => clientIp(c));

  return (
    new Hono<AuthEnv>()
      .use("/registration/*", limitByIp)
      .use("/authentication/*", limitByIp)
      /** 登录页用：还没有任何 Passkey 时显示"首次设置" */
      .get("/status", async (c) => c.json({ hasPasskeys: (await countPasskeys(db)) > 0 }))

      .get("/session", requireSession, (c) => {
        const session = sessionOf(c);
        return c.json({
          user: { displayName: session.user.displayName },
          expiresAt: session.expiresAt.toISOString(),
        } satisfies SessionInfo);
      })

      // ---------- 注册 Passkey ----------
      // 两种情况：已登录 → 给自己添加新设备；未登录 → 必须提供 ADMIN_SETUP_TOKEN（首次设置 / 恢复）
      .post("/registration/options", validate("json", registrationOptionsInputSchema), async (c) => {
        const session = c.get("session");
        const { setupToken } = c.req.valid("json");

        let user = session ? await getUserById(db, session.user.id) : null;
        if (!session) {
          const allowed = config.setupToken !== undefined && setupToken !== undefined && safeEqual(setupToken, config.setupToken);
          if (!allowed) throw new HttpError(401, "unauthorized", "需要先登录，或提供有效的设置口令");
          user = await getAdminUser(db);
        }

        // 首次设置时用户还不存在：先生成 user handle，验证成功后再建用户
        const webauthnUserId = user?.webauthnUserId ?? randomToken(32);
        const existing = user ? await listPasskeys(db, user.id) : [];

        const options = await webauthn.generateRegistrationOptions({
          rpName,
          rpID,
          userName: "admin",
          userDisplayName: user?.displayName ?? "管理员",
          userID: toBytes(webauthnUserId),
          attestationType: "none", // 不需要验证设备厂商，只要公钥
          // 同一台设备不重复注册
          excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
          // 可发现凭证（登录时不用输用户名）+ 必须验证用户本人（指纹、面容、PIN）
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
        });

        const challengeId = await saveChallenge(db, {
          challenge: options.challenge,
          kind: "registration",
          webauthnUserId,
          ...(user && { userId: user.id }),
        });
        setChallengeCookie(c, config, challengeId);
        return c.json(options);
      })

      .post("/registration/verify", validate("json", registrationVerifyInputSchema), async (c) => {
        const challenge = await consumeChallenge(db, getChallengeCookie(c, config), "registration");
        clearChallengeCookie(c, config);
        if (!challenge?.webauthnUserId) throw new HttpError(400, "validation_error", "注册已过期，请重新开始");

        const session = c.get("session");
        // 已登录时，只能给自己添加；challenge 必须是这个用户生成的
        if (session && challenge.userId !== session.user.id) {
          throw new HttpError(400, "validation_error", "注册已过期，请重新开始");
        }

        const { response, name } = c.req.valid("json");
        const result = await webauthn
          .verifyRegistrationResponse({
            response: asRegistrationResponse(response),
            expectedChallenge: challenge.challenge,
            expectedOrigin: webOrigin,
            expectedRPID: rpID,
            requireUserVerification: true,
          })
          .catch((error: unknown) => {
            console.warn("registration verification failed:", error);
            return null;
          });
        if (!result?.verified) throw new HttpError(400, "validation_error", "Passkey 验证失败，请重试");

        const info = result.registrationInfo;
        if (await findPasskey(db, info.credential.id)) throw new HttpError(409, "conflict", "这个 Passkey 已经注册过了");

        const saved = await saveNewPasskey(db, {
          userId: challenge.userId,
          webauthnUserId: challenge.webauthnUserId,
          passkey: {
            id: info.credential.id,
            publicKey: toBase64url(info.credential.publicKey),
            counter: info.credential.counter,
            transports: info.credential.transports ?? [],
            deviceType: info.credentialDeviceType,
            backedUp: info.credentialBackedUp,
            name: name ?? "Passkey",
          },
        });

        // 未登录（首次设置 / 恢复）：注册成功即登录
        if (!session) {
          const { token } = await createSession(db, saved.userId, c.req.header("user-agent"));
          setSessionCookie(c, config, token);
        }
        return c.json(toPasskey(saved.passkey), 201);
      })

      // ---------- 用 Passkey 登录 ----------
      .post("/authentication/options", async (c) => {
        // 不传 allowCredentials：让浏览器列出本站所有可用的 Passkey（可发现凭证，无需用户名）
        const options = await webauthn.generateAuthenticationOptions({ rpID, userVerification: "required" });
        const challengeId = await saveChallenge(db, { challenge: options.challenge, kind: "authentication" });
        setChallengeCookie(c, config, challengeId);
        return c.json(options);
      })

      .post("/authentication/verify", validate("json", authenticationVerifyInputSchema), async (c) => {
        const challenge = await consumeChallenge(db, getChallengeCookie(c, config), "authentication");
        clearChallengeCookie(c, config);
        if (!challenge) throw new HttpError(400, "validation_error", "登录已过期，请重新开始");

        const { response } = c.req.valid("json");
        // 统一的失败信息：不区分"凭证不存在"和"签名不对"，不给攻击者提供线索
        const fail = () => new HttpError(401, "unauthorized", "Passkey 验证失败");

        const passkey = await findPasskey(db, response.id);
        if (!passkey) throw fail();
        const owner = await getUserById(db, passkey.userId);
        // 可发现凭证会带回 user handle，必须和凭证的主人一致
        const userHandle = response.response.userHandle;
        if (!owner || (typeof userHandle === "string" && userHandle !== owner.webauthnUserId)) throw fail();

        const result = await webauthn
          .verifyAuthenticationResponse({
            response: asAuthenticationResponse(response),
            expectedChallenge: challenge.challenge,
            expectedOrigin: webOrigin,
            expectedRPID: rpID,
            credential: {
              id: passkey.id,
              publicKey: toBytes(passkey.publicKey),
              // 库会检查新计数是否大于旧计数：计数倒退说明凭证可能被克隆
              counter: passkey.counter,
              transports: passkey.transports,
            },
            requireUserVerification: true,
          })
          .catch((error: unknown) => {
            console.warn("authentication verification failed:", error);
            return null;
          });
        if (!result?.verified) throw fail();

        await markPasskeyUsed(db, passkey.id, {
          counter: result.authenticationInfo.newCounter,
          backedUp: result.authenticationInfo.credentialBackedUp,
        });
        await deleteExpiredSessions(db);
        // 登录总是创建全新的 session（不复用请求里可能带着的旧 session），防止 session 固定攻击
        const { token, expiresAt } = await createSession(db, owner.id, c.req.header("user-agent"));
        setSessionCookie(c, config, token);
        return c.json({ user: { displayName: owner.displayName }, expiresAt: expiresAt.toISOString() } satisfies SessionInfo);
      })

      // ---------- 登出 ----------
      .post("/logout", async (c) => {
        const session = c.get("session");
        if (session) await revokeSession(db, session.id);
        clearSessionCookie(c, config);
        return c.body(null, 204);
      })

      .post("/logout-all", requireSession, async (c) => {
        await revokeAllSessions(db, sessionOf(c).user.id);
        clearSessionCookie(c, config);
        return c.body(null, 204);
      })

      // ---------- 管理 Passkey ----------
      .get("/passkeys", requireSession, async (c) => {
        const session = sessionOf(c);
        return c.json((await listPasskeys(db, session.user.id)).map(toPasskey));
      })

      .patch("/passkeys/:id", requireSession, validate("param", passkeyIdParam), validate("json", passkeyUpdateInputSchema), async (c) => {
        const session = sessionOf(c);
        const row = await renamePasskey(db, session.user.id, c.req.valid("param").id, c.req.valid("json").name);
        if (!row) throw new HttpError(404, "not_found", "Passkey 不存在");
        return c.json(toPasskey(row));
      })

      .delete("/passkeys/:id", requireSession, validate("param", passkeyIdParam), async (c) => {
        const session = sessionOf(c);
        const result = await deletePasskey(db, session.user.id, c.req.valid("param").id);
        if (result === "not_found") throw new HttpError(404, "not_found", "Passkey 不存在");
        if (result === "last_passkey") throw new HttpError(409, "conflict", "不能删除最后一个 Passkey，否则将无法登录");
        return c.body(null, 204);
      })
  );
}
