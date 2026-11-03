// 榜單獎勵在錢包明細寫出是哪一個榮譽（任務 2026-11-02-badges-v2，文案 badge-ui.json honor.grantReason）：
// 服務在那一列帶 rankHonor 時顯示「清水日榜第一獎勵」；沒帶（舊紀錄或別種活動）照舊「活動獎勵」。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n, applyLocale } from "../src/lib/i18n";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 1 }, accessToken: async () => "tok", refreshWallet: async () => undefined }) }));
vi.mock("../src/lib/connections", async (orig) => ({ ...(await orig<object>()), accountToken: async () => "tok" }));
import ServiceWallet from "../src/components/ServiceWallet.vue";
import { forgetPeriodPlans } from "../src/lib/rewards";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let app: ReturnType<typeof createApp> | undefined;
beforeEach(() => {
  forgetPeriodPlans();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/score/records")) {
      const records = [
        { id: 3, record: "campaign", recordType: "add", score: 5000, createTime: "2026-11-04T01:00:00Z", rankHonor: { zone: "clean", window: "day", band: 1 } },
        { id: 2, record: "campaign", recordType: "add", score: 25000, createTime: "2026-11-03T01:00:00Z", rankHonor: { zone: "all", window: "week", band: 3 } },
        { id: 1, record: "campaign", recordType: "add", score: 300, createTime: "2026-11-02T01:00:00Z" },
      ];
      return json({ total: records.length, size: 30, pages: 1, hasNextPage: false, records });
    }
    if (url.endsWith("/open/v1/me/wallet")) return json({ available: 1000, expiring: 0, expiries: [] });
    if (url.endsWith("/open/v1/plans")) return json({ list: [] });
    return json({ error: "not_found" }, 404);
  }));
});
afterEach(() => { app?.unmount(); vi.unstubAllGlobals(); });
const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };
async function mount(locale: string) {
  await applyLocale(locale);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  app = createApp(ServiceWallet, { provider: "harbor", externalId: 1 }).use(createPinia()).use(router).use(i18n);
  const root = document.createElement("div"); app.mount(root);
  await settle();
  return root;
}
const rows = (root: Element) => [...root.querySelectorAll(".ledger .row")].map((r) => r.querySelector(".row__name")?.textContent);

it("names the board honor on its reward row and keeps other campaign rows generic", async () => {
  expect(rows(await mount("zh-Hant"))).toEqual(["清水日榜第一獎勵", "綜合週榜前三獎勵", "活動獎勵"]);
});

it("composes the name in each language", async () => {
  expect(rows(await mount("en"))[0]).toBe("SFW Daily #1 reward");
});
