// 積分記錄：同一次消費合併成一行，多來源時點開看各來源（任務 2026-11-14-ledger-group-per-turn）
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 1 }, accessToken: async () => "tok", refreshWallet: async () => undefined }) }));
vi.mock("../src/lib/connections", async (orig) => ({ ...(await orig<object>()), accountToken: async () => "tok" }));
import ServiceWallet from "../src/components/ServiceWallet.vue";
import { forgetPeriodPlans } from "../src/lib/rewards";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const records = [
  { id: "op-many", record: "chat", recordType: "sub", score: 493, createTime: "2026-11-14T03:00:00Z", modelName: "Gemini-4-Argon",
    parts: [{ source: "purchase", amount: 212 }, { source: "plan_daily", amount: 150 }, { source: "checkin", amount: 131 }] },
  { id: "op-one-kind", record: "chat", recordType: "sub", score: 300, createTime: "2026-11-14T02:00:00Z", parts: [{ source: "purchase", amount: 300 }] },
  { id: "op-old", record: "chat", recordType: "sub", score: 50, createTime: "2026-11-14T01:00:00Z" },
  { id: "gift", record: "grant", recordType: "add", score: 100, createTime: "2026-11-14T00:30:00Z", parts: [{ source: "grant", amount: 60 }, { source: "purchase", amount: 40 }] },
  { id: "clawback", record: "refund", recordType: "sub", score: 80, createTime: "2026-11-14T00:20:00Z", planKind: "daily", parts: [{ source: "plan_daily", amount: 50 }, { source: "purchase", amount: 30 }] },
];
let app: ReturnType<typeof createApp> | undefined;
beforeEach(() => {
  forgetPeriodPlans();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/score/records")) return json({ total: records.length, size: 30, pages: 1, hasNextPage: false, records });
    if (url.endsWith("/open/v1/me/wallet")) return json({ available: 1000, expiring: 0, expiries: [] });
    if (url.endsWith("/open/v1/plans")) return json({ list: [] });
    return json({ error: "not_found" }, 404);
  }));
});
afterEach(() => { app?.unmount(); vi.unstubAllGlobals(); });
const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };
async function mount() {
  i18n.global.locale.value = "zh-Hant";
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  app = createApp(ServiceWallet, { provider: "harbor", externalId: 1 }).use(createPinia()).use(router).use(i18n);
  const root = document.createElement("div"); document.body.append(root); app.mount(root);
  await settle();
  return root;
}

it("a consumption drawn from several kinds of source is one row that opens to show each source; the rest stay plain rows", async () => {
  const root = await mount();
  const toggles = [...root.querySelectorAll<HTMLButtonElement>(".ledger button.row--toggle")];
  expect(toggles).toHaveLength(1);
  const btn = toggles[0]!;
  expect(btn.textContent).toContain("3 個來源");
  expect(btn.textContent).toContain("−493");
  expect(btn.getAttribute("aria-expanded")).toBe("false");
  const list = root.querySelector<HTMLElement>(`#${btn.getAttribute("aria-controls")}`)!;
  expect(list.style.display).toBe("none");
  btn.click(); await settle();
  expect(btn.getAttribute("aria-expanded")).toBe("true");
  expect(list.style.display).toBe("");
  expect([...list.querySelectorAll(".row__part")].map((li) => li.textContent?.replace(/\s+/g, ""))).toEqual(["購買−212", "月卡每日積分−150", "簽到寶箱−131"]);
  btn.click(); await settle();
  expect(btn.getAttribute("aria-expanded")).toBe("false");
  // 同一種來源（多批也一樣）、沒有 parts 的舊列、收入列：照原本的單行，沒有「N 個來源」
  // 退款收回也是扣，但不是消費：照單列
  expect(root.querySelectorAll(".ledger li.row")).toHaveLength(4);
  expect(root.textContent?.match(/個來源/g)).toHaveLength(1);
});
