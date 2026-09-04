import { UPSTREAM_API, OAUTH_RESOURCE } from "./config";
import { SITE } from "./site";

/**
 * Authorization Code + PKCE。
 *
 * 這是個瀏覽器應用，屬於 public client：沒有 client secret，也不能有——原始碼是公開的。
 * 安全性靠 PKCE 與 redirect_uri 比對，不靠藏密鑰。
 *
 * client_id 用動態註冊（RFC 7591）取得並存在本機，所以任何人 fork 這個站、換個網域
 * 部署都能直接跑，不必先來跟我們登記。
 */

const STORE = {
  client: "lt.oauth.client",
  verifier: "lt.oauth.verifier",
  state: "lt.oauth.state",
  refresh: "lt.oauth.refresh",
  returnTo: "lt.oauth.return_to",
} as const;

const redirectUri = () => `${location.origin}/auth/callback`;

function randomString(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function clientId(): Promise<string> {
  const cached = localStorage.getItem(STORE.client);
  if (cached) return cached;

  const res = await fetch(`${UPSTREAM_API}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: SITE.clientName,
      redirect_uris: [redirectUri()],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok) throw new Error(`動態註冊失敗（${res.status}）`);
  const id = ((await res.json()) as { client_id?: string }).client_id;
  if (!id) throw new Error("動態註冊沒有回傳 client_id");
  localStorage.setItem(STORE.client, id);
  return id;
}

export async function beginLogin(returnTo: string): Promise<void> {
  const verifier = randomString();
  const state = randomString(16);
  sessionStorage.setItem(STORE.verifier, verifier);
  sessionStorage.setItem(STORE.state, state);
  sessionStorage.setItem(STORE.returnTo, returnTo);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: await clientId(),
    redirect_uri: redirectUri(),
    state,
    code_challenge: await s256(verifier),
    code_challenge_method: "S256",
    resource: OAUTH_RESOURCE,
  });
  location.assign(`${UPSTREAM_API}/oauth/authorize?${params}`);
}

export interface TokenPair {
  accessToken: string;
  expiresAt: number;
}

async function exchange(body: Record<string, string>): Promise<TokenPair> {
  const res = await fetch(`${UPSTREAM_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, client_id: await clientId(), resource: OAUTH_RESOURCE }),
  });
  if (!res.ok) throw new Error(`換取 token 失敗（${res.status}）`);
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  if (data.refresh_token) localStorage.setItem(STORE.refresh, data.refresh_token);
  return {
    accessToken: data.access_token,
    // 提早 60 秒視為過期，避免請求正好卡在邊界上。
    expiresAt: Date.now() + Math.max(0, (data.expires_in ?? 3600) - 60) * 1000,
  };
}

export async function completeLogin(query: URLSearchParams): Promise<{ token: TokenPair; returnTo: string }> {
  const error = query.get("error");
  if (error) throw new Error(`授權被拒（${error}）`);

  const code = query.get("code");
  const state = query.get("state");
  const expectedState = sessionStorage.getItem(STORE.state);
  const verifier = sessionStorage.getItem(STORE.verifier);
  sessionStorage.removeItem(STORE.state);
  sessionStorage.removeItem(STORE.verifier);

  if (!code) throw new Error("回調沒有帶授權碼");
  // state 對不上代表這次回調不是本頁發起的，直接丟掉。
  if (!state || state !== expectedState) throw new Error("授權狀態不符，請重新登入");
  if (!verifier) throw new Error("找不到本次登入的驗證碼，請重新登入");

  const token = await exchange({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const returnTo = sessionStorage.getItem(STORE.returnTo) || "/";
  sessionStorage.removeItem(STORE.returnTo);
  return { token, returnTo };
}

/** 重新整理後靠 refresh token 靜默恢復登入狀態。 */
export async function refresh(): Promise<TokenPair | null> {
  const refreshToken = localStorage.getItem(STORE.refresh);
  if (!refreshToken) return null;
  try {
    return await exchange({ grant_type: "refresh_token", refresh_token: refreshToken });
  } catch {
    localStorage.removeItem(STORE.refresh);
    return null;
  }
}

export function forgetSession(): void {
  localStorage.removeItem(STORE.refresh);
}
