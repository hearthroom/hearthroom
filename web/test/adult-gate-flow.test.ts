/**
 * 成人內容的門，整條路真的走一遍：真的 session store、真的 api 客戶端、假的 fetch。
 * 登入了但沒開 → 卡片頁畫門 → 按下去開 → 卡片頁自己重讀、帶 ?nsfw=1 與 token → 看到卡。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/oauth", () => ({
  restorePersisted: () => ({ accessToken: "tok", refreshToken: "r", expiresAt: Date.now() + 3_600_000 }),
  refresh: async () => null,
  persist: () => {},
  revokeSession: async () => {},
  beginLogin: async () => {},
}));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "card", setSurface: () => {} }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));
// 卡片頁會拉 HTML 卡的沙盒；它的樣式來自舞台子模組的 raw 匯入，測試環境的檔案系統白名單擋它——這條路跟門無關，整個換掉
vi.mock("../src/lib/html-card-frame", () => ({ buildSrcdoc: () => "", SIZE_MESSAGE: "hc-card-size" }));

import CardPage from "../src/pages/CardPage.vue";
import { useSession } from "../src/lib/session";
import { fetchCard } from "../src/lib/api";

const CARD = {
  id: "abc", roleId: "role-abc", zone: "zh", name: "深夜的卡", summary: "s", names: { zh: "深夜的卡", en: "", ja: "", ko: "" },
  summaries: { zh: "s", en: "", ja: "", ko: "" }, avatarUrl: null, backgroundUrl: null, slug: null, tags: [],
  author: { handle: "abcdefgh", accountNumId: 7, name: "月光", avatar: "" }, talkNum: 0, followNum: 0, trending: 0, registeredAt: 0, syncedAt: 0, provider: "lunatalk", nsfw: true,
};
const state = { showNsfw: false, ageVerified: true };
const calls: string[] = [];

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const headers = new Headers(init?.headers);
  const auth = headers.get("Authorization");
  calls.push(`${init?.method ?? "GET"} ${url}${auth ? " [auth]" : ""}`);
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  if (url.includes("/open/v1/me")) return json({ accountNumId: 7, nickName: "月光", avatar: "" });
  if (url.endsWith("/v1/me")) return json({ handle: "abcdefgh", memberSince: 0, reviewer: false, identities: [], ...state });
  if (url.includes("/v1/me/settings")) { const body = JSON.parse(String(init?.body)) as { showNsfw: boolean }; state.showNsfw = body.showNsfw; return json({ showNsfw: state.showNsfw, ageVerified: true }); }
  if (url.includes("/v1/cards/abc")) return url.includes("nsfw=1") && auth ? json(CARD) : json({ error: "adult_content" }, 403);
  if (url.includes("/v1/cards?")) return json({ items: [], total: 0, hasNext: false, limit: 9, offset: 0, sort: "hot" });
  return json({ error: "not_found" }, 404);
}

let app: App | null = null;
let el: HTMLElement | null = null;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };

beforeEach(() => { vi.stubGlobal("fetch", fakeFetch); calls.length = 0; state.showNsfw = false; setActivePinia(createPinia()); });
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });

describe("成人內容的門（整條路）", () => {
  it("api 層：開關開了之後，讀單卡帶 ?nsfw=1 與 token", async () => {
    const session = useSession();
    await session.restore();
    await flush();
    expect(session.profile?.showNsfw).toBe(false);
    await expect(fetchCard("abc")).rejects.toMatchObject({ status: 403, code: "adult_content" });
    session.profile!.showNsfw = true;
    await expect(fetchCard("abc")).resolves.toMatchObject({ id: "abc" });
    expect(calls.some((c) => c.includes("/v1/cards/abc?") && c.includes("nsfw=1") && c.endsWith("[auth]"))).toBe(true);
  });

  it("頁面層：畫門 → 按「顯示成人內容」→ 自己重讀 → 看到卡", async () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/cards/:id", component: CardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
    const pinia = createPinia();
    setActivePinia(pinia);
    const session = useSession();
    await session.restore();
    await flush();
    await router.push("/cards/abc");
    await router.isReady();
    app = createApp({ template: "<RouterView />" }).use(pinia).use(router).use(i18n);
    app.mount(el);
    await flush();
    expect(el.textContent).toContain(i18n.global.t("card.gate.title"));
    const btn = el.querySelector<HTMLButtonElement>(".gate button.btn--primary");
    expect(btn, "門上要有「顯示成人內容」鍵").not.toBeNull();
    btn!.click();
    await flush();
    await flush();
    expect(session.profile?.showNsfw).toBe(true);
    expect(el.textContent, `calls:\n${calls.join("\n")}`).not.toContain(i18n.global.t("card.gate.title"));
    expect(el.textContent).toContain("深夜的卡");
  });

  it("身分比卡片晚到、而且本來就開著：不會卡在門上（第一次讀就等身分，或載好後自己重讀）", async () => {
    state.showNsfw = true;
    // /v1/me 慢：讓身分明顯晚於卡片頁的第一次讀
    const slow = fakeFetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.endsWith("/v1/me")) return new Promise<Response>((r) => setTimeout(() => r(slow(input, init) as unknown as Response), 30));
      return slow(input, init);
    });
    el = document.createElement("div");
    document.body.appendChild(el);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/cards/:id", component: CardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
    const pinia = createPinia();
    setActivePinia(pinia);
    const session = useSession();
    void session.restore(); // 不等它：模擬進頁時身分還在路上
    await router.push("/cards/abc");
    await router.isReady();
    app = createApp({ template: "<RouterView />" }).use(pinia).use(router).use(i18n);
    app.mount(el);
    await new Promise((r) => setTimeout(r, 80));
    await flush();
    expect(el.textContent, `calls:\n${calls.join("\n")}`).toContain("深夜的卡");
    expect(el.textContent).not.toContain(i18n.global.t("card.gate.title"));
  });
});
