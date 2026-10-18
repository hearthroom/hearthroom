/**
 * 卡片熱度（2026-10-18）：作者以外的人在這張卡上用掉的積分。
 * 卡片磚的數字由對話數換成熱度（火焰），熱度 0 或舊伺服器沒給時整組不畫；「+趨勢」拿掉。
 * 卡片頁頁首在對話數後接熱度；側欄三格是 對話｜熱度｜收藏，熱度 0 時顯示「—」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { compact } from "../src/lib/format";

vi.mock("../src/lib/oauth", () => ({
  restorePersisted: () => null,
  refresh: async () => null,
  persist: () => {},
  revokeSession: async () => {},
  beginLogin: async () => {},
}));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "card", setSurface: () => {} }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));

import CardTile from "../src/components/CardTile.vue";
import CardPage from "../src/pages/CardPage.vue";

const t = i18n.global.t;
const BASE = {
  id: "abc", roleId: "role-abc", num: 100021, zone: "zh", name: "夜行偵探", summary: "民國背景推理",
  names: { zh: "夜行偵探", en: "", ja: "", ko: "" }, summaries: { zh: "民國背景推理", en: "", ja: "", ko: "" },
  avatarUrl: null, backgroundUrl: null, slug: null, tags: ["推理"],
  author: { handle: "abcdefgh", accountNumId: 7, name: "月光", avatar: "" },
  talkNum: 1200, followNum: 3, trending: 40, registeredAt: 1, syncedAt: 1, provider: "harbor", rating: null,
};

let app: App | null = null;
let el: HTMLElement | null = null;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });

async function tile(extra: Record<string, unknown>, props: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  el = document.createElement("div"); document.body.appendChild(el);
  app = createApp(CardTile, { card: { ...BASE, ...extra }, ...props }).use(router).use(i18n);
  app.mount(el); await nextTick();
  return el;
}

describe("卡片磚", () => {
  it("顯示縮寫後的熱度；整句在提示與讀屏裡", async () => {
    const root = await tile({ heat: 34_000 });
    const num = root.querySelector(".card__num")!;
    const full = t("card.heatCount", { n: compact(34_000) });
    expect(num.getAttribute("title")).toBe(full);
    expect(num.querySelector(".sr-only")?.textContent?.trim()).toBe(full);
    expect(num.querySelector("[aria-hidden='true']:not(svg)")?.textContent?.trim()).toBe(compact(34_000));
  });

  it("三位數以上的縮寫不帶小數（1235萬，不是 1234.6萬）", async () => {
    const root = await tile({ heat: 12_345_678 });
    const shown = root.querySelector(".card__num [aria-hidden='true']:not(svg)")!.textContent!.trim();
    expect(shown).not.toMatch(/[.,]\d/);
    expect(shown).toMatch(/\d{3}/);
  });

  it("熱度 0 或沒給時整組不畫", async () => {
    expect((await tile({ heat: 0 })).querySelector(".card__num")).toBeNull();
    app?.unmount(); el?.remove();
    expect((await tile({})).querySelector(".card__num")).toBeNull();
  });

  it("不再顯示「+趨勢」", async () => {
    const root = await tile({ heat: 500, trending: 40 }, { showTrending: true });
    expect(root.querySelector(".card__num")?.textContent).not.toContain("+");
  });
});

function fakeFetch(card: Record<string, unknown>) {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    if (url.includes("/platforms")) return json({ platforms: [] });
    if (url.includes("/comments")) return json({ total: 0, comments: [], isRoleCreator: false });
    if (url.includes("/score")) return json({ average: null, count: 0, mine: null });
    if (/\/v1\/cards\/[^?/]+(\?|$)/.test(url)) return json(card);
    if (url.endsWith("/v1/me")) return json({ error: "unauthorized" }, 401);
    return json({ error: "not_found" }, 404);
  };
}

async function page(extra: Record<string, unknown>) {
  vi.stubGlobal("fetch", fakeFetch({ ...BASE, ...extra }));
  el = document.createElement("div"); document.body.appendChild(el);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/cards/:id", component: CardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  await router.push("/cards/role-abc");
  await router.isReady();
  app = createApp({ template: "<RouterView />" }).use(pinia).use(router).use(i18n);
  app.mount(el);
  await flush();
  return el;
}

describe("卡片頁", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("頁首對話數後接熱度；側欄是 對話｜熱度｜收藏", async () => {
    const root = await page({ heat: 34_000 });
    const meta = root.querySelector(".role__meta")!.textContent!;
    expect(meta).toContain(t("card.talkCount", { n: compact(1200) }));
    expect(meta).toContain(t("card.heatCount", { n: compact(34_000) }));
    const labels = [...root.querySelectorAll(".role__stats dt")].map((n) => n.textContent!.trim());
    expect(labels.slice(0, 3)).toEqual([t("card.stat.talk"), t("card.stat.heat"), t("card.stat.follow")]);
    expect(labels).not.toContain(t("card.stat.trending"));
    const values = [...root.querySelectorAll(".role__stats dd")].map((n) => n.textContent!.trim());
    expect(values[1]).toBe(compact(34_000));
  });

  it("熱度 0：頁首不顯示，側欄顯示「—」", async () => {
    const root = await page({ heat: 0 });
    expect(root.querySelector(".role__meta")!.textContent).not.toContain(t("card.heatCount", { n: compact(0) }));
    const values = [...root.querySelectorAll(".role__stats dd")].map((n) => n.textContent!.trim());
    expect(values[1]).toBe("—");
  });
});
