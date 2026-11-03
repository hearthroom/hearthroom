import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n, loadLocale } from "../src/lib/i18n";
vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 1 }, accessToken: async () => "tok", refreshWallet: async () => undefined }) }));
vi.mock("../src/lib/connections", async (orig) => ({ ...(await orig<object>()), accountToken: async () => "tok" }));
import ServiceWallet from "../src/components/ServiceWallet.vue";
import { forgetPeriodPlans } from "../src/lib/rewards";
let app: ReturnType<typeof createApp> | undefined;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  forgetPeriodPlans();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/score/records")) return json({ total: 2, size: 30, pages: 1, hasNextPage: false, records: [
      { id: 2, record: "self_rebate", recordType: "add", score: 4, createTime: "2026-11-03T03:00:00Z" },
      { id: 1, record: "rebate", recordType: "add", score: 8, createTime: "2026-11-03T02:00:00Z" },
    ] });
    if (url.endsWith("/open/v1/me/wallet")) return json({ available: 12, expiring: 0, expiries: [] });
    return json({ list: [] });
  }));
});
afterEach(() => { app?.unmount(); vi.unstubAllGlobals(); i18n.global.locale.value = "zh-Hant"; });
it("names self-play and ordinary author rebates separately in all five locales", async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  app = createApp(ServiceWallet, { provider: "harbor", externalId: 1 }).use(createPinia()).use(router).use(i18n);
  const root = document.createElement("div"); app.mount(root);
  const labels = { "zh-Hant": "自玩返點", "zh-Hans": "自玩返点", en: "Self-play rebate", ja: "自プレイ還元", ko: "직접 플레이 리베이트" };
  for (const locale of ["zh-Hant", "zh-Hans", "en", "ja", "ko"] as const) {
    await loadLocale(locale);
    i18n.global.locale.value = locale;
    for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); }
    const names = [...root.querySelectorAll(".ledger .row__name")].map((r) => r.textContent);
    expect(names).toEqual([labels[locale], i18n.global.t("wallet.reason.rebate")]);
    expect(root.textContent).not.toContain("self_rebate");
  }
});
