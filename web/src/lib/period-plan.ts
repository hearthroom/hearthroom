/**
 * 月卡在綺夢社的畫面判斷。純函式，不碰 DOM 與網路。
 * 規格：任務 2026-10-19-month-card-surfaces 的 ui.md §3.3（P0–P7）、§4.2–§4.4。
 * 月卡不是箱子：這裡算的是確定的入帳，和開箱舞台、機率無關（ui.md §0.1）。
 */
import type { MyPeriodPlan, PeriodPlan, PeriodPlanOutcome } from "./rewards";

/** 拿不到方案清單時的買卡網址（ui.md §4.4） */
export const FALLBACK_PURCHASE_URL = "https://console.harperharbor.com/me/billing?plan=month";

export type TodayLine =
  | { kind: "hidden" }
  /** withCheckin：還沒簽到，簽到時一起領；claimed：今天已領；claim：給「領取」按鈕（missed：剛才的代領沒成功） */
  | { kind: "withCheckin" | "claimed" | "claim"; credits: number; bonusCredits: number; missed: boolean };

export interface TodayContext {
  /** 今天簽到過了沒有；null＝不知道（錢包頁沒讀簽到面板） */
  checkedIn: boolean | null;
  /** 這次簽到回來的代領結果，會蓋過還沒重讀的 /me/plans */
  outcome?: PeriodPlanOutcome | null;
  /** 簽到回 unavailable、自動重試一次也失敗 */
  missed?: boolean;
}

/** 簽到頁的月卡列與錢包頁共用的「今天那一行」。 */
export function todayLine(plan: MyPeriodPlan | null | undefined, ctx: TodayContext): TodayLine {
  if (!plan?.active) return { kind: "hidden" };
  const today = plan.today;
  const outcome = ctx.outcome && (!ctx.outcome.day || ctx.outcome.day === plan.businessDay) ? ctx.outcome : null;
  // 退款收回的那一天不提「已收回」，整列不出現；退款的說明在 Console（ui.md §3.3 P6）
  if (outcome?.status === "revoked" || today.status === "revoked" || today.status === "none") return { kind: "hidden" };
  if (outcome?.status === "granted") return { kind: "claimed", credits: outcome.credits ?? today.credits, bonusCredits: outcome.bonusCredits ?? today.bonusCredits, missed: false };
  const amount = { credits: today.credits, bonusCredits: today.bonusCredits };
  if (today.status === "claimed") return { kind: "claimed", ...amount, missed: false };
  if (ctx.missed) return { kind: "claim", ...amount, missed: true };
  if (ctx.checkedIn === true) return { kind: "claim", ...amount, missed: false };
  return { kind: "withCheckin", ...amount, missed: false };
}

/** 連到 Console 帳單頁的月卡分段。網址照方案給的用，不加來源參數：Console 不提也不回連任何應用（ui.md v1.2 §4.4）。 */
export const purchaseLink = (plan: Pick<PeriodPlan, "purchaseUrl"> | null | undefined): string => plan?.purchaseUrl || FALLBACK_PURCHASE_URL;

/** 第一張月卡每天的總量（每日＋加倍的那一份）。 */
export const firstDaily = (plan: Pick<PeriodPlan, "dailyCredits" | "firstBonusDailyCredits">): number => plan.dailyCredits + (plan.firstBonusDailyCredits || 0);

/** 價格：照幣別格式，整數不帶小數。 */
export function planPrice(plan: Pick<PeriodPlan, "priceMicro" | "currency">, locale: string): string {
  const amount = plan.priceMicro / 1_000_000;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: plan.currency, minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 }).format(amount);
  } catch {
    return `${plan.currency} ${amount}`;
  }
}

/** 業務日（YYYY-MM-DD）以介面語言出月日，各語言順序不同，不寫死。 */
export function planDate(day: string, locale: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
