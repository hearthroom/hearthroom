import { currentProvider, type ProviderId } from "./provider";
import { accountToken } from "./connections";
import { i18n } from "./i18n";
export interface CardCopy {
  provider: ProviderId;
  roleId: string | null;
  status: string;
  error?: string;
  updatedAt?: number;
}
export function connectionMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  const key = `linked.error.${code}`;
  return i18n.global.te(key)
    ? i18n.global.t(key)
    : i18n.global.t("linked.error.generic");
}
export function platformPath(path: string, provider: ProviderId): string {
  return `${path}${path.includes("?") ? "&" : "?"}provider=${provider}`;
}
export async function copies(
  roleId: string,
  provider: ProviderId
): Promise<CardCopy[]> {
  const token = await accountToken(provider);
  if (!token) throw new Error("connection_source_expired");
  const r = await fetch(`/v1/me/card-copies/${encodeURIComponent(roleId)}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Provider": provider },
  });
  if (!r.ok) throw new Error("sync_failed");
  return (await r.json()).copies;
}
export async function synchronize(
  roleId: string,
  sourceProvider: ProviderId,
  targetProvider: ProviderId,
  publish = false
): Promise<CardCopy> {
  const [sourceToken, targetToken, memberToken] = await Promise.all([
    accountToken(sourceProvider),
    accountToken(targetProvider),
    accountToken(currentProvider()),
  ]);
  if (!sourceToken || !targetToken || !memberToken)
    throw new Error("connection_source_expired");
  const r = await fetch("/v1/me/card-sync", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${memberToken}`,
      "X-Provider": currentProvider(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sourceProvider,
      sourceRoleId: roleId,
      sourceToken,
      targetProvider,
      targetToken,
      publish,
    }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || "sync_failed");
  return body;
}
