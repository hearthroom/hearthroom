// 「積分與會員」的月卡（任務 2026-10-19-month-card-surfaces ui.md §4）：持卡區、沒卡的一行入口、積分記錄裡月卡的列。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 1 }, accessToken: async () => "tok", refreshWallet: async () => undefined }) }));
vi.mock("../src/lib/connections", async (orig) => ({ ...(await orig<object>()), accountToken: async () => "tok" }));
import ServiceWallet from "../src/components/ServiceWallet.vue";
import { forgetPeriodPlans } from "../src/lib/rewards";

// 文案讓數字和單位用不換行空白黏在一起；比對時當成一般空白。
const flat = (t: string | null | undefined) => (t ?? "").replace(/\u00a0/g, " ");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const offer = { id: "month", onSale: true, priceMicro: 5_000_000, currency: "USD", credits: 30000, days: 30, dailyCredits: 500, firstBonusDailyCredits: 500, maxDays: 180, makeupPerMonth: 3, purchaseUrl: "https://console.example/me/billing?plan=month" };
const holder = { id: "month", businessDay: "2026-10-20", nextResetAt: "2026-10-20T20:00:00Z", active: true, endsOn: "2026-11-11", remainingDays: 23,
  today: { status: "claimed", credits: 1000, bonusCredits: 500 }, canPurchase: true, purchaseBlockedReason: null, firstBonus: { status: "active", dailyCredits: 500 }, makeupPerMonth: 3 };
const none = { ...holder, active: false, endsOn: null, remainingDays: 0, today: { status: "none", credits: 0, bonusCredits: 0 }, firstBonus: { status: "available", dailyCredits: 0 }, makeupPerMonth: 1 };
const records = [
  { id: 1, record: "plan", recordType: "add", score: 500, createTime: "2026-10-20T01:00:00Z", planKind: "daily" },
  { id: 2, record: "plan", recordType: "add", score: 500, createTime: "2026-10-20T01:00:00Z", planKind: "bonus" },
  { id: 3, record: "refund", recordType: "sub", score: 500, createTime: "2026-10-20T02:00:00Z", planKind: "daily" },
  { id: 4, record: "campaign", recordType: "add", score: 90, createTime: "2026-10-20T01:00:00Z", rewardKind: "checkin", expiresAt: "2026-11-20T01:00:00Z" },
  { id: 5, record: "plan", recordType: "add", score: 30000, createTime: "2026-10-20T00:30:00Z", planKind: "purchase" },
  { id: 6, record: "refund", recordType: "sub", score: 30000, createTime: "2026-10-20T03:00:00Z", planKind: "purchase" },
];

let app: ReturnType<typeof createApp> | undefined;
let mine: unknown = holder;
beforeEach(() => {
  forgetPeriodPlans();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/open/v1/plans")) return json({ list: [offer] });
    if (url.endsWith("/open/v1/me/plans")) return json({ serverNow: "x", list: [mine] });
    if (url.endsWith("/open/v1/me/wallet")) return json({ available: 40000, expiring: 0, expiries: [] });
    if (url.includes("/score/records")) return json({ total: records.length, size: records.length, pages: 1, hasNextPage: false, records });
    return json({ error: "not_found" }, 404);
  }));
});
afterEach(() => { app?.unmount(); vi.unstubAllGlobals(); });

async function mount() {
  i18n.global.locale.value = "zh-Hant";
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  app = createApp(ServiceWallet, { provider: "harbor", externalId: 1 }).use(createPinia()).use(router).use(i18n);
  const root = document.createElement("div"); app.mount(root);
  for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); }
  return root;
}

it("持卡：剩幾天、最後一天、今天已領的總數、首張加贈、再買一張連到 Console", async () => {
  mine = holder;
  const root = await mount();
  const block = root.querySelector("[data-testid=wallet-plan]")!;
  expect(flat(block.textContent)).toContain("月卡 · 剩 23 天");
  expect(flat(block.textContent)).toContain("最後一天");
  expect(flat(block.textContent)).toContain("今天已領 +1,000 積分");
  expect(flat(block.textContent)).toContain("其中 500 是首購加贈");
  expect(block.querySelector("a.plan__more")?.getAttribute("href")).toBe(offer.purchaseUrl);
  expect(root.querySelector("[data-testid=wallet-plan-pitch]")).toBeNull();
});

it("沒卡、從沒買過：前往儲值下方一行入口，用首次購買的每天總量與每天都領的上限", async () => {
  mine = none;
  const root = await mount();
  expect(root.querySelector("[data-testid=wallet-plan]")).toBeNull();
  const pitch = root.querySelector("[data-testid=wallet-plan-pitch]")!;
  expect(flat(pitch.textContent)).toContain("30,000");
  expect(flat(pitch.textContent)).toContain("1,000");
  expect(flat(pitch.textContent)).toContain("最多 60,000");
  expect(flat(pitch.textContent)).not.toMatch(/角色對話/);
  expect(pitch.getAttribute("href")).toBe(offer.purchaseUrl);
});

it("積分記錄：月卡每日、首張加贈與退回各有自己的名字；月卡入帳不寫到期", async () => {
  mine = holder;
  const root = await mount();
  const rows = [...root.querySelectorAll(".row")].map((r) => r.querySelector(".row__item")!.textContent!.trim());
  expect(rows).toContain("月卡每日積分");
  expect(rows).toContain("月卡首購加贈");
  expect(rows).toContain("月卡每日積分退回月卡已退款");
  expect(rows.find((r) => r.startsWith("簽到寶箱"))).toMatch(/到期/);
});

it("不認得的月卡種類：用通用的入帳或退款名稱，不顯示原始代碼", async () => {
  mine = holder;
  const root = await mount();
  const names = [...root.querySelectorAll(".row__name")].map((n) => flat(n.textContent!).trim());
  expect(names).not.toContain("plan");
  expect(names).not.toContain("purchase");
  expect(names).toContain(i18n.global.t("wallet.reason.grant"));
  expect(names).toContain(i18n.global.t("wallet.reason.refund"));
});
