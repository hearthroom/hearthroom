/**
 * 首頁榜單（2026-09-26 實測）：
 *   - 開了成人內容的人開首頁，榜單讀了兩次：身分還沒到時讀一次一般版，身分到了再讀成人版、整排換掉。
 *     伺服器現在照 cookie 判斷並標明含不含成人內容，對得上就不必再讀。
 *   - 切換日榜／週榜等分頁每次都要等伺服器：看過的分頁先畫記住的那份，背景再更新。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board", setSurface: () => {} }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));

import BoardPage from "../src/pages/BoardPage.vue";
import { useSession } from "../src/lib/session";
import { resetManagedAuthForTest } from "../src/lib/managed-auth";
import { forgetBoards } from "../src/lib/board-memory";

const PROFILE = { handle: "abcdefgh", memberSince: 0, reviewer: false, identities: [], showNsfw: true, ageVerified: true, adultConsent: true, hiddenTags: [] };
const card = (id: string, name: string) => ({
  id, roleId: `role-${id}`, num: 0, zone: "zh", name, summary: "", names: { zh: name, en: "", ja: "", ko: "" }, summaries: { zh: "", en: "", ja: "", ko: "" },
  avatarUrl: null, backgroundUrl: null, slug: null, tags: [], author: { handle: null, accountNumId: 7, name: "月光", avatar: "" },
  talkNum: 0, followNum: 0, trending: 0, registeredAt: 0, syncedAt: 0, provider: "harbor", nsfw: false,
});
const boardCalls: string[] = [];
let boardDelay = 10;
/** 伺服器依 cookie 判斷：開了的人拿到成人版並標明 */
let cookieAdult = true;
/** 哪些榜是空的（新站日榜常常整天空著） */
let empty = new Set<string>();

const later = <T,>(ms: number, value: () => T) => new Promise<T>((r) => setTimeout(() => r(value()), ms));
function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const auth = new Headers(init?.headers).get("Authorization");
  const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } });
  if (url.endsWith("/v1/auth/config")) return Promise.resolve(json({ managed: true }));
  if (url.endsWith("/v1/auth/session")) return later(40, () => json({ provider: "harbor", me: { accountNumId: 7, nickName: "月光", avatar: "" }, profile: PROFILE, token: { accessToken: "tok", expiresAt: Date.now() + 3_600_000 } }));
  if (url.includes("/v1/cards?")) {
    boardCalls.push(url + (auth ? " [auth]" : ""));
    const adult = auth ? url.includes("nsfw=1") : cookieAdult;
    const sort = new URL(url, "https://x").searchParams.get("sort") ?? "day";
    const items = empty.has(sort) ? [] : [card(`${sort}-1`, `${sort}${adult ? "（成人版）" : ""}`)];
    return later(boardDelay, () => json({ items, total: items.length, hasNext: false, limit: 20, offset: 0, sort }, { "X-Adult-Content": adult ? "1" : "0" }));
  }
  return Promise.resolve(json({}));
}

let app: App | null = null;
let el: HTMLElement | null = null;
let router: Router;
beforeEach(() => { resetManagedAuthForTest(true); forgetBoards(); vi.stubGlobal("fetch", fakeFetch); boardCalls.length = 0; boardDelay = 10; cookieAdult = true; empty = new Set(); });
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });

async function open(path = "/") {
  el = document.createElement("div");
  document.body.appendChild(el);
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: BoardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  const pinia = createPinia();
  setActivePinia(pinia);
  await router.push(path);
  await router.isReady();
  app = createApp({ template: "<RouterView />" }).use(pinia).use(router).use(i18n);
  app.mount(el);
  // 跟正式站一樣：頁面先開始讀榜，身分之後才到
  void useSession().restore();
  await later(200, () => null);
  await nextTick();
}

describe("首頁第一次讀榜", () => {
  it("第一次就照帳號開關讀到成人版：身分到了不再讀第二次", async () => {
    await open();
    expect(el!.textContent).toContain("day（成人版）");
    expect(boardCalls, boardCalls.join("\n")).toHaveLength(1);
  });

  it("第一次拿到的跟開關對不上（伺服器沒認出來）：身分到了照舊重讀一次", async () => {
    cookieAdult = false;
    await open();
    expect(el!.textContent).toContain("day（成人版）");
    expect(boardCalls, boardCalls.join("\n")).toHaveLength(2);
  });

  it("身分比榜單先到也一樣：榜單回來時才比對，對得上就不重讀", async () => {
    boardDelay = 120;
    await open();
    await later(100, () => null);
    expect(el!.textContent).toContain("day（成人版）");
    expect(boardCalls, boardCalls.join("\n")).toHaveLength(1);
  });
});

describe("切換分頁", () => {
  it("切回看過的分頁：記住的那份立刻畫出來，背景再讀一次", async () => {
    await open();
    await router.push("/?sort=week");
    await later(100, () => null);
    expect(el!.textContent).toContain("week");
    boardDelay = 500;
    await router.push("/");
    await nextTick();
    await nextTick();
    // 伺服器還沒回，日榜已經在畫面上，而且不是變淡的等待狀態
    expect(el!.textContent).toContain("day（成人版）");
    expect(el!.querySelector("[aria-busy='true']")).toBeNull();
    // 背景照常重讀
    await later(30, () => null);
    expect(boardCalls.at(-1)).toContain("sort=day");
  });

  it("推薦每次都重洗：不拿記住的那份", async () => {
    await open("/?sort=random");
    await router.push("/?sort=week");
    await later(100, () => null);
    boardDelay = 500;
    await router.push("/?sort=random");
    await nextTick();
    await nextTick();
    expect(el!.textContent).not.toContain("random-1");
  });
});

describe("日榜是空的", () => {
  const on = () => el!.querySelector(".sorts__item--on")?.textContent?.trim();
  it("一進首頁日榜空著：改放週榜、週榜那顆亮起來，並說一句為什麼", async () => {
    empty = new Set(["day"]);
    await open();
    expect(el!.textContent).toContain("week（成人版）");
    expect(on()).toBe(i18n.global.t("board.sort.week"));
    expect(el!.textContent).toContain(i18n.global.t("board.fallback.week"));
  });

  it("週榜也空：改放最熱", async () => {
    empty = new Set(["day", "week"]);
    await open();
    expect(el!.textContent).toContain("hot（成人版）");
    expect(on()).toBe(i18n.global.t("board.sort.hot"));
    expect(el!.textContent).toContain(i18n.global.t("board.fallback.hot"));
  });

  it("自己點了日榜：照實給空的日榜，不偷換", async () => {
    empty = new Set(["day"]);
    await open("/?sort=day");
    expect(el!.textContent).not.toContain("week");
    expect(on()).toBe(i18n.global.t("board.sort.day"));
    expect(el!.textContent).not.toContain(i18n.global.t("board.fallback.week"));
  });

  it("日榜有卡就照常是日榜", async () => {
    await open();
    expect(on()).toBe(i18n.global.t("board.sort.day"));
    expect(boardCalls.every((c) => c.includes("sort=day"))).toBe(true);
  });
});
