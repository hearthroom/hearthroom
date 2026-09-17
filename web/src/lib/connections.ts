import {
  beginLogin,
  forgetSession,
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
export async function accountToken(
  provider: ProviderId,
  expectedAccount?: number
): Promise<string | null> {
  const token =
    (restorePersisted(provider) ?? (await refresh(provider)))?.accessToken ??
    null;
  if (!token || expectedAccount === undefined) return token;
  try {
    const r = await fetch(`${apiBaseOf(provider)}/open/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    return r.ok && Number((await r.json()).accountNumId) === expectedAccount
      ? token
      : null;
  } catch {
    return null;
  }
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
  const source = await accountToken(from);
  if (!source) throw new Error("connection_source_expired");
  const profile = await result(
    await fetch("/v1/me/connections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${source}`,
        "X-Provider": from,
      },
      body: JSON.stringify({ provider, token: token.accessToken, ...choice }),
    })
  );
  persist(token, provider);
  setProvider(from);
  useProviderUpstream();
  return profile;
}
export async function disconnectAccount(
  provider: ProviderId,
  token: string,
  identities: SiteMe["identities"] = []
): Promise<SiteMe> {
  let issuer = currentProvider();
  if (issuer === provider) {
    const remaining = identities.find(i => i.provider !== provider);
    if (!remaining) throw new Error("cannot_disconnect_current_account");
    issuer = remaining.provider as ProviderId;
    const proof = await accountToken(issuer, remaining.externalId);
    if (!proof) throw new Error("connection_source_expired");
    token = proof;
  }
  const profile = await result(
    await fetch(`/v1/me/connections/${provider}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Provider": issuer,
      },
    })
  );
  forgetSession(provider);
  if(currentProvider()===provider) {setProvider(issuer);useProviderUpstream()}
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
  const source = await accountToken(from);
  if (!source) throw new Error('connection_source_expired');
  return result(await fetch('/v1/me/connections/preview', {
    method: 'POST', headers: {'Content-Type':'application/json', Authorization:`Bearer ${source}`, 'X-Provider':from},
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
