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
  if (!token || expectedAccount === undefined) return token;
  return (await verifyAccount(provider, token, expectedAccount)) ? token : null;
}
async function result(res: Response) {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "connection_failed");
  return body;
}
export function connectAccount(provider: ProviderId, returnTo: string) {
  return beginLogin(returnTo, { provider, linkFrom: currentProvider() });
}
export async function finishConnection(
  provider: ProviderId,
  from: ProviderId,
  token: TokenPair,
  choice?: {keepHandle: string; sourceHandle: string; targetHandle: string | null}
): Promise<SiteMe> {
  const managed = await managedAuth();
  const source = managed ? null : await accountToken(from);
  if (!managed && !source) throw new Error("connection_source_expired");
  const profile = await result(
    await fetch("/v1/me/connections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(source ? {Authorization: `Bearer ${source}`} : {}),
        "X-Provider": from,
        ...(managed ? {"X-Hearthroom-Request":"1"} : {}),
      },
      body: JSON.stringify({ provider, token: token.accessToken, ...choice }),
    })
  );
  persist(token, provider);
  setProvider(from);
  useProviderUpstream();
  return profile;
}

export interface ConnectionAccount {
  provider: ProviderId;
  name: string;
  handle?: string;
  memberSince?: number;
}
export interface ConnectionPreview { source: ConnectionAccount; target: ConnectionAccount }
export async function previewConnection(provider: ProviderId, from: ProviderId, token: TokenPair): Promise<ConnectionPreview> {
  const managed=await managedAuth();
  const source = managed ? null : await accountToken(from);
  if (!managed && !source) throw new Error('connection_source_expired');
  return result(await fetch('/v1/me/connections/preview', {
    method: 'POST', headers: {'Content-Type':'application/json', ...(source?{Authorization:`Bearer ${source}`}:{'X-Hearthroom-Request':'1'}), 'X-Provider':from},
    body: JSON.stringify({provider, token:token.accessToken}),
  }));
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
    const value =
      provider === "harbor"
        ? b.available
        : typeof b.score === "number"
        ? b.score + (typeof b.tempScore === "number" ? b.tempScore : 0)
        : null;
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}
