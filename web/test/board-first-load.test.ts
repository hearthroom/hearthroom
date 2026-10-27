/**
 * 首頁榜單（2026-09-26 實測）：
 *   - 開了成人內容的人開首頁，榜單讀了兩次：身分還沒到時讀一次一般版，身分到了再讀成人版、整排換掉。
 *     伺服器現在照 cookie 判斷並標明含不含成人內容，對得上就不必再讀。
 *   - 切換日榜／週榜等分頁每次都要等伺服器：看過的分頁先畫記住的那份，背景再更新。
 *   - 首頁預設最熱；開窗的榜（日／週／月）第一頁不到一屏時，下面接上最熱（2026-10-11）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, ref, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board", setSurface: () => {} }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));

import { boardListEndKey } from "../src/lib/site-links";
const listEndAllowed = ref(false);
import BoardPage from "../src/pages/BoardPage.vue";
import { useSession } from "../src/lib/session";
import { resetManagedAuthForTest } from "../src/lib/managed-auth";
import { forgetBoards } from "../src/lib/board-memory";
import { resetInlineBoardForTest } from "../src/lib/board-inline";
import { recallCard } from "../src/lib/card-memory";

const PROFILE = { handle: "abcdefgh", memberSince: 0, reviewer: false, identities: [], showNsfw: true, ageVerified: true, adultConsent: true, hiddenTags: [] };
const card = (id: string, name: string) => ({
  id, roleId: `role-${id}`, num: 0, zone: "zh", name, summary: "", names: { zh: name, en: "", ja: "", ko: "" }, summaries: { zh: "", en: "", ja: "", ko: "" },
  avatarUrl: null, backgroundUrl: null, slug: null, tags: [], author: { handle: null, accountNumId: 7, name: "月光", avatar: "" },
  talkNum: 0, followNum: 0, trending: 0, registeredAt: 0, syncedAt: 0, provider: "harbor", rating: null,
});
const boardCalls: string[] = [];
/** 首頁（最熱）讀了幾次 */
const landingCalls = () => boardCalls.filter((c) => c.includes("sort=day"));
let boardDelay = 10;
/** 伺服器依 cookie 判斷：開了的人拿到成人版並標明 */
let cookieAdult = true;
/** 哪些榜是空的（新站日榜常常整天空著） */
let empty = new Set<string>();
/** 最熱的第一頁也有日榜那張卡：補位時要去掉重複 */
let hotIncludesDay = false;

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
    const sort = new URL(url, "https://x").searchParams.get("sort") ?? "hot";
    const items = empty.has(sort) ? [] : [card(`${sort}-1`, `${sort}${adult ? "（成人版）" : ""}`)];
    if (sort === "hot" && hotIncludesDay) items.unshift(card("day-1", "day"));
    return later(boardDelay, () => json({ items, total: items.length, hasNext: false, limit: 20, offset: 0, sort }, { "X-Adult-Content": adult ? "1" : "0" }));
  }
  return Promise.resolve(json({}));
}

let app: App | null = null;
let el: HTMLElement | null = null;
let router: Router;
beforeEach(() => { resetManagedAuthForTest(true); forgetBoards(); resetInlineBoardForTest(); document.getElementById("board-inline")?.remove(); vi.stubGlobal("fetch", fakeFetch); boardCalls.length = 0; boardDelay = 10; cookieAdult = true; empty = new Set(); hotIncludesDay = false; });
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });

async function open(path = "/", position?: number) {
  el = document.createElement("div");
  document.body.appendChild(el);
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: BoardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  const pinia = createPinia();
  setActivePinia(pinia);
  await router.push(path);
  await router.isReady();
  if (position !== undefined) router.options.history.replace(path, { position });
  app = createApp({ template: "<RouterView />" }).use(pinia).use(router).use(i18n);
  app.provide(boardListEndKey, listEndAllowed);
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
    expect(landingCalls(), boardCalls.join("\n")).toHaveLength(1);
  });

  it("第一次拿到的跟開關對不上（伺服器沒認出來）：身分到了照舊重讀一次", async () => {
    cookieAdult = false;
    await open();
    expect(el!.textContent).toContain("day（成人版）");
    expect(landingCalls(), boardCalls.join("\n")).toHaveLength(2);
  });

  it("身分比榜單先到也一樣：榜單回來時才比對，對得上就不重讀", async () => {
    boardDelay = 120;
    await open();
    await later(100, () => null);
    expect(el!.textContent).toContain("day（成人版）");
    expect(landingCalls(), boardCalls.join("\n")).toHaveLength(1);
  });
});

describe("切換分頁", () => {
  it("切回看過的清單：已讀批次立刻畫出來，不背景重排", async () => {
    await open();
    await router.push("/?sort=week");
    await later(100, () => null);
    expect(el!.textContent).toContain("week");
    boardDelay = 500;
    await router.push("/");
    await nextTick();
    await nextTick();
    // 伺服器還沒回，最熱已經在畫面上，而且不是變淡的等待狀態
    expect(el!.textContent).toContain("day（成人版）");
    expect(el!.querySelector("[aria-busy='true']")).toBeNull();
    // 背景照常重讀
    await later(30, () => null);
    expect(boardCalls.at(-1)).toContain("sort=week");
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

describe("首頁預設日榜接最熱", () => {
  const on = () => el!.querySelector(".sorts__item--on")?.textContent?.trim();
  // 新站一天上不了幾張卡，日榜（上榜 24 小時內）常常只有一兩張；首頁改放全站卡都參與的最熱
  it("一進首頁先日榜：排在最左，載完接最熱", async () => {
    await open();
    expect(on()).toBe(i18n.global.t("board.sort.day"));
    expect(el!.querySelector(".sorts__item")?.textContent?.trim()).toBe(i18n.global.t("board.sort.day"));
    expect(el!.textContent).toContain("day（成人版）");
    expect(boardCalls[0]).toContain("sort=day");
    expect(boardCalls[1]).toContain("sort=hot");
  });
});

describe("開窗的榜卡太少", () => {
  const more = () => el!.querySelector("[data-board-more]");
  it("日榜不到一屏：下面接上大家都在聊的（最熱），去掉已經在上面的", async () => {
    hotIncludesDay = true;
    await open("/?sort=day");
    expect(el!.querySelector(".sorts__item--on")?.textContent?.trim()).toBe(i18n.global.t("board.sort.day"));
    expect(more()?.textContent).toContain(i18n.global.t("board.sort.hot"));
    expect(more()?.textContent).toContain("hot（成人版）");
    expect(more()?.textContent).not.toContain("day");
  });

  it("日榜整個空：照實是空的日榜，下面一樣接上最熱", async () => {
    empty = new Set(["day"]);
    await open("/?sort=day");
    expect(el!.querySelector(".sorts__item--on")?.textContent?.trim()).toBe(i18n.global.t("board.sort.day"));
    expect(more()?.textContent).toContain("hot（成人版）");
  });

  it("篩選日榜同樣接同條件最熱；明選最熱不插日榜", async () => {
    await open("/?sort=day&tag=roleplay");
    expect(more()).not.toBeNull();
    expect(boardCalls.at(-1)).toContain("tag=roleplay");
    app?.unmount(); el?.remove();
    await open("/?sort=week");
    expect(more()).toBeNull();
    app?.unmount(); el?.remove();
    await open("/?sort=hot");
    expect(more()).toBeNull();
  });
});

describe("首頁 HTML 裡已經放好第一屏的榜單", () => {
  function plant(page: unknown, query = { zone: "zh", lang: "zh", sort: "day", offset: 0 }) {
    const node = document.createElement("script");
    node.id = "board-inline";
    node.type = "application/json";
    node.textContent = JSON.stringify({ query, page });
    document.head.appendChild(node);
  }
  const inlinePage = (sort: string, name: string) => ({ items: [card(`inline-${sort}`, name)], total: 1, hasNext: false, limit: 20, offset: 0, sort, adult: true });

  it("直接畫出來、不再讀最熱；用過就拿掉；卡片記住了，點進去立刻有", async () => {
    plant(inlinePage("day", "預先放好的卡"));
    await open();
    expect(el!.textContent).toContain("預先放好的卡");
    expect(landingCalls(), boardCalls.join("\n")).toHaveLength(0);
    expect(document.getElementById("board-inline")).toBeNull();
    expect(recallCard("inline-day")?.name).toBe("預先放好的卡");
  });

  it("條件對不上（例如另一個語區）就不用，照常讀", async () => {
    plant(inlinePage("day", "英文區的卡"), { zone: "en", lang: "en", sort: "day", offset: 0 });
    await open();
    expect(el!.textContent).not.toContain("英文區的卡");
    expect(landingCalls()).toHaveLength(1);
  });

  it("身分到了、發現開關對不上（HTML 裡是一般版）：照舊重讀一次", async () => {
    plant({ ...inlinePage("day", "一般版"), adult: false });
    await open();
    expect(el!.textContent).toContain("day（成人版）");
    expect(landingCalls()).toHaveLength(1);
  });
});

describe("推薦的卡片返回", () => {
  it("同一history entry返回保留清單；重新切進推薦才重洗", async () => {
    await open('/?sort=random', 7);
    const calls = () => boardCalls.filter(c => c.includes('sort=random'));
    expect(calls()).toHaveLength(1);
    await router.push('/cards/example'); await nextTick();
    router.back(); await later(100, () => null); await nextTick();
    expect(el!.textContent).toContain('random（成人版）');
    expect(calls()).toHaveLength(1);
  });
});

describe("桌寵到底台詞的清單事實", () => {
  it("成功結束且有卡片才允許", async () => {
    await open(); expect(listEndAllowed.value).toBe(true);
  });
  it("成功空清單不允許", async () => {
    empty = new Set(['day', 'hot']); await open(); expect(listEndAllowed.value).toBe(false);
  });
  it("仍在載入不允許", async () => {
    boardDelay = 600; await open(); expect(listEndAllowed.value).toBe(false);
  });
});
