// 積分記錄的對話支出列寫出當時用的模型與線路（任務 2026-10-23-wallet-model-label）：
// 名字由服務依 language 標頭給，跟模型選單一致；沒給的列不多一行，不猜。
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
const lanes: Record<string, string> = { "zh-Hant": "白露", en: "Dew" };
const languages: string[] = [];

let app: ReturnType<typeof createApp> | undefined;
beforeEach(() => {
  forgetPeriodPlans();
  languages.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/score/records")) {
      const language = (init?.headers as Record<string, string> | undefined)?.language ?? "";
      languages.push(language);
      const records = [
        { id: 3, record: "chat", recordType: "sub", score: 478, createTime: "2026-10-23T03:00:00Z", modelName: "Gemini-4-Argon", laneName: lanes[language] ?? "?" },
        { id: 2, record: "chat", recordType: "sub", score: 120, createTime: "2026-10-23T02:00:00Z", modelName: "Grok 4" },
        { id: 1, record: "chat", recordType: "sub", score: 308, createTime: "2026-10-23T01:00:00Z" },
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
const rows = (root: Element) => [...root.querySelectorAll(".ledger .row")].map((r) => ({ name: r.querySelector(".row__name")?.textContent, sub: r.querySelector(".row__sub")?.textContent ?? null }));

it("對話支出列：「角色對話」下方寫模型名 · 線路名；只有模型名就只寫模型名；沒有就不多一行", async () => {
  const root = await mount();
  expect(languages).toEqual(["zh-Hant"]);
  expect(rows(root)).toEqual([
    { name: "角色對話", sub: "Gemini-4-Argon · 白露" },
    { name: "角色對話", sub: "Grok 4" },
    { name: "角色對話", sub: null },
  ]);
});

it("切換介面語言：重新讀一次，線路名跟著換", async () => {
  const root = await mount();
  i18n.global.locale.value = "en";
  await settle();
  expect(languages.at(-1)).toBe("en");
  expect(rows(root)[0].sub).toBe("Gemini-4-Argon · Dew");
});
