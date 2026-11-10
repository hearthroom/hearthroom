import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { applyLocale, i18n } from "../src/lib/i18n";
import { hourMinute, monthDayOf } from "../src/lib/format";

vi.mock("../src/lib/session", () => ({
  useSession: () => ({ me: { accountNumId: 1 }, accessToken: async () => "tok", refreshWallet: async () => undefined }),
}));
vi.mock("../src/lib/connections", async (orig) => ({ ...(await orig<object>()), accountToken: async () => "tok" }));

import ServiceWallet from "../src/components/ServiceWallet.vue";
import { forgetPeriodPlans } from "../src/lib/rewards";

let app: ReturnType<typeof createApp> | undefined;
const now = new Date("2026-11-10T07:30:00Z"); // 2026-11-10 15:30 Taipei
const records = [
  {
    id: "r-rebate-14",
    record: "rebate",
    recordType: "add",
    score: 412,
    count: 38,
    hourStart: "2026-11-10T14:00:00+08:00",
    createTime: "2026-11-10T14:52:10+08:00",
  },
  {
    id: "r-chat-14",
    record: "chat",
    recordType: "sub",
    score: 26,
    createTime: "2026-11-10T14:30:00+08:00",
    modelName: "Gemini-4-Argon",
    laneName: "Dew",
  },
  {
    id: "r-self-14",
    record: "self_rebate",
    recordType: "add",
    score: 4,
    count: 1,
    hourStart: "2026-11-10T14:00:00+08:00",
    createTime: "2026-11-10T14:12:00+08:00",
  },
  {
    id: "r-honor",
    record: "campaign",
    recordType: "add",
    score: 2500,
    createTime: "2026-11-10T00:01:35+08:00",
    rankHonor: { zone: "all", window: "day", band: 3 },
  },
  {
    id: "r-old-rebate",
    record: "rebate",
    recordType: "add",
    score: 85,
    count: 12,
    hourStart: "2026-11-07T23:00:00+08:00",
    createTime: "2026-11-07T23:45:00+08:00",
  },
];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  forgetPeriodPlans();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/score/records")) {
        return json({ total: records.length, size: 30, pages: 1, hasNextPage: false, records });
      }
      if (url.endsWith("/me/wallet")) return json({ available: 5000, expiring: 0, expiries: [] });
      if (url.endsWith("/plans")) return json({ list: [] });
      return json({});
    }),
  );
});

afterEach(() => {
  app?.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  i18n.global.locale.value = "zh-Hant";
});

const expectedSub: Record<string, [string, string]> = {
  "zh-Hant": ["38\u00a0筆", "1\u00a0筆"],
  "zh-Hans": ["38\u00a0笔", "1\u00a0笔"],
  en: ["38\u00a0entries", "1\u00a0entry"],
  ja: ["38\u00a0件", "1\u00a0件"],
  ko: ["38건", "1건"],
};

it.each(["zh-Hant", "zh-Hans", "en", "ja", "ko"] as const)(
  "hourly rebate rows show time slot, kind, entry count and total in %s while keeping single rewards and expenses per-entry",
  async (locale) => {
    await applyLocale(locale);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }],
    });
    await router.push("/");
    app = createApp(ServiceWallet, { provider: "harbor", externalId: 1 }).use(createPinia()).use(router).use(i18n);
    const root = document.createElement("div");
    app.mount(root);
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 0));
      await nextTick();
    }

    const rows = [...root.querySelectorAll(".ledger .row")];
    expect(rows).toHaveLength(5);

    // 1. 14:00–15:00 作者返點 · 38 筆 · +412
    expect(rows[0].querySelector(".row__name")?.textContent).toBe(i18n.global.t("wallet.reason.rebate"));
    expect(rows[0].querySelector(".row__sub")?.textContent).toBe(expectedSub[locale][0]);
    expect(rows[0].querySelector(".row__num")?.textContent).toBe("+412");
    expect(rows[0].querySelector(".row__time")?.textContent).toBe("14:00–15:00");

    // 2. 14:30 角色對話支出（逐筆時間＋模型線路，不改）
    expect(rows[1].querySelector(".row__name")?.textContent).toBe(i18n.global.t("wallet.reason.chat"));
    expect(rows[1].querySelector(".row__sub")?.textContent).toBe("Gemini-4-Argon · Dew");
    expect(rows[1].querySelector(".row__num")?.textContent).toBe("−26");
    expect(rows[1].querySelector(".row__time")?.textContent).toBe(hourMinute(records[1].createTime));

    // 3. 14:00–15:00 自玩返點 · 1 筆 · +4
    expect(rows[2].querySelector(".row__name")?.textContent).toBe(i18n.global.t("wallet.reason.self_rebate"));
    expect(rows[2].querySelector(".row__sub")?.textContent).toBe(expectedSub[locale][1]);
    expect(rows[2].querySelector(".row__num")?.textContent).toBe("+4");
    expect(rows[2].querySelector(".row__time")?.textContent).toBe("14:00–15:00");

    // 4. 00:01 榜單獎勵（單次大額入帳，逐筆獨立顯示，不帶筆數或時段）
    expect(rows[3].querySelector(".row__sub")).toBeNull();
    expect(rows[3].querySelector(".row__time")?.textContent).toBe(hourMinute(records[3].createTime));

    // 5. 更早日期的返點列：補上月日＋台北整點時段（23:00–00:00）
    expect(rows[4].querySelector(".row__time")?.textContent).toBe(`${monthDayOf(records[4].createTime)} 23:00–00:00`);
  },
);
