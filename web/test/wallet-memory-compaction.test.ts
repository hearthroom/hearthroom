// 記憶壓縮另外扣點、和那一輪對話分開記帳（任務 2026-10-30-cli-stream-compaction）：
// 服務在那一列標 memoryCompaction，流水寫成記憶壓縮，不再和「角色對話」混在一起看不出是哪一筆。
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

let app: ReturnType<typeof createApp> | undefined;
beforeEach(() => {
  forgetPeriodPlans();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/score/records")) {
      const records = [
        { id: 2, record: "chat", recordType: "sub", score: 88, createTime: "2026-10-30T12:24:40Z", modelName: "Grok 4", memoryCompaction: true, operationId: "01a18cc4-0000-7000-8000-000000000001" },
        { id: 1, record: "chat", recordType: "sub", score: 797, createTime: "2026-10-30T12:24:30Z", modelName: "Grok 4" },
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
async function mount() {
  i18n.global.locale.value = "zh-Hant";
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  app = createApp(ServiceWallet, { provider: "harbor", externalId: 1 }).use(createPinia()).use(router).use(i18n);
  const root = document.createElement("div"); app.mount(root);
  await settle();
  return root;
}
const rows = (root: Element) => [...root.querySelectorAll(".ledger .row")].map((r) => r.querySelector(".row__name")?.textContent);

it("記憶壓縮的扣點寫成記憶壓縮，同一輪的對話支出照舊寫角色對話", async () => {
  const root = await mount();
  expect(rows(root)).toEqual([i18n.global.t("wallet.reason.memory"), "角色對話"]);
  expect(i18n.global.te("wallet.reason.memory")).toBe(true);
});
