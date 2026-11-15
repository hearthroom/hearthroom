import type { Rating } from "../shared/content-rating";
import { hostingKey } from "./hosting";
import { apiBaseOf, type ProviderId } from "./providers";
import { HttpError, type Env } from "./types";

export type WorkshopKind = "lore" | "display" | "opening";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toEpochMs(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return Math.trunc(n);
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
}

export async function ensureOperationUuid(raw: unknown): Promise<string> {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (UUID_RE.test(trimmed)) return trimmed.toLowerCase();
    if (trimmed) {
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`workshop-op:${trimmed}`)),
      );
      const bytes = digest.slice(0, 16);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    }
  }
  return crypto.randomUUID();
}

export interface ProviderMineItem {
 kind:"dlc"|"lorebook";
 loreCount:number;
 workshopClosed:boolean;
 status:"draft"|"live"|"live_changed";
  workshopId: string;
  workId: string;
  sourceRoleId: string;
  cardName?: string;
  name: string;
  summary: string;
  coverUrl: string;
  rating: Rating | null;
  kinds: WorkshopKind[];
  residentChars?: number;
  constantChars?: number;
  publishedVersion: number | null;
  publishedAt: number | string | null;
  moderationState: "draft" | "pending" | "approved" | "rejected" | "revoked";
  hasPendingRelease?: boolean;
  lastRejectNote: string | null;
  changedSincePublish: boolean;
  joinCount: number;
  ownerState: "visible" | "returned" | "hidden" | "hidden_by_owner";
  ownerReason: string | null;
  appeal: "pending" | "upheld" | "restored" | null;
  updatedAt: number | string;
}



export interface WorkshopStaffReleaseView {
  workshopId: string;
  releaseId: string;
  workId: string;
  sourceRoleId: string;
  authorPublicNo: number;
  cardOwnerPublicNo?: number;
  contentHash: string;
  residentChars: number;
  kinds: WorkshopKind[];
  contents: { loreCount: number; ruleCount: number; openingCount: number };
  publishedVersion?: number;
  sealed: {
    name: string;
    summary: string;
    readme: string;
    coverUrl: string;
    rating: string;
    ratingAnswers?: Record<string, unknown>;
    worldbook?: unknown[];
    rules?: unknown[];
    opening?: unknown;
    updateNote: string;
  };
}



export interface WorkshopStateItem {
  workshopId: string;
  moderationState: string;
  ownerState: string;
  viewerJoined?: boolean;
  viewerAccessible?: boolean;
}

export interface WorkshopOutboxEvent {
  seq?: number;
  eventKey?: string;
  kind: string;
  provider?: ProviderId;
  workId?: string;
  sourceRoleId?: string;
  workshopId?: string;
  payload?: Record<string, unknown> | null;
  allowNew?: boolean;
  revision?: number;
  reopened?: boolean;
  interestedPublicNos?: number[];
  action?: "return" | "hide" | "restore" | "revoke";
  ownerState?: string;
  moderationState?: string;
  reason?: string | null;
  generation?: number;
  ownerGeneration?: number;
  protectedJoinCutoffSeq?: number;
  authorPublicNo?: number;
  creatorNumId?: number;
  appealId?: string;
  ownerStateSnapshot?: string;
  ownerReasonSnapshot?: string | null;
  decision?: "upheld" | "restored" | "approved" | "rejected";
  releaseId?: string;
  version?: number;
  joinCount?: number;
  createdAt?: number | string;
}

async function callHosting<T>(
  env: Env,
  provider: ProviderId,
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const key = hostingKey(env, provider);
  if (!key) throw new HttpError(503, "hosting_unavailable");
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const response = await fetch(`${apiBaseOf(env, provider)}/open/v1/hosting/workshop${path}`, {
    method,
    headers: {
      "X-Hosting-Key": key,
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  return workshopResponse<T>(response);
}

async function workshopResponse<T>(response:Response):Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      code?: string;
      message?: string;
      detail?: Record<string, unknown>;
    } | null;
    const code = payload?.error || payload?.code || "workshop_upstream_failed";
    if (response.status >= 400 && response.status < 500) {
      throw new HttpError(
        response.status as 400 | 401 | 403 | 404 | 409 | 422,
        code,
        payload?.detail,
        payload?.message ? { message: payload.message } : undefined,
      );
    }
    throw new HttpError(503, "workshop_provider_unavailable");
  }
  return (await response.json()) as T;
}

export interface WorkshopPublicationReceipt {
 workshopId:string;releaseId:string;workId:string;sourceRoleId:string;kind:"dlc"|"lorebook";status:"published";
 version:number;draftRevision:number;publishedAt:number;contentHash:string;authorPublicNo:number;cardOwnerPublicNo:number;
 ownerState:string;ownerGeneration:number;residentChars:number;policyVersion:2;publicationRevision:number;
 sealed:{name:string;summary:string;readme:string;coverUrl:string;rating:string;worldbook?:Array<Record<string,unknown>>;rules?:Record<string,unknown>;opening?:Record<string,unknown>;updateNote?:string};
}

async function callCreator<T>(env:Env,token:string,path:string,body:unknown,provider:ProviderId):Promise<T>{
 const response=await fetch(`${apiBaseOf(env,provider)}/open/v1/workshop${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual',signal:AbortSignal.timeout(20_000)});
 return workshopResponse<T>(response);
}
const realUpstream = {
ownerAction:(env:Env,token:string,input:{workshopId:string;action:'hide'|'restore'},provider:ProviderId='harbor')=>callCreator<{ownerState:string;generation:number}>(env,token,'/owner-action',input,provider),
draftMetadata:(env:Env,token:string,workshopId:string,provider:ProviderId='harbor')=>callCreator<{workshopId:string;card:{cardId:string;roleId:string}}>(env,token,`/draft?workshopId=${encodeURIComponent(workshopId)}`,undefined,provider),
policyGet:(env:Env,token:string,roleId:string,provider:ProviderId='harbor')=>callCreator<Record<string,unknown>>(env,token,`/policy?roleId=${encodeURIComponent(roleId)}`,undefined,provider),
policySave:(env:Env,token:string,input:{roleId:string;allowNew:boolean;expectedRevision:number},provider:ProviderId='harbor')=>callCreator<Record<string,unknown>>(env,token,'/policy/save',input,provider),
creatorAction:async(env:Env,token:string,input:{workshopId:string;operationId:string;expectedRevision:number},action:'unpublish'|'discard-changes',provider:ProviderId='harbor')=>{
 const response=await fetch(`${apiBaseOf(env,provider)}/open/v1/workshop/${action}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),redirect:'manual',signal:AbortSignal.timeout(20_000)});
 return workshopResponse<Record<string,unknown>>(response);
 },
publish: async(env:Env,token:string,input:{workshopId:string;operationId:string;expectedRevision:number},provider:ProviderId="harbor")=>{
  const response=await fetch(`${apiBaseOf(env,provider)}/open/v1/workshop/publish`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(input),redirect:"manual",signal:AbortSignal.timeout(20_000)});
  return workshopResponse<WorkshopPublicationReceipt>(response);
 },
mine: (env: Env, token: string, provider: ProviderId = "harbor") =>
    callHosting<{ items: ProviderMineItem[] }>(env, provider, "/mine", { token }),
readRelease: (env: Env, releaseId: string, provider: ProviderId = "harbor") =>
    callHosting<WorkshopStaffReleaseView>(env, provider, `/staff-release/${encodeURIComponent(releaseId)}`),
moderate: (
    env: Env,
    input: { workshopId: string; action: "revoke" | "restore"; reason?: string; actorPublicNo?: number },
    provider: ProviderId = "harbor",
  ) => callHosting<{ ok?: boolean }>(env, provider, "/moderate", { body: input }),
state: (
    env: Env,
    query: { sourceRoleId?: string; workId?: string; workshopIds?: string[] },
    viewerToken?: string | null,
    provider: ProviderId = "harbor",
  ) => {
    const qs = new URLSearchParams();
    if (query.sourceRoleId) qs.set("sourceRoleId", query.sourceRoleId);
    if (query.workId) qs.set("workId", query.workId);
    if (query.workshopIds?.length) qs.set("workshopIds", query.workshopIds.join(","));
    return callHosting<{ allowNew?: boolean; policyRevision?: number; items: WorkshopStateItem[] }>(
      env,
      provider,
      `/state?${qs.toString()}`,
      { token: viewerToken ?? undefined },
    );
  },
pullOutbox: (env: Env, afterSeq: number, limit = 100, provider: ProviderId = "harbor") =>
    callHosting<{ events: WorkshopOutboxEvent[] }>(
      env,
      provider,
      `/outbox?afterSeq=${encodeURIComponent(String(afterSeq))}&limit=${encodeURIComponent(String(limit))}`,
    ),
ackOutbox: (env: Env, uptoSeq: number, provider: ProviderId = "harbor") =>
    callHosting<{ ok?: boolean }>(env, provider, "/outbox/ack", { body: { uptoSeq } })
};

export const workshopUpstream = { ...realUpstream };

export function restoreWorkshopUpstream(): void {
  Object.assign(workshopUpstream, realUpstream);
}
