// 月卡（期間方案）在綺夢社的判斷：今天那一行要畫什麼、買卡連結、第一張每天的量。
// 規格：任務 2026-10-19-month-card-surfaces 的 ui.md §3.3（P0–P7）、§4.2–§4.4；契約 p5-contract §1。
import { describe, expect, it } from "vitest";
import { firstDaily, planPrice, purchaseLink, todayLine } from "../src/lib/period-plan";
import type { MyPeriodPlan, PeriodPlan } from "../src/lib/rewards";

const offer: PeriodPlan = {
  id: "month", onSale: true, priceMicro: 5_000_000, currency: "USD", credits: 30000, days: 30, dailyCredits: 500,
  firstBonusDailyCredits: 500, maxDays: 180, makeupPerMonth: 3, purchaseUrl: "https://console.example/me/billing?plan=month",
};
const mine = (over: Partial<MyPeriodPlan> = {}): MyPeriodPlan => ({
  id: "month", businessDay: "2026-10-20", nextResetAt: "2026-10-20T20:00:00Z", active: true, endsOn: "2026-11-18", remainingDays: 30,
  today: { status: "claimable", credits: 1000, bonusCredits: 500 }, canPurchase: true, purchaseBlockedReason: null,
  firstBonus: { status: "active" }, makeupPerMonth: 3, badge: "plan_month", ...over,
});

describe("今天那一行", () => {
  it("沒有卡、讀不到、清單是空的：整列不出現（P1、P7）", () => {
    expect(todayLine(null, { checkedIn: false })).toEqual({ kind: "hidden" });
    expect(todayLine(mine({ active: false, today: { status: "none", credits: 0, bonusCredits: 0 } }), { checkedIn: false })).toEqual({ kind: "hidden" });
  });

  it("持卡、今天還沒簽到：簽到時一起領，數字是今天的總數（P2）", () => {
    expect(todayLine(mine(), { checkedIn: false })).toEqual({ kind: "withCheckin", credits: 1000, bonusCredits: 500, missed: false });
  });

  it("不知道今天簽到過沒有：照「簽到時一起領」寫，不放按鈕（§4.2）", () => {
    expect(todayLine(mine(), { checkedIn: null }).kind).toBe("withCheckin");
  });

  it("今天已領：已領（P3）", () => {
    expect(todayLine(mine({ today: { status: "claimed", credits: 500, bonusCredits: 0 } }), { checkedIn: true })).toEqual({ kind: "claimed", credits: 500, bonusCredits: 0, missed: false });
  });

  it("簽到回 granted 就算已領，不等重讀（P3）", () => {
    const line = todayLine(mine(), { checkedIn: true, outcome: { status: "granted", day: "2026-10-20", credits: 1000, bonusCredits: 500, replayed: false } });
    expect(line).toEqual({ kind: "claimed", credits: 1000, bonusCredits: 500, missed: false });
  });

  it("自動重試也沒領到：領取按鈕加「剛才沒領到」（P4）", () => {
    expect(todayLine(mine(), { checkedIn: true, missed: true })).toEqual({ kind: "claim", credits: 1000, bonusCredits: 500, missed: true });
  });

  it("今天已簽到但還是可以領：給按鈕，不寫沒領到（P5）", () => {
    expect(todayLine(mine(), { checkedIn: true })).toEqual({ kind: "claim", credits: 1000, bonusCredits: 500, missed: false });
  });

  it("今天的額度隨退款收回：整列不出現，不提收回（P6）", () => {
    expect(todayLine(mine({ today: { status: "revoked", credits: 0, bonusCredits: 0 } }), { checkedIn: true })).toEqual({ kind: "hidden" });
    expect(todayLine(mine(), { checkedIn: true, outcome: { status: "revoked", day: "2026-10-20" } })).toEqual({ kind: "hidden" });
  });

  it("前一個業務日的簽到結果不覆蓋今天", () => {
    const line = todayLine(mine(), { checkedIn: false, outcome: { status: "granted", day: "2026-10-19", credits: 1000, bonusCredits: 500 } });
    expect(line.kind).toBe("withCheckin");
  });
});

describe("買卡", () => {
  it("連結照方案給的網址，不加來源參數（Console 不回連應用）", () => {
    expect(purchaseLink(offer)).toBe("https://console.example/me/billing?plan=month");
  });

  it("拿不到方案時用帳單頁的固定網址", () => {
    expect(purchaseLink(null)).toBe("https://console.harperharbor.com/me/billing?plan=month");
  });

  it("第一張每天的量是每日加上加倍的那一份", () => {
    expect(firstDaily(offer)).toBe(1000);
    expect(firstDaily({ ...offer, firstBonusDailyCredits: 0 })).toBe(500);
  });

  it("價格照幣別格式，不寫死符號", () => {
    expect(planPrice(offer, "en")).toBe("$5");
    expect(planPrice({ ...offer, priceMicro: 4_990_000 }, "en")).toBe("$4.99");
  });
});
