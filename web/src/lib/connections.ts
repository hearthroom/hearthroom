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
  token: string
): Promise<SiteMe> {
  const profile = await result(
    await fetch(`/v1/me/connections/${provider}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Provider": currentProvider(),
      },
    })
  );
  forgetSession(provider);
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
