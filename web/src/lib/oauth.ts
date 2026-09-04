import { UPSTREAM_API, OAUTH_RESOURCE } from "./config";
import { i18n } from "./i18n";
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
  client: "taproom.oauth.client",
  verifier: "taproom.oauth.verifier",
  state: "taproom.oauth.state",
  refresh: "taproom.oauth.refresh",
  access: "taproom.oauth.access",
  returnTo: "taproom.oauth.return_to",
} as const;

const redirectUri = () => `${location.origin}/auth/callback`;

/** 這些錯誤會直接顯示給使用者。檔案在 Vue 元件外，所以用 global 而不是 useI18n()。 */
const t = (key: string, named?: Record<string, unknown>) =>
  named ? i18n.global.t(key, named) : i18n.global.t(key);

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
  if (!res.ok) throw new Error(t("auth.registerFailed", { status: res.status }));
  const id = ((await res.json()) as { client_id?: string }).client_id;
  if (!id) throw new Error(t("auth.noClientId"));
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
  /** epoch ms。存起來，重新整理後還沒過期就直接用，不必多跑一次換發。 */
  expiresAt: number;
}

/** 換發失敗時要不要把憑證丟掉——只有伺服器明確說「這張不算數」才丟。 */
export class AuthExpired extends Error {}

async function exchange(body: Record<string, string>): Promise<TokenPair> {
  const res = await fetch(`${UPSTREAM_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, client_id: await clientId(), resource: OAUTH_RESOURCE }),
  });
  if (!res.ok) {
    // 4xx 是「這張憑證不算數」，5xx 與斷網是「現在問不到」。只有前者該把人登出——
    // 把兩者混為一談，會讓一次網路抖動變成強制重新登入。
    if (res.status >= 400 && res.status < 500) throw new AuthExpired(t("auth.credentialExpired", { status: res.status }));
    throw new Error(t("auth.exchangeFailed", { status: res.status }));
  }
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
  if (error) throw new Error(t("auth.denied", { error }));

  const code = query.get("code");
  const state = query.get("state");
  const expectedState = sessionStorage.getItem(STORE.state);
  const verifier = sessionStorage.getItem(STORE.verifier);
  sessionStorage.removeItem(STORE.state);
  sessionStorage.removeItem(STORE.verifier);

  if (!code) throw new Error(t("auth.noCode"));
  // state 對不上代表這次回調不是本頁發起的，直接丟掉。
  if (!state || state !== expectedState) throw new Error(t("auth.badState"));
  if (!verifier) throw new Error(t("auth.noVerifier"));

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

/**
 * 換一顆新的 access token。
 *
 * **同一時間只能有一個在飛。** refresh token 是一次性的，伺服器把重複使用視為重放
 * 並且直接把整個 session 標成 revoked——所以兩個並發的換發不是「多跑一次」，
 * 是「兩個都死」。並發的呼叫者共用同一個 Promise。
 */
let inFlight: Promise<TokenPair | null> | null = null;

export function refresh(): Promise<TokenPair | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const refreshToken = localStorage.getItem(STORE.refresh);
    if (!refreshToken) return null;
    try {
      return await exchange({ grant_type: "refresh_token", refresh_token: refreshToken });
    } catch (err) {
      // 只有伺服器明確拒絕才清掉憑證；網路問題留著，下次再試。
      if (err instanceof AuthExpired) forgetSession();
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * 把目前的憑證存起來 / 讀回來。
 *
 * access token 跟 refresh token 一起放 localStorage：兩者的暴露面本來就一樣，
 * 而 refresh token 權限更大（能無限換新的）。只藏 access token 擋不住任何攻擊，
 * 卻讓每次重新整理都得多跑一次換發——而每次換發都是一次輪替，也就是一次出錯的機會。
 */
export function persist(pair: TokenPair): void {
  try {
    localStorage.setItem(STORE.access, JSON.stringify(pair));
  } catch {
    /* 隱私模式寫不進去，退回每次換發 */
  }
}

export function restorePersisted(): TokenPair | null {
  try {
    const raw = localStorage.getItem(STORE.access);
    if (!raw) return null;
    const pair = JSON.parse(raw) as TokenPair;
    return pair.accessToken && pair.expiresAt > Date.now() ? pair : null;
  } catch {
    return null;
  }
}

export function forgetSession(): void {
  localStorage.removeItem(STORE.refresh);
  localStorage.removeItem(STORE.access);
}

/** 登出時順手告訴伺服器把 refresh token 作廢，不要留一顆到過期為止都還能用的憑證。 */
export async function revokeSession(): Promise<void> {
  const refreshToken = localStorage.getItem(STORE.refresh);
  forgetSession();
  if (!refreshToken) return;
  try {
    await fetch(`${UPSTREAM_API}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken, client_id: await clientId() }),
    });
  } catch {
    // 本地憑證已經清掉，撤銷失敗只是伺服器那顆會留到過期，不影響使用者。
  }
}
