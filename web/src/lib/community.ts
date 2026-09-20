import { COMMUNITY_API } from "./config";
import { currentProvider } from "./provider";
import { ApiError } from "./api";
import { i18n } from "./i18n";
export interface CommunityView {
  enabled: boolean;
  invite: string | null;
  link: { name: string; state: string } | null;
  xp: number;
  level: number;
  badges: string[];
  xpEnabled: boolean;
  preferences: {
    public_badges: number;
    notifications: number;
    discord_dm: number;
    case_access: number;
  };
}
export interface CommunityNotice {
  id: string;
  kind: string;
  path: string;
  created_at: number;
  read_at: number | null;
}
export interface CommunityCase {
  id: string;
  title: string;
  category: string;
  state: string;
  version: number;
  createdAt: number;
  locked: boolean;
  archived: boolean;
  resolution: string | null;
  events: { kind: string; body: string; seq: number }[];
  conversation: string | null;
}
export async function communityRequest<T>(
  path: string,
  token?: string | null,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(COMMUNITY_API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Provider": currentProvider(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
  });
  const result = await response.json();
  if (!response.ok) {
    const code = typeof result.error === "string" ? result.error : "";
    const key =
      code === "community_link_conflict"
        ? "conflict"
        : code === "community_expired"
          ? "expired"
          : code === "community_case_link_required"
            ? "caseConsent"
            : response.status === 429
              ? "rateLimited"
              : "failed";
    throw new ApiError(
      response.status,
      i18n.global.t("community." + key),
      code,
    );
  }
  return result as T;
}
export function captureDiscordReturn() {
  const hash = new URLSearchParams(location.hash.slice(1)),
    receipt = hash.get("discord_receipt"),
    error = hash.get("discord_error");
  if (!receipt && !error) return;
  if (receipt) sessionStorage.setItem("community.discord.receipt", receipt);
  if (error) sessionStorage.setItem("community.discord.error", error);
  let target = location.pathname + location.search;
  const saved = sessionStorage.getItem("community.discord.return");
  sessionStorage.removeItem("community.discord.return");
  if (saved) {
    try {
      const url = new URL(saved, location.origin);
      if (
        url.origin === location.origin &&
        /^\/(?:en\/|ja\/|ko\/|zh-Hans\/)?me$/.test(url.pathname)
      )
        target = url.pathname + url.search;
    } catch {
      /* Keep the fixed callback page. */
    }
  }
  history.replaceState(history.state, "", target);
}
async function requestKey(scope: string, input: unknown) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(scope + ":" + JSON.stringify(input)),
  );
  return (
    "community.case." +
    Array.from(new Uint8Array(hash), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("")
  );
}
export async function communityRequestId(scope: string, input: unknown) {
  const key = await requestKey(scope, input),
    now = Date.now();
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const k = sessionStorage.key(i)!;
    if (k.startsWith("community.case.")) {
      try {
        if (JSON.parse(sessionStorage.getItem(k)!).expires < now)
          sessionStorage.removeItem(k);
      } catch {
        sessionStorage.removeItem(k);
      }
    }
  }
  const saved = sessionStorage.getItem(key);
  if (saved) return JSON.parse(saved).id as string;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, JSON.stringify({ id, expires: now + 86400000 }));
  return id;
}
export async function forgetCommunityRequest(scope: string, input: unknown) {
  sessionStorage.removeItem(await requestKey(scope, input));
}
export function takeDiscordReceipt() {
  const receipt = sessionStorage.getItem("community.discord.receipt");
  sessionStorage.removeItem("community.discord.receipt");
  return receipt;
}
