/**
 * 一次消費從哪些積分來源扣（任務 2026-11-14-ledger-group-per-turn，ui.md §3）。
 *
 * 伺服器把同一次消費的扣款合併成一列，`parts` 是依來源種類歸併後的金額（server-contract.md）。
 * 這裡把它換成要畫的來源清單：名字用錢包已有的說法，同一個名字的金額相加；
 * 只有兩種以上的來源才值得展開（同一種來源扣了很多批，玩家看到的仍是一行）。
 * 金額對不上總額（舊列、資料缺漏）就不展開，寧可照單列也不畫殘缺的組成。
 */
export interface LedgerPart { source: string; amount: number }
export interface LedgerPartRow { key: string; amount: number }

/** 來源代碼 → 錢包裡的名字（語系鍵）。不認得的代碼一律是「其他來源」，不顯示原始代碼。 */
const NAME: Record<string, string> = {
  purchase: "wallet.source.purchase",
  plan_daily: "wallet.reason.planDaily",
  plan_bonus: "wallet.reason.planBonus",
  checkin: "wallet.reason.checkin",
  task: "wallet.reason.task",
  newcomer: "wallet.reason.newcomer",
  referral: "wallet.reason.referral",
  signup: "wallet.reason.signup",
  campaign: "wallet.reason.campaign",
  grant: "wallet.reason.grant",
  redeem: "wallet.reason.redeem",
  rebate: "wallet.reason.rebate",
};
const OTHER = "wallet.source.other";
/** 同額時的固定順序（ui.md §3.4），其他來源永遠最後 */
const ORDER = ["purchase", "plan_daily", "plan_bonus", "checkin", "task", "newcomer", "referral", "signup", "campaign", "grant", "redeem", "rebate"].map((s) => NAME[s]!).concat(OTHER);

export function ledgerParts(parts: readonly LedgerPart[] | undefined, total: number): LedgerPartRow[] | null {
  if (!parts?.length) return null;
  const sums = new Map<string, number>();
  for (const part of parts) {
    const amount = Math.abs(Number(part.amount) || 0);
    if (!amount) continue;
    const key = NAME[part.source] ?? OTHER;
    sums.set(key, (sums.get(key) ?? 0) + amount);
  }
  if (sums.size < 2) return null;
  const rows = [...sums].map(([key, amount]) => ({ key, amount }));
  if (rows.reduce((n, r) => n + r.amount, 0) !== Math.abs(total)) return null;
  return rows.sort((a, b) => b.amount - a.amount || ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
}
