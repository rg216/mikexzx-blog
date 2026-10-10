import { createHash } from "node:crypto";
import { z } from "zod";

/*
 * GitHub 登录（OAuth 2.0 授权码流程 + PKCE），只用来确认"你是哪个 GitHub 用户"：
 *   1. 把浏览器送到 GitHub 的授权页，带上 state（防 CSRF）和 code_challenge（PKCE）
 *   2. 用户同意后 GitHub 带着 code 跳回我们的回调地址
 *   3. 服务端用 code + code_verifier + client_secret 换 access token，再用它读 /user
 * token 用完即弃，不存：我们只要身份，不代表用户调用 GitHub 的任何接口。
 */

export type GitHubConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type GitHubUser = { id: number; login: string; name: string | null; avatarUrl: string };

export class GitHubError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitHubError";
  }
}

const userSchema = z.object({
  id: z.int().positive(),
  login: z.string().min(1),
  name: z.string().nullable(),
  avatar_url: z.url(),
});

const tokenSchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string(), error_description: z.string().optional() }),
]);

const API_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2026-03-10",
  // GitHub API 要求带 User-Agent
  "user-agent": "mikexxz-blog",
};
const TIMEOUT_MS = 8000;

/** PKCE：code_challenge = base64url(SHA-256(code_verifier)) */
export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function toUser(data: z.infer<typeof userSchema>): GitHubUser {
  return { id: data.id, login: data.login, name: data.name || null, avatarUrl: data.avatar_url };
}

export function createGitHub(config: GitHubConfig, fetchImpl: typeof fetch = fetch) {
  async function request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new GitHubError(`request to ${new URL(url).pathname} failed`, { cause: error });
    }
  }

  async function readUser(res: Response): Promise<GitHubUser> {
    const parsed = userSchema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new GitHubError("unexpected /user response", { cause: parsed.error });
    return toUser(parsed.data);
  }

  return {
    /** GitHub 授权页地址。不申请任何权限（scope 留空）：只能读到公开资料 */
    authorizeUrl(state: string, codeVerifier: string): string {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        state,
        code_challenge: codeChallengeFor(codeVerifier),
        code_challenge_method: "S256",
        allow_signup: "false",
        // 总是先显示 GitHub 的账号选择页：否则用户在 GitHub 上已登录且授权过时会被静默登录回同一个账号，
        // 在本站"退出"后再点登录就换不了账号
        prompt: "select_account",
      }).toString();
      return url.toString();
    },

    /** 用授权码换 access token */
    async exchangeCode(code: string, codeVerifier: string): Promise<string> {
      const res = await request("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "user-agent": API_HEADERS["user-agent"] },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      // 注意：授权码无效时 GitHub 也返回 200，错误在响应体里
      const parsed = tokenSchema.safeParse(await res.json().catch(() => undefined));
      if (!res.ok || !parsed.success) throw new GitHubError(`token exchange failed: HTTP ${res.status}`);
      if ("error" in parsed.data) throw new GitHubError(`token exchange failed: ${parsed.data.error}`);
      return parsed.data.access_token;
    },

    /** 当前登录用户的公开资料 */
    async fetchUser(accessToken: string): Promise<GitHubUser> {
      const res = await request("https://api.github.com/user", { headers: { ...API_HEADERS, authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new GitHubError(`GET /user: HTTP ${res.status}`);
      return readUser(res);
    },

    /** 按用户名查公开资料（管理员把还没来评论过的人加进白名单时用）；不存在返回 null */
    async fetchUserByLogin(login: string): Promise<GitHubUser | null> {
      const res = await request(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers: API_HEADERS });
      if (res.status === 404) return null;
      if (!res.ok) throw new GitHubError(`GET /users/${login}: HTTP ${res.status}`);
      return readUser(res);
    },
  };
}

export type GitHub = ReturnType<typeof createGitHub>;
