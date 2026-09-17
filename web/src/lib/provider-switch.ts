import { COMMUNITY_API, useProviderUpstream } from "./config";
import { currentProvider, PROVIDERS, type ProviderId, providerName, setProvider } from "./provider";

/** Shared platform selection for login and account menus. Switching preserves other connections. */

/** 已經登入、而且點的是另一家時，才要先問過。點目前這家不算換。 */
export function needsSwitchConfirm(id: ProviderId, ctx: { signedIn: boolean }): boolean {
  return ctx.signedIn && id !== currentProvider();
}

export interface ChooseOptions {
  /** 開始那一家的 OAuth。 */
  login: () => Promise<void> | void;
  /** Kept for existing callers; platform switching never revokes another issuer. */
  logout?: () => Promise<void> | void;
  signedIn?: boolean;
}

/** Select the issuer before starting its OAuth flow. */
export async function chooseProvider(id: ProviderId, opts: ChooseOptions): Promise<void> {
  // Credentials are isolated by issuer; changing the active service does not revoke another connection.
  setProvider(id);
  // 上游位址是模組層的值，不會自己跟著換。漏了這一步，接下來的請求（包含 OAuth 授權頁）
  // 仍然打在上一家——線上出過這個錯：點第二家卻被送到第一家的登入頁。
  useProviderUpstream();
  await opts.login();
}

/**
 * 這個部署真的有哪幾家。伺服器說了算——前端寫死的話，沒配第二家的部署（包括自架的人）
 * 也會看到那顆按鈕，按下去每個請求都 400。
 *
 * 問不到就只給預設那家：寧可少一顆按鈕，也不要一顆按了就報錯的按鈕。
 */
export async function availableProviders(): Promise<{ id: ProviderId; name: string }[]> {
  const fallback = [{ id: "lunatalk" as ProviderId, name: providerName("lunatalk") }];
  try {
    const res = await fetch(`${COMMUNITY_API}/providers`,{signal:AbortSignal.timeout(10000)});
    if (!res.ok) return fallback;
    const body = (await res.json()) as { providers?: { id?: string }[] };
    const known = (body.providers ?? [])
      .map((p) => PROVIDERS.find((known) => known.id === p.id))
      .filter((p): p is (typeof PROVIDERS)[number] => !!p);
    return known.length ? known : fallback;
  } catch {
    return fallback;
  }
}
