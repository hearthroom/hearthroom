/**
 * 開了成人內容的人重新整理成人卡：從頭到尾不能出現成人門（玩家回報 2026-09-26）。
 * 正式站走託管登入：身分靠 /v1/auth/session 恢復，token 另外換發，兩個都比第一次讀卡晚到。
 * 真的 session store、真的 api 客戶端、假的 fetch；整段期間盯著畫面，不只看最後結果。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "card", setSurface: () => {} }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));
vi.mock("../src/lib/html-card-frame", () => ({ buildSrcdoc: () => "", SIZE_MESSAGE: "hc-card-size" }));

import CardPage from "../src/pages/CardPage.vue";
import { useSession } from "../src/lib/session";
import { resetManagedAuthForTest } from "../src/lib/managed-auth";

const CARD = {
  id: "abc", num: 0, roleId: "role-abc", zone: "zh", name: "深夜的卡", summary: "s", names: { zh: "深夜的卡", en: "", ja: "", ko: "" },
  summaries: { zh: "s", en: "", ja: "", ko: "" }, avatarUrl: null, backgroundUrl: null, slug: null, tags: [],
  author: { handle: null, accountNumId: 7, name: "月光", avatar: "" }, talkNum: 0, followNum: 0, trending: 0, registeredAt: 0, syncedAt: 0, provider: "harbor", nsfw: true,
};
const PROFILE = { handle: "abcdefgh", memberSince: 0, reviewer: false, identities: [], showNsfw: true, ageVerified: true, adultConsent: true, hiddenTags: [] };
/** 伺服器認不認同源帶的登入 cookie：舊伺服器不認，第一次讀卡一定被擋 */
let cookieGrants = false;
const cardReads: string[] = [];

const later = <T,>(ms: number, value: () => T) => new Promise<T>((r) => setTimeout(() => r(value()), ms));
function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const auth = new Headers(init?.headers).get("Authorization");
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.endsWith("/v1/auth/config")) return Promise.resolve(json({ managed: true }));
  if (url.endsWith("/v1/auth/session")) return later(40, () => json({ provider: "harbor", me: { accountNumId: 7, nickName: "月光", avatar: "" }, profile: PROFILE }));
  if (url.endsWith("/v1/auth/token")) return later(40, () => json({ accessToken: "tok", expiresAt: Date.now() + 3_600_000 }));
  if (url.includes("/v1/cards/abc/platforms")) return Promise.resolve(json({ platforms: [] }));
  if (url.includes("/v1/cards/abc")) {
    cardReads.push(url + (auth ? " [auth]" : ""));
    const allowed = cookieGrants || (url.includes("nsfw=1") && auth);
    return later(10, () => (allowed ? json(CARD) : json({ error: "adult_content" }, 403)));
  }
  if (url.includes("/v1/cards?")) return Promise.resolve(json({ items: [], total: 0, hasNext: false, limit: 9, offset: 0, sort: "hot" }));
  return Promise.resolve(json({}, 200));
}

let app: App | null = null;
let el: HTMLElement | null = null;
let observer: MutationObserver | null = null;
beforeEach(() => { resetManagedAuthForTest(true); vi.stubGlobal("fetch", fakeFetch); cardReads.length = 0; cookieGrants = false; });
afterEach(() => { observer?.disconnect(); observer = null; app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });

async function open(): Promise<{ gateSeen: () => boolean }> {
  el = document.createElement("div");
  document.body.appendChild(el);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/cards/:id", component: CardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  const pinia = createPinia();
  setActivePinia(pinia);
  let seen = false;
  const gateTitle = i18n.global.t("card.gate.title");
  const root = el;
  observer = new MutationObserver(() => { if (root.textContent?.includes(gateTitle)) seen = true; });
  observer.observe(root, { subtree: true, childList: true, characterData: true });
  await router.push("/cards/abc");
  await router.isReady();
  app = createApp({ template: "<RouterView />" }).use(pinia).use(router).use(i18n);
  app.mount(el);
  // 跟正式站一樣：App 掛好之後才開始恢復身分，卡片頁的第一次讀已經出門了
  void useSession().restore();
  await later(250, () => null);
  await nextTick();
  return { gateSeen: () => seen };
}

describe("重新整理成人卡，開了成人內容的人", () => {
  it("第一次讀卡被擋（身分還沒到）：停在骨架等身分，帶權限再讀，門一次都不出現", async () => {
    const page = await open();
    expect(el!.textContent, `${cardReads.join("\n")}\nprofile=${JSON.stringify(useSession().profile)} ready=${useSession().ready}`).toContain("深夜的卡");
    expect(page.gateSeen(), "不能先閃一下成人門").toBe(false);
    expect(cardReads).toHaveLength(2);
  });

  it("伺服器認得登入 cookie：第一次讀就拿到卡，身分到了也不再重讀", async () => {
    cookieGrants = true;
    const page = await open();
    expect(el!.textContent).toContain("深夜的卡");
    expect(page.gateSeen()).toBe(false);
    expect(cardReads, cardReads.join("\n")).toHaveLength(1);
  });
});
