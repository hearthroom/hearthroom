/**
 * Harbor 應用獎勵（簽到、開箱、任務、新手七日）的用戶端。
 *
 * 合約：docs/technical-design/AppRewards_TechnicalDesign_20261019_V0.2.md §10（V0.2d）。
 * 規則、進度、抽獎、發點全在 Harbor；這裡只讀面板、送領取，畫面依回應畫。
 * 獎表與機率只從公開方案端點讀，語系檔與程式不寫任何機率或金額（LunaTalk 三端各存一份的教訓）。
 */
import { UPSTREAM_API } from "./config";
import { i18n } from "./i18n";
import { describeApiError } from "./api";

/**
 * 綺夢社在 Harbor 的應用租戶 slug（`/open/v1/apps/{app}/…` 的那一段）。
 * Harper 研發 2026-10-19：B3 上線時確認實際值；在那之前用 hearthroom，可用 VITE_HARBOR_APP 覆寫。
 */
export const REWARDS_APP: string = import.meta.env.VITE_HARBOR_APP || "hearthroom";

export interface PlanPrize { tier: number; credits?: number; item?: string; bps: number }
export interface PlanChest { prizes: PlanPrize[]; expectedValue?: number }
export interface RewardPlan {
  version: number;
  updatedAt: string;
  drawRetentionDays: number;
  timezone: string;
  dayStartHour: number;
  chests: Record<string, PlanChest>;
  pity?: { threshold: number; every: number; chests: string[] };
  checkin?: { cycle: string[]; milestones?: { at: number; chest: string }[]; makeupPerMonth?: number; makeupWindowDays?: number };
}

export type ClaimStatus = "granted" | "pending" | "not_granted";
export interface ClaimResult {
  rewardKey: string;
  status: ClaimStatus;
  releaseAt?: string;
  chest?: string;
  prizeIndex?: number;
  tier?: number;
  planVersion?: number;
  stripSeed?: number;
  stripVersion?: number;
  credits?: number;
  item?: string;
  duplicate?: boolean;
  expiresAt?: string;
  pityRemaining?: number;
}

export type TrackStatus = "claimed" | "made_up" | "missed" | "today" | "future";
export interface TrackCell { day: string; chest: string; status: TrackStatus }

export type TaskStatus = "locked" | "claimable" | "claimed" | "pending" | "not_granted" | "unavailable";
export interface RewardTask {
  id: string;
  type: string;
  progress: number;
  target: number;
  reward: { credits?: number; chest?: string };
  status: TaskStatus;
  period: string;
  /** 留言任務的字數門檻：主要用中日韓文字寫的看 cjk，其餘看 latin（契約 4eafb70） */
  minTextUnits?: { cjk: number; latin: number };
}

export interface NewcomerStage { stage: number; credits?: number; chest?: string; done: boolean }
export interface Newcomer {
  active: boolean;
  stage: number;
  deadline: string | null;
  today: { stage: number; goal: string; progress: number; target: number; status: TaskStatus };
  stages: NewcomerStage[];
}

export interface RewardsPanel {
  serverNow: string;
  businessDay: string;
  nextResetAt: string;
  weekResetAt: string;
  planVersion: number;
  checkin: {
    streak: number;
    todayClaimed: boolean;
    todayChests: string[];
    fallback: { from: number; checkpoint: number; to: number } | null;
    track: TrackCell[];
    nextMilestone: { day: number; chest: string; inDays: number } | null;
    makeup: { left: number; repairableDays: { day: string; deadline: string }[] };
  };
  pityRemaining?: number;
  today: { claims: ClaimResult[] };
  tasks: { daily: RewardTask[]; weekly: RewardTask[]; dailyAll?: RewardTask | null };
  newcomer: Newcomer | null;
  credits?: { expiring: { amount: number; expiresAt: string }[] };
  hints: string[];
}

export interface DrawRecord {
  at: string;
  rewardKind: string;
  chest: string;
  prizeIndex?: number;
  tier?: number;
  planVersion?: number;
  stripSeed?: number;
  stripVersion?: number;
  credits?: number;
  item?: string;
  duplicate?: boolean;
  expiresAt?: string;
  releaseAt?: string;
  pity?: boolean;
  status: ClaimStatus;
}

export interface CheckinResponse { claims: ClaimResult[]; streak: number; replayed: boolean }

/** 錯誤碼是 Harbor 的穩定碼；畫面依碼分情況，不看訊息文字。 */
export class RewardsError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly reason = "",
    /** already_claimed 附上的原結果：簽到與補簽是 claims，任務與新手是 claim */
    readonly claims: ClaimResult[] = [],
  ) {
    super(message);
  }
}

const authHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${UPSTREAM_API}/open/v1${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; reason?: string; claims?: ClaimResult[]; claim?: ClaimResult };
    const code = body.error ?? "";
    throw new RewardsError(res.status, describeApiError(res.status, code), code, body.reason ?? "", body.claims ?? (body.claim ? [body.claim] : []));
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, token: string, body: unknown) =>
  call<T>(path, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(token) }, body: JSON.stringify(body) });

const planCache = new Map<number | "current", Promise<RewardPlan>>();

/** 公開方案（免登入、可快取）。指定 version 讀舊版本，抽取紀錄才能照當時的獎表重現滾輪。 */
export function fetchPlan(version?: number): Promise<RewardPlan> {
  const key = version ?? "current";
  let hit = planCache.get(key);
  if (!hit) {
    const q = version != null ? `?version=${version}` : "";
    hit = call<RewardPlan>(`/apps/${encodeURIComponent(REWARDS_APP)}/rewards/plan${q}`);
    hit.catch(() => planCache.delete(key));
    planCache.set(key, hit);
  }
  return hit;
}
/** 面板的 planVersion 和手上的方案不同時呼叫，下一次讀到新版。 */
export function forgetCurrentPlan(): void { planCache.delete("current"); }

export const fetchPanel = (token: string) => call<RewardsPanel>("/me/rewards", { headers: authHeaders(token) });

export const checkin = (token: string, requestId: string, deviceToken?: string) =>
  post<CheckinResponse>("/me/rewards/checkin", token, { requestId, ...(deviceToken ? { deviceToken } : {}) });

export const makeup = (token: string, requestId: string, day: string, deviceToken?: string) =>
  post<CheckinResponse>("/me/rewards/makeup", token, { requestId, day, ...(deviceToken ? { deviceToken } : {}) });

export const claimTask = (token: string, taskId: string, period: string, requestId: string, deviceToken?: string) =>
  post<{ claim: ClaimResult }>(`/me/rewards/tasks/${encodeURIComponent(taskId)}/claim`, token, { requestId, period, ...(deviceToken ? { deviceToken } : {}) });

export const claimNewcomer = (token: string, requestId: string, deviceToken?: string) =>
  post<{ claim: ClaimResult }>("/me/rewards/newcomer/claim", token, { requestId, ...(deviceToken ? { deviceToken } : {}) });

export const fetchDraws = (token: string, cursor = "") =>
  call<{ list: DrawRecord[]; nextCursor: string | null }>(`/me/rewards/draws${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: authHeaders(token) });

export const fetchItems = (token: string) => call<{ items: { key: string; grantedAt: string }[] }>("/me/rewards/items", { headers: authHeaders(token) });

/** 一般的領取失敗句（網路、伺服器、逾時）。等待與冪等由呼叫端處理。 */
export const genericClaimError = (): string => i18n.global.t("checkin.stage.error.body");
