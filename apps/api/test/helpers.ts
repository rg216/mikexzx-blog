import type { PostCreateInput } from "@blog/shared";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";
import { createAuthConfig } from "../src/auth/config.ts";
import { codeChallengeFor, type GitHub, GitHubError, type GitHubUser } from "../src/auth/github.ts";
import { createSession } from "../src/auth/sessions.ts";
import type { WebAuthn } from "../src/auth/webauthn.ts";
import { createApp } from "../src/create-app.ts";
import { createDb } from "../src/db/client.ts";
import { users } from "../src/db/schema.ts";
import { createRedisProvider, type RedisProvider } from "../src/redis.ts";
import { createObjectStorage, type ObjectStorage } from "../src/storage.ts";

export const WEB_ORIGIN = "https://blog.test";
export const SETUP_TOKEN = "test-setup-token-0123456789abcdef0123456789";
export const CRON_SECRET = "test-cron-secret-0123456789abcdef0123456789";

// ---------- 假的 WebAuthn ----------
/*
 * 测试约定：clientDataJSON = base64url(JSON.stringify({ challenge, counter? }))，signature 为 "valid" 才算签名正确。
 * 假实现按这个约定做和真实库相同的检查（challenge 匹配、签名、计数器不能倒退），
 * 让测试能验证"我们的路由把正确的 challenge / origin / 计数器交给了库，并正确处理失败"。
 */
type ClientData = { challenge: string; counter?: number };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (value: string) => JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as ClientData;

export function createFakeWebAuthn() {
  let seq = 0;
  // 记录传给库的关键参数，测试据此断言 origin / RP ID / 用户验证要求是否正确
  const calls: { expectedOrigin?: unknown; expectedRPID?: unknown; requireUserVerification?: unknown }[] = [];

  const webauthn: WebAuthn = {
    async generateRegistrationOptions(opts) {
      const options: PublicKeyCredentialCreationOptionsJSON = {
        challenge: `reg-challenge-${++seq}`,
        rp: { name: opts.rpName, id: opts.rpID },
        user: {
          id: Buffer.from(opts.userID ?? new Uint8Array()).toString("base64url"),
          name: opts.userName,
          displayName: opts.userDisplayName ?? "",
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        excludeCredentials: (opts.excludeCredentials ?? []).map((c) => ({ id: c.id, type: "public-key" })),
        ...(opts.authenticatorSelection && { authenticatorSelection: opts.authenticatorSelection }),
      };
      return options;
    },
    async verifyRegistrationResponse(opts) {
      calls.push(opts);
      if (decode(opts.response.response.clientDataJSON).challenge !== opts.expectedChallenge) {
        throw new Error("Unexpected registration response challenge");
      }
      return {
        verified: true,
        registrationInfo: {
          fmt: "none",
          aaguid: "00000000-0000-0000-0000-000000000000",
          credential: { id: opts.response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] },
          credentialType: "public-key",
          attestationObject: new Uint8Array(),
          userVerified: true,
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
          origin: String(opts.expectedOrigin),
        },
      };
    },
    async generateAuthenticationOptions(opts) {
      const options: PublicKeyCredentialRequestOptionsJSON = {
        challenge: `auth-challenge-${++seq}`,
        rpId: opts.rpID,
        ...(opts.userVerification && { userVerification: opts.userVerification }),
      };
      return options;
    },
    async verifyAuthenticationResponse(opts) {
      calls.push(opts);
      const data = decode(opts.response.response.clientDataJSON);
      if (data.challenge !== opts.expectedChallenge) throw new Error("Unexpected authentication response challenge");
      if (opts.response.response.signature !== "valid") throw new Error("Signature verification failed");
      const newCounter = data.counter ?? 0;
      // 与真实库一致：计数器非零时必须递增，否则可能是被克隆的凭证
      if ((newCounter > 0 || opts.credential.counter > 0) && newCounter <= opts.credential.counter) {
        throw new Error("Response counter value was lower than expected");
      }
      return {
        verified: true,
        authenticationInfo: {
          credentialID: opts.credential.id,
          newCounter,
          userVerified: true,
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
          origin: String(opts.expectedOrigin),
          rpID: "blog.test",
        },
      };
    },
  };
  return { webauthn, calls };
}

/** 构造浏览器 startRegistration() 的返回值（按上面的测试约定） */
export function registrationResponse(id: string, challenge: string) {
  return {
    id,
    rawId: id,
    type: "public-key",
    response: { clientDataJSON: encode({ challenge }), attestationObject: "AA", transports: ["internal"] },
    clientExtensionResults: {},
  };
}

/** 构造浏览器 startAuthentication() 的返回值 */
export function authenticationResponse(
  id: string,
  challenge: string,
  { counter = 0, signature = "valid", userHandle }: { counter?: number; signature?: string; userHandle?: string } = {},
) {
  return {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: encode({ challenge, counter }),
      authenticatorData: "AA",
      signature,
      ...(userHandle && { userHandle }),
    },
    clientExtensionResults: {},
  };
}

// ---------- 假的 GitHub ----------

/**
 * 模拟 GitHub 的 OAuth：approve() 相当于用户在授权页点了"同意"，为授权页 URL 里的 code_challenge 签发一个 code。
 * 换 token 时和真 GitHub 一样校验 code 只能用一次、code_verifier 必须与 challenge 对应（PKCE）。
 */
export function createFakeGitHub() {
  let seq = 0;
  const codes = new Map<string, { user: GitHubUser; challenge: string }>();
  const tokens = new Map<string, GitHubUser>();
  /** fetchUserByLogin 能查到的用户（按小写用户名） */
  const directory = new Map<string, GitHubUser>();
  let failNextExchange = false;

  const github: GitHub = {
    authorizeUrl: (state, codeVerifier) =>
      `https://github.test/login/oauth/authorize?${new URLSearchParams({ state, code_challenge: codeChallengeFor(codeVerifier) })}`,
    async exchangeCode(code, codeVerifier) {
      const entry = codes.get(code);
      codes.delete(code);
      if (failNextExchange) {
        failNextExchange = false;
        throw new GitHubError("network down");
      }
      if (!entry || entry.challenge !== codeChallengeFor(codeVerifier)) throw new GitHubError("token exchange failed: bad_verification_code");
      const token = `token-${code}`;
      tokens.set(token, entry.user);
      return token;
    },
    async fetchUser(token) {
      const user = tokens.get(token);
      if (!user) throw new GitHubError("GET /user: HTTP 401");
      return user;
    },
    async fetchUserByLogin(login) {
      return directory.get(login.toLowerCase()) ?? null;
    },
  };

  function approve(authorizeUrl: string, user: GitHubUser): string {
    const challenge = new URL(authorizeUrl).searchParams.get("code_challenge") ?? "";
    const code = `code-${++seq}`;
    codes.set(code, { user, challenge });
    return code;
  }

  return { github, approve, directory, failNextExchange: () => (failNextExchange = true) };
}

export const githubUser = (id: number, login: string): GitHubUser => ({
  id,
  login,
  name: null,
  avatarUrl: `https://avatars.githubusercontent.com/u/${id}`,
});

// ---------- 测试 app 与客户端 ----------

type RequestOptions = {
  body?: unknown;
  /** 默认 true：以已登录的管理员身份请求 */
  auth?: boolean;
  /** 覆盖 Origin 头；null 表示不带 */
  origin?: string | null;
  /** 默认 true：带上 cookie jar 里的 cookie。false 模拟"另一个客户端"（如只偷到某个 cookie 的攻击者） */
  useJar?: boolean;
  headers?: Record<string, string>;
};

/** 测试用的对象存储：docker compose 里的 RustFS（凭证与 compose 文件一致） */
export function createTestStorage(): ObjectStorage {
  const endpoint = process.env.TEST_S3_ENDPOINT ?? "";
  const bucket = process.env.TEST_S3_BUCKET ?? "";
  return createObjectStorage({
    endpoint,
    region: "us-east-1",
    bucket,
    credentials: { accessKeyId: "blog-dev-access-key", secretAccessKey: "blog-dev-secret-key" },
    publicUrl: `${endpoint}/${bucket}`,
  });
}

/**
 * 每个测试文件调用一次：建连接、组装 app、每个测试前清空数据。
 * withRedis：连真实 Redis（限流、阅读计数）；withStorage：连真实的对象存储（图片上传）。
 */
export function setupTestApp({ withRedis = false, withStorage = false }: { withRedis?: boolean; withStorage?: boolean } = {}) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL 未设置");
  const { db, pool } = createDb(url);
  const redis: RedisProvider | null = withRedis ? createRedisProvider(process.env.TEST_REDIS_URL ?? "") : null;
  const storage = withStorage ? createTestStorage() : null;
  const fake = createFakeWebAuthn();
  const fakeGitHub = createFakeGitHub();
  // 记录每次"通知前端失效缓存"的标签
  const revalidations: string[][] = [];
  const app = createApp({
    db,
    auth: createAuthConfig({ webOrigin: WEB_ORIGIN, setupToken: SETUP_TOKEN }),
    webauthn: fake.webauthn,
    revalidate: async (tags) => {
      revalidations.push(tags);
    },
    redis,
    storage,
    github: fakeGitHub.github,
    cronSecret: CRON_SECRET,
  });

  // 简易 cookie jar：像浏览器一样保存 Set-Cookie，并在后续请求里带上
  const jar = new Map<string, string>();
  let adminCookie: string | null = null;

  beforeEach(async () => {
    // RESTART IDENTITY：自增 id 也从 1 开始，测试里的 id 可预测
    await db.execute(
      sql`TRUNCATE posts, tags, post_tags, images, users, passkeys, sessions, auth_challenges, comments, commenters, commenter_sessions, oauth_states RESTART IDENTITY CASCADE`,
    );
    jar.clear();
    adminCookie = null;
    fake.calls.length = 0;
    fakeGitHub.directory.clear();
    revalidations.length = 0;
    if (redis) await (await redis()).flushDb();
  });
  afterAll(async () => {
    await pool.end();
    if (redis) (await redis()).destroy();
  });

  /** 直接在库里建管理员和 session（管理接口的测试不必每次走 Passkey 流程） */
  async function adminSessionCookie(): Promise<string> {
    if (adminCookie) return adminCookie;
    const [user] = await db
      .insert(users)
      .values({ displayName: "管理员", webauthnUserId: "test-user-handle" })
      .onConflictDoNothing()
      .returning({ id: users.id });
    const userId = user?.id ?? 1;
    const { token } = await createSession(db, userId, "vitest");
    adminCookie = `__Host-session=${token}`;
    return adminCookie;
  }

  async function request(method: string, path: string, options: RequestOptions = {}) {
    const headers: Record<string, string> = { ...options.headers };
    const origin = options.origin === undefined ? WEB_ORIGIN : options.origin;
    if (origin !== null) headers.origin = origin;
    if (options.body !== undefined) headers["content-type"] = "application/json";

    // 显式传入的 cookie 头排在前面，不会被 jar 覆盖
    const useJar = options.useJar !== false;
    const cookies = options.headers?.cookie ? [options.headers.cookie] : [];
    if (useJar) cookies.push(...[...jar].map(([name, value]) => `${name}=${value}`));
    if (options.auth !== false && !(useJar && jar.has("__Host-session"))) cookies.push(await adminSessionCookie());
    if (cookies.length > 0) headers.cookie = cookies.join("; ");

    const res = await app.request(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    for (const setCookie of useJar ? res.headers.getSetCookie() : []) {
      const [pair = ""] = setCookie.split(";");
      const [name = "", value = ""] = pair.split("=");
      if (/max-age=0/i.test(setCookie) || value === "") jar.delete(name);
      else jar.set(name, value);
    }

    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as unknown) : null };
  }

  /** 通过 API 创建文章（测试数据也走真实的写入路径） */
  async function createPost(input: Partial<PostCreateInput> & { slug: string }) {
    const res = await request("POST", "/admin/posts", {
      body: { title: input.slug, contentMd: `${input.slug} 的正文。`, ...input },
    });
    if (res.status !== 201) throw new Error(`createPost failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { id: number; slug: string; publishedAt: string | null };
  }

  /**
   * 以某个 GitHub 用户走完整的登录流程，返回评论者 cookie（从 jar 里取走，
   * 这样同一个测试里可以有多个评论者，各自用 headers.cookie 传入）。
   */
  async function loginCommenter(user: GitHubUser, next = "/") {
    const start = await request("GET", `/auth/github/start?next=${encodeURIComponent(next)}`, { auth: false });
    const authorizeUrl = start.headers.get("location") ?? "";
    const state = new URL(authorizeUrl).searchParams.get("state") ?? "";
    const code = fakeGitHub.approve(authorizeUrl, user);
    const callback = await request("GET", `/auth/github/callback?${new URLSearchParams({ code, state })}`, { auth: false });
    const token = jar.get("__Host-commenter");
    jar.delete("__Host-commenter");
    if (!token) throw new Error(`login failed: ${callback.status} ${callback.headers.get("location")}`);
    return `__Host-commenter=${token}`;
  }

  return { db, app, redis, storage, request, loginCommenter, fakeGitHub, createPost, adminSessionCookie, jar, calls: fake.calls, revalidations };
}
