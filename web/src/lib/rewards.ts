/**
 * Harbor 應用獎勵（簽到、開箱、任務、新手七日）的用戶端。
 *
 * 合約：docs/technical-design/AppRewards_TechnicalDesign_20261019_V0.2.md §10（V0.2d）。
 * 規則、進度、抽獎、發點全在 Harbor；這裡只讀面板、送領取，畫面依回應畫。
 * 獎表與機率只從公開方案端點讀，語系檔與程式不寫任何機率或金額（LunaTalk 三端各存一份的教訓）。
 */
import { deviceToken } from "./reward-device";
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
  checkin?: { cycle: string[]; milestones?: { at: number; chest: string }[]; milestoneCycle?: number; makeupPerMonth?: number; makeupWindowDays?: number };
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

/** 新手七日的一階（契約 53298e1）。reward 裡 credits 與 chest 恰好一個。 */
export type NewcomerGoal = "turns" | "return_turns" | "new_work_turns" | "comment_or_rating" | "customize" | "share_link" | "final";
export interface NewcomerStage { stage: number; goal: NewcomerGoal; target: number; reward: { credits?: number; chest?: string }; status: TaskStatus }
/** 這一階做完了：已發，或已領、還在發放中 */
export const stageDone = (s: NewcomerStage): boolean => s.status === "claimed" || s.status === "pending";
export interface Newcomer {
  active: boolean;
  stage: number;
  deadline: string | null;
  today: { stage: number; goal: string; progress: number; target: number; status: TaskStatus };
  stages: NewcomerStage[];
}

export interface RewardsPanel {
  /** Read-only test-account projection; stage progress does not imply reward grants. */
  testFixture?: boolean;
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

/**
 * 簽到時 Harbor 先代領月卡（期間方案），結果附在簽到的每一種回應上（p5-contract §1）。
 * unavailable：月卡沒領到、簽到照常，稍後打 claimPlan 補領。舊伺服器不帶這個欄位。
 */
export interface PeriodPlanOutcome { status: "granted" | "revoked" | "none" | "unavailable"; day?: string; credits?: number; bonusCredits?: number; replayed?: boolean }

export interface CheckinResponse { claims: ClaimResult[]; streak: number; replayed: boolean; periodPlan?: PeriodPlanOutcome }

/** 錯誤碼是 Harbor 的穩定碼；畫面依碼分情況，不看訊息文字。 */
export class RewardsError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly reason = "",
    /** already_claimed 附上的原結果：簽到與補簽是 claims，任務與新手是 claim */
    readonly claims: ClaimResult[] = [],
    /** 簽到的錯誤回應也帶月卡的代領結果 */
    readonly periodPlan?: PeriodPlanOutcome,
  ) {
    super(message);
  }
}

const authHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });


async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${UPSTREAM_API}/open/v1${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; reason?: string; claims?: ClaimResult[]; claim?: ClaimResult; periodPlan?: PeriodPlanOutcome };
    const code = body.error ?? "";
    throw new RewardsError(res.status, describeApiError(res.status, code), code, body.reason ?? "", body.claims ?? (body.claim ? [body.claim] : []), body.periodPlan);
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

export const fetchPanel = (token: string) => call<RewardsPanel>("/me/rewards", { headers: { ...authHeaders(token), "X-Device-Token": deviceToken() } });

export const checkin = (token: string, requestId: string, device = deviceToken()) =>
  post<CheckinResponse>("/me/rewards/checkin", token, { requestId, deviceToken: device });

export const makeup = (token: string, requestId: string, day: string, device = deviceToken()) =>
  post<CheckinResponse>("/me/rewards/makeup", token, { requestId, day, deviceToken: device });

export const claimTask = (token: string, taskId: string, period: string, requestId: string, device = deviceToken()) =>
  post<{ claim: ClaimResult }>(`/me/rewards/tasks/${encodeURIComponent(taskId)}/claim`, token, { requestId, period, deviceToken: device });

export const claimNewcomer = (token: string, requestId: string, device = deviceToken()) =>
  post<{ claim: ClaimResult }>("/me/rewards/newcomer/claim", token, { requestId, deviceToken: device });

export const fetchDraws = (token: string, cursor = "") =>
  call<{ list: DrawRecord[]; nextCursor: string | null }>(`/me/rewards/draws${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: authHeaders(token) });

export const fetchItems = (token: string) => call<{ items: { key: string; grantedAt: string }[] }>("/me/rewards/items", { headers: authHeaders(token) });

// ---- 月卡（期間方案）：Harbor 賣的一次性 30 天方案，不是應用的獎勵（p5-contract §1） ----
// 方案屬於帳號，購買只在 Console；這裡只讀規則與持有狀態、送當天的領取。

/** 販售中的方案與規則（免登入、可快取）。數字全部從這裡來，語系檔不寫。 */
export interface PeriodPlan {
  id: string;
  onSale: boolean;
  priceMicro: number;
  currency: string;
  credits: number;
  days: number;
  dailyCredits: number;
  /** 帳號第一張月卡每天多給的量，和 dailyCredits 一起領 */
  firstBonusDailyCredits: number;
  maxDays: number;
  makeupPerMonth: number;
  purchaseUrl: string;
}

/** 自己的持卡狀態。today.credits 是今天的總數，bonusCredits 是其中屬於第一張加倍的部分。 */
export interface MyPeriodPlan {
  id: string;
  businessDay: string;
  nextResetAt: string;
  active: boolean;
  endsOn: string | null;
  remainingDays: number;
  today: { status: "claimable" | "claimed" | "revoked" | "none"; credits: number; bonusCredits: number };
  canPurchase: boolean;
  purchaseBlockedReason: "not_on_sale" | "plan_limit" | "checkout_in_progress" | null;
  /** plan_limit 時最早可以再買的業務日 */
  purchasableFrom?: string | null;
  maxDays?: number;
  /** available：帳號還沒買過，下一張就是第一張；active：今天這張就是第一張；used；unavailable：版本沒有加倍 */
  firstBonus: { status: "available" | "active" | "used" | "unavailable"; dailyCredits?: number };
  firstBonusDailyCredits?: number;
  /** 方案的張數，不是剩下的；剩幾張只看簽到面板的 makeup.left */
  makeupPerMonth: number;
  badge?: string;
}

export interface PeriodPlanClaim { day: string; credits: number; bonusCredits: number; status: "granted" | "revoked"; replayed: boolean }

/** 契約說公開清單可以快取 5 分鐘：停售或購買網址改了，最晚 5 分鐘後畫面跟上 */
const PERIOD_PLANS_TTL = 5 * 60_000;
let periodPlans: Promise<{ list: PeriodPlan[] }> | null = null;
let periodPlansAt = 0;
/** 公開的方案清單（免登入）。失敗了下一次再讀。 */
export function fetchPeriodPlans(): Promise<{ list: PeriodPlan[] }> {
  if (!periodPlans || Date.now() - periodPlansAt > PERIOD_PLANS_TTL) {
    periodPlansAt = Date.now();
    periodPlans = call<{ list: PeriodPlan[] }>("/plans");
    periodPlans.catch(() => { periodPlans = null; });
  }
  return periodPlans;
}
export function forgetPeriodPlans(): void { periodPlans = null; }

export const fetchMyPeriodPlans = (token: string) => call<{ serverNow: string; list: MyPeriodPlan[] }>("/me/plans", { headers: authHeaders(token) });

export const claimPeriodPlan = (token: string, id: string, requestId: string) =>
  post<PeriodPlanClaim>(`/me/plans/${encodeURIComponent(id)}/claim`, token, { requestId });

/** 一般的領取失敗句（網路、伺服器、逾時）。等待與冪等由呼叫端處理。 */
export const genericClaimError = (): string => i18n.global.t("checkin.stage.error.body");
