/**
 * 卡片頁的圖（2026-10-22 實測 100257）：封面原圖 708 KB 畫成 92×123、橫幅 845 KB、
 * 「其他作品」四張原圖共 1 MB 畫成 44×59。三處都先用縮圖（Cloudflare 轉換），第一個網址
 * 跟 Worker 在 HTML 裡預載的一字不差（shared/card-thumb.ts）；縮圖載不了才退回原圖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { BANNER_THUMB_WIDTH, cardThumbUrl } from "../../shared/card-thumb";
import { PRIMARY_HOST } from "../../shared/site-hosts";

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
// 測試頁面在 localhost：當成正式網域，縮圖才會啟用（本機開發照用原圖）
vi.mock("../../shared/site-hosts", async (orig) => {
  const real = await orig<typeof import("../../shared/site-hosts")>();
  return { ...real, siteRootOf: (h: string) => (h === "localhost" ? real.PRIMARY_HOST : real.siteRootOf(h)) };
});

import CardPage from "../src/pages/CardPage.vue";

const ART = "https://assets.harperharbor.com/versions/art-1";
const WIDE = "https://assets.harperharbor.com/versions/wide-1";
const MORE = "https://assets.harperharbor.com/versions/more-1";
const BASE = {
  id: "abc", roleId: "role-abc", num: 100021, zone: "zh", name: "夜行偵探", summary: "民國背景推理",
  names: { zh: "夜行偵探", en: "", ja: "", ko: "" }, summaries: { zh: "民國背景推理", en: "", ja: "", ko: "" },
  avatarUrl: ART, backgroundUrl: ART, landscapeUrl: WIDE, slug: null, tags: ["推理"],
  author: { handle: "abcdefgh", accountNumId: 7, name: "月光", avatar: "" },
  talkNum: 1200, followNum: 3, trending: 40, registeredAt: 1, syncedAt: 1, provider: "harbor", rating: null,
};
const OTHER = { ...BASE, id: "def", roleId: "role-def", num: 100022, name: "另一張", avatarUrl: MORE, backgroundUrl: MORE, landscapeUrl: null };

let app: App | null = null;
let el: HTMLElement | null = null;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });

function fakeFetch(card: Record<string, unknown>) {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    if (url.includes("/platforms")) return json({ platforms: [] });
    if (url.includes("/comments")) return json({ total: 0, comments: [], isRoleCreator: false });
    if (url.includes("/score")) return json({ average: null, count: 0, mine: null });
    if (/\/v1\/cards\?/.test(url) && url.includes("author=")) return json({ items: [card, OTHER], total: 2, nextOffset: null });
    if (/\/v1\/cards\/[^?/]+(\?|$)/.test(url)) return json(card);
    if (url.endsWith("/v1/me")) return json({ error: "unauthorized" }, 401);
    return json({ error: "not_found" }, 404);
  };
}

async function page(extra: Record<string, unknown> = {}) {
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

describe("卡片頁的圖用縮圖", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("橫幅、封面、其他作品都是縮圖網址；橫幅搶先，封面不搶頻寬", async () => {
    const root = await page();
    const banner = root.querySelector<HTMLImageElement>(".role__banner img")!;
    expect(banner.getAttribute("src")).toBe(cardThumbUrl(PRIMARY_HOST, WIDE, BANNER_THUMB_WIDTH));
    expect(banner.getAttribute("fetchpriority")).toBe("high");
    const art = root.querySelector<HTMLImageElement>(".role__art img")!;
    expect(art.getAttribute("src")).toBe(cardThumbUrl(PRIMARY_HOST, ART));
    expect(art.getAttribute("fetchpriority")).toBe("auto");
    const mini = root.querySelector<HTMLImageElement>(".role__mini img")!;
    expect(mini.getAttribute("src")).toBe(cardThumbUrl(PRIMARY_HOST, MORE));
    expect(mini.getAttribute("loading")).toBe("lazy");
  });

  it("縮圖載不了：先換靜態縮圖，再退回原圖，最後才畫空框", async () => {
    const root = await page();
    const art = () => root.querySelector<HTMLImageElement>(".role__art img");
    art()!.dispatchEvent(new Event("error")); await flush();
    expect(art()!.getAttribute("src")).toBe(cardThumbUrl(PRIMARY_HOST, ART, undefined, true));
    art()!.dispatchEvent(new Event("error")); await flush();
    expect(art()!.getAttribute("src")).toBe(ART);
    art()!.dispatchEvent(new Event("error")); await flush();
    expect(art()).toBeNull();
    expect(root.querySelector(".role__void")).not.toBeNull();
  });

  it("沒有橫幅：封面搶先；糊掉的氛圍底圖也用同一個縮圖", async () => {
    const root = await page({ landscapeUrl: null });
    expect(root.querySelector(".role__banner")).toBeNull();
    expect(root.querySelector(".role__art img")!.getAttribute("fetchpriority")).toBe("high");
    expect((root.querySelector(".role__ambient") as HTMLElement).style.backgroundImage).toContain(cardThumbUrl(PRIMARY_HOST, ART)!);
  });
});
