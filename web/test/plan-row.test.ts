// 簽到頁的月卡列（任務 2026-10-19-month-card-surfaces ui.md §3）：持卡才出現、今天的總數、首張加贈半句、補簽卡、領取按鈕。
import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { i18n, loadLocale } from "../src/lib/i18n";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: async () => "tok", refreshWallet: async () => undefined }) }));
import { usePeriodPlans } from "../src/lib/period-plan-store";
import PlanRow from "../src/components/checkin/PlanRow.vue";

let app: ReturnType<typeof createApp> | undefined;
afterEach(() => app?.unmount());
const plan = (over: Record<string, unknown> = {}) => ({
  id: "month", businessDay: "2026-10-20", nextResetAt: "2026-10-20T20:00:00Z", active: true, endsOn: "2026-11-18", remainingDays: 23,
  today: { status: "claimable", credits: 1000, bonusCredits: 500 }, canPurchase: true, purchaseBlockedReason: null,
  firstBonus: { status: "active", dailyCredits: 500 }, makeupPerMonth: 3, ...over,
});

async function mount(mine: unknown, checkedIn = false) {
  i18n.global.locale.value = "zh-Hant";
  const pinia = createPinia();
  app = createApp(PlanRow, { checkedIn, makeupLeft: 3 }).use(pinia).use(i18n);
  usePeriodPlans(pinia).$patch({ mine: mine as never, loaded: true });
  const root = document.createElement("div"); app.mount(root); await nextTick();
  return root;
}

it("沒有卡：整列不出現", async () => {
  expect((await mount(null)).querySelector(".plan-row")).toBeNull();
  expect((await mount(plan({ active: false, today: { status: "none", credits: 0, bonusCredits: 0 } }))).querySelector(".plan-row")).toBeNull();
});

it("持卡、還沒簽到：剩幾天、簽到時一起領今天的總數、首張加贈與補簽卡", async () => {
  const text = (await mount(plan())).textContent!;
  expect(text).toContain("月卡 · 剩 23 天");
  expect(text).toContain("簽到時一起領 1,000 積分");
  expect(text).toContain("其中 500 是首購加贈");
  expect(text).toContain("本月補簽卡剩 3 張");
  expect(text).not.toMatch(/45,000|角色對話|機率|寶箱/);
});

it("今天已簽到但還沒領到：給領取按鈕", async () => {
  const root = await mount(plan(), true);
  expect(root.querySelector("button")?.textContent).toContain("領取 1,000 積分");
});

it("最後一天換成「今天最後一天」；第二張起沒有加贈半句", async () => {
  const text = (await mount(plan({ remainingDays: 1, today: { status: "claimed", credits: 500, bonusCredits: 0 } }))).textContent!;
  expect(text).toContain("月卡 · 今天最後一天");
  expect(text).toContain("今天已領 +500 積分");
  expect(text).not.toContain("首購加贈");
});

it("英文照單複數：剩 23 天與補簽卡張數", async () => {
  await loadLocale("en");
  const root = await mount(plan());
  i18n.global.locale.value = "en";
  await nextTick();
  expect(root.textContent).toContain("23 days left");
  expect(root.textContent).not.toContain("|");
  i18n.global.locale.value = "zh-Hant";
});

it("自動補領還在路上：月卡列照樣在，右側不畫按鈕也不畫字（P4）", async () => {
  const pinia = createPinia();
  i18n.global.locale.value = "zh-Hant";
  app = createApp(PlanRow, { checkedIn: true, makeupLeft: 3 }).use(pinia).use(i18n);
  usePeriodPlans(pinia).$patch({ mine: plan() as never, loaded: true, retrying: true });
  const root = document.createElement("div"); app.mount(root); await nextTick();
  expect(root.querySelector(".plan-row")).not.toBeNull();
  expect(root.querySelector("button")).toBeNull();
  expect(root.querySelector(".plan-row__today")?.textContent?.trim()).toBe("");
});

it("首購加贈那半句緊跟在今天的總數後面，補簽卡在最後（PM 2026-10-19）", async () => {
  const text = (await mount(plan())).textContent!;
  const total = text.indexOf("簽到時一起領 1,000 積分"), part = text.indexOf("其中 500 是首購加贈"), makeup = text.indexOf("本月補簽卡剩 3 張");
  expect(total).toBeGreaterThan(-1);
  expect(part).toBeGreaterThan(total);
  expect(makeup).toBeGreaterThan(part);
});
