import { managedAuth, MANAGED_TOKEN_REUSE_MS } from './managed-auth';
import {
  beginLogin,
  persist,
  refresh,
  restorePersisted,
  type TokenPair,
} from "./oauth";
import {
  apiBaseOf,
  currentProvider,
  setProvider,
  type ProviderId,
} from "./provider";
import { useProviderUpstream } from "./config";
import type { SiteMe } from "./api";
/**
 * 「這張 token 屬於這個帳號」的核對結果。內嵌聊天每個請求都會來要 token，
 * 同一張 token 核對過就不再每次問 /me；並發的呼叫共用同一趟。只記成功的核對。
 */
const verified = new Map<string, { at: number; check: Promise<boolean> }>();
export function forgetVerifiedAccount(provider: ProviderId): void {
  for (const key of verified.keys()) if (key.startsWith(`${provider}\n`)) verified.delete(key);
}
function verifyAccount(provider: ProviderId, token: string, expectedAccount: number): Promise<boolean> {
  const key = `${provider}\n${expectedAccount}\n${token}`;
  const hit = verified.get(key);
  if (hit && Date.now() - hit.at < MANAGED_TOKEN_REUSE_MS) return hit.check;
  const check = (async () => {
    try {
      const r = await fetch(`${apiBaseOf(provider)}/open/v1/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      return r.ok && Number((await r.json()).accountNumId) === expectedAccount;
    } catch {
      return false;
    }
  })();
  forgetVerifiedAccount(provider);
  verified.set(key, { at: Date.now(), check });
  void check.then((ok) => { if (!ok && verified.get(key)?.check === check) verified.delete(key); });
  return check;
}
export async function accountToken(
  provider: ProviderId,
  expectedAccount?: number
): Promise<string | null> {
  const managed=await managedAuth();
  // Managed mode reuses a server-issued token for a few minutes (managed-auth.ts); a grant replaced
  // on another device is picked up after that window or when the provider rejects the token.
  const token=(managed ? await refresh(provider) : restorePersisted(provider) ?? await refresh(provider))?.accessToken ?? null;
  // 託管模式的 token 是本站伺服器替這個成員換的：伺服器換發前後都核對過帳號仍歸他（issueToken），
  // 不必再跨洋問一次 /me。開「我的卡片」時這一趟串在讀清單前面，實測約 0.7 s（2026-09-26）。
  // 自架（非託管）模式的 token 存在瀏覽器裡，照舊核對。
  if (!token || expectedAccount === undefined || managed) return token;
  return (await verifyAccount(provider, token, expectedAccount)) ? token : null;
}
async function result(res: Response) {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "connection_failed");
  return body;
}
/** 這個失敗只要重新授權就能解：授權過期、或平台要求重新同意。 */
export function needsReauthorization(error: unknown): boolean {
  const code = error instanceof Error ? error.message : "";
  return code === "connection_source_expired" || code === "auth_reauthorization_required";
}
export function connectAccount(provider: ProviderId, returnTo: string) {
  return beginLogin(returnTo, { provider });
}
export async function connectedBalance(
  provider: ProviderId,
  expectedAccount: number
): Promise<number | null> {
  const token = await accountToken(provider);
  if (!token) return null;
  try {
    const me = await fetch(`${apiBaseOf(provider)}/open/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!me.ok || Number((await me.json()).accountNumId) !== expectedAccount)
      return null;
    const r = await fetch(`${apiBaseOf(provider)}/open/v1/me/wallet`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const b = await r.json();
    const value = b.available;
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}
