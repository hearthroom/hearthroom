// 月卡的持卡狀態：讀 /me/plans、簽到回 unavailable 時自動補領一次、手動領取、讀不到時安靜。
// 契約：docs/openapi.json 的 Plans（GET /open/v1/plans、/me/plans、POST /me/plans/{id}/claim）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: async () => "tok", refreshWallet: async () => undefined }) }));
import { usePeriodPlans } from "../src/lib/period-plan-store";
import { forgetPeriodPlans } from "../src/lib/rewards";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const myPlan = (status = "claimable") => ({
  id: "month", businessDay: "2026-10-20", nextResetAt: "2026-10-20T20:00:00Z", active: true, endsOn: "2026-11-18", remainingDays: 30,
  today: { status, credits: 1000, bonusCredits: 500 }, canPurchase: true, purchaseBlockedReason: null,
  firstBonus: { status: "active", dailyCredits: 500 }, firstBonusDailyCredits: 500, makeupPerMonth: 3,
});
const offer = { id: "month", onSale: true, priceMicro: 5_000_000, currency: "USD", credits: 30000, days: 30, dailyCredits: 500, firstBonusDailyCredits: 500, maxDays: 180, makeupPerMonth: 3, purchaseUrl: "https://c.example/me/billing?plan=month" };
let calls: { url: string; body?: { requestId: string } }[] = [];
type Route = (url: string, init?: RequestInit) => Response | undefined;
function stub(route: Route) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const hit = route(url, init);
    if (hit) return hit;
    if (url.endsWith("/open/v1/plans")) return json({ list: [offer] });
    return json({ error: "not_found" }, 404);
  }));
}

beforeEach(() => { setActivePinia(createPinia()); sessionStorage.clear(); calls = []; forgetPeriodPlans(); });
afterEach(() => vi.unstubAllGlobals());

describe("月卡持卡狀態", () => {
  it("讀自己的卡與方案；帶著登入的 token", async () => {
    stub((url) => (url.endsWith("/me/plans") ? json({ serverNow: "x", list: [myPlan()] }) : undefined));
    const s = usePeriodPlans();
    await s.load();
    expect(s.mine?.remainingDays).toBe(30);
    expect(s.offer?.dailyCredits).toBe(500);
    expect(s.failed).toBe(false);
  });

  it("讀不到（404 或網路）：安靜，沒有卡也沒有錯誤畫面", async () => {
    stub(() => { throw new TypeError("network"); });
    const s = usePeriodPlans();
    await s.load();
    expect(s.mine).toBeNull();
    expect(s.failed).toBe(true);
  });

  it("簽到回 unavailable：舞台關掉時自動補領一次，成功就算已領", async () => {
    let claimed = false;
    stub((url) => {
      if (url.endsWith("/me/plans/month/claim")) { claimed = true; return json({ day: "2026-10-20", credits: 1000, bonusCredits: 500, status: "granted", replayed: false }); }
      if (url.endsWith("/me/plans")) return json({ serverNow: "x", list: [myPlan(claimed ? "claimed" : "claimable")] });
      return undefined;
    });
    const s = usePeriodPlans();
    await s.load();
    s.noteCheckin({ status: "unavailable" });
    await s.settle();
    expect(calls.filter((c) => c.url.endsWith("/claim"))).toHaveLength(1);
    expect(s.missed).toBe(false);
    expect(s.line(true).kind).toBe("claimed");
  });

  it("自動補領也失敗：只試一次，之後給按鈕與「剛才沒領到」", async () => {
    stub((url) => {
      if (url.endsWith("/claim")) return json({ error: "temporarily_unavailable" }, 503);
      if (url.endsWith("/me/plans")) return json({ serverNow: "x", list: [myPlan()] });
      return undefined;
    });
    const s = usePeriodPlans();
    await s.load();
    s.noteCheckin({ status: "unavailable" });
    await s.settle();
    await s.settle();
    expect(calls.filter((c) => c.url.endsWith("/claim"))).toHaveLength(1);
    expect(s.line(true)).toMatchObject({ kind: "claim", missed: true });
  });

  it("簽到回 granted：舞台關掉之前不揭曉；關掉後是已領，不補領", async () => {
    stub((url) => (url.endsWith("/me/plans") ? json({ serverNow: "x", list: [myPlan()] }) : undefined));
    const s = usePeriodPlans();
    await s.load();
    s.noteCheckin({ status: "granted", day: "2026-10-20", credits: 1000, bonusCredits: 500 });
    expect(s.line(true).kind).toBe("claim");
    await s.settle();
    expect(s.line(true).kind).toBe("claimed");
    expect(calls.filter((c) => c.url.endsWith("/claim"))).toHaveLength(0);
  });

  it("手動領取：同一次按下重送用同一個 requestId，成功後換新的", async () => {
    let fail = true;
    stub((url) => {
      if (url.endsWith("/claim")) { if (fail) throw new TypeError("network"); return json({ day: "2026-10-20", credits: 1000, bonusCredits: 500, status: "granted", replayed: false }); }
      if (url.endsWith("/me/plans")) return json({ serverNow: "x", list: [myPlan(fail ? "claimable" : "claimed")] });
      return undefined;
    });
    const s = usePeriodPlans();
    await s.load();
    expect(await s.claim()).toBe(false);
    fail = false;
    expect(await s.claim()).toBe(true);
    const ids = calls.filter((c) => c.url.endsWith("/claim")).map((c) => c.body!.requestId);
    expect(ids[0]).toBe(ids[1]);
    expect(Object.keys(sessionStorage).some((k) => k.includes("plan:month"))).toBe(false);
    expect(s.line(true).kind).toBe("claimed");
  });
});
