/**
 * 點榜單上的卡進卡片頁：立刻看到內容，不是先盯著骨架屏等一次往返。
 *
 * 玩家回報 2026-09-17：點卡片頁要黑屏一兩秒。量到的等待幾乎全在 /v1/cards/:id 那一次請求上，
 * 而那張卡的名字、封面、簡介、標籤在上一屏（榜單）就已經在畫面上了——沒有理由再等。
 * 這條測試把「上一屏看過就立刻畫出來」釘住：卡片請求還沒回來，畫面上就要有內容、而且能點。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

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

import CardPage from "../src/pages/CardPage.vue";
import { fetchBoard } from "../src/lib/api";
import { recallCard } from "../src/lib/card-memory";

const CARD = {
  id: "abc", roleId: "role-abc", num: 100021, zone: "zh", name: "夜行偵探", summary: "民國背景推理",
  names: { zh: "夜行偵探", en: "", ja: "", ko: "" }, summaries: { zh: "民國背景推理", en: "", ja: "", ko: "" },
  avatarUrl: null, backgroundUrl: null, slug: null, tags: ["推理"],
  author: { handle: "abcdefgh", accountNumId: 7, name: "月光", avatar: "" },
  talkNum: 12, followNum: 3, trending: 0, registeredAt: 1, syncedAt: 1, provider: "lunatalk", rating: null,
};

/** 卡片請求永遠不回來：畫面上有沒有東西，就完全由「上一屏記下的那份」決定。 */
let cardRequests = 0;
let commentRequests = 0;
let platformRequests: string[] = [];
function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  // 留言是本站的另一條請求，跟卡片請求無關：照常回空列表
  if (url.includes('/platforms')) { platformRequests.push(url); return json({ platforms: [] }); }
  if (url.includes("/comments")) { commentRequests++; return json({ total: 0, comments: [], isRoleCreator: false }); }
  if (/\/v1\/cards\/[^?]+\?/.test(url)) { cardRequests++; return new Promise(() => {}); }
  if (url.includes("/v1/cards?")) return json({ items: [CARD], total: 1, hasNext: false, limit: 24, offset: 0, sort: "hot" });
  if (url.endsWith("/v1/me")) return json({ error: "unauthorized" }, 401);
  return json({ error: "not_found" }, 404);
}

let app: App | null = null;
let el: HTMLElement | null = null;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };

async function mountCard(path: string) {
  el = document.createElement("div");
  document.body.appendChild(el);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/cards/:id", component: CardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  await router.push(path);
  await router.isReady();
  app = createApp({ template: "<RouterView />" }).use(pinia).use(router).use(i18n);
  app.mount(el);
  await flush();
  return el;
}

beforeEach(() => { vi.stubGlobal("fetch", fakeFetch); cardRequests = 0; commentRequests = 0; platformRequests = []; setActivePinia(createPinia()); });
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });

describe("點榜單上的卡：立刻有內容", () => {
  it("榜單列過的卡，卡號與卡片 ID 兩種網址都認得", async () => {
    await fetchBoard();
    expect(recallCard("role-abc")?.name).toBe("夜行偵探");
    expect(recallCard("100021")?.name).toBe("夜行偵探");
    expect(recallCard("沒看過的卡")).toBeNull();
  });

  it("卡片請求還沒回來，畫面上已經有名字、簡介、標籤與操作列，而且沒有骨架屏", async () => {
    await fetchBoard();
    const root = await mountCard("/cards/role-abc");

    expect(root.textContent).toContain("夜行偵探");
    expect(root.textContent).toContain("民國背景推理");
    expect(root.textContent).toContain("推理");
    expect(root.querySelector(".role__actions"), "操作列要在第一畫面就出現").not.toBeNull();
    expect(root.querySelectorAll(".ghost").length, "手上有卡就不該再畫骨架屏").toBe(0);
    // 伺服器那一份還是要去拿（瀏覽數要記、資料可能變了），只是在背景
    expect(cardRequests).toBe(1);
  });

  it("先畫出來的頁面不能變淡、不能擋點擊——那是換語言時才有的樣子", async () => {
    await fetchBoard();
    const root = await mountCard("/cards/role-abc");
    expect(root.querySelector("[aria-busy='true']")).toBeNull();
  });

  it("沒看過的卡（直接開連結）照舊畫骨架屏", async () => {
    const root = await mountCard("/cards/role-never-seen");
    expect(root.querySelectorAll(".ghost").length).toBeGreaterThan(0);
  });
});

it("評論直接排在頁面上，不藏在分頁裡；進頁只讀一次", async () => {
  await fetchBoard(); const root = await mountCard("/cards/role-abc");
  expect(root.querySelector("#comments")).not.toBeNull();
  expect(root.querySelector('[role="tablist"]')).toBeNull();
  expect(commentRequests).toBe(1);
});

it('discovers play services by the community card ID, independently of its hosted role ID', async () => {
  await fetchBoard(); await mountCard('/cards/role-abc');
  expect(platformRequests).toEqual(['/v1/cards/abc/platforms']);
});

it('offers the owner a provider-scoped editor for the draft behind a neutral detail link', async () => {
  const { rememberCard } = await import('../src/lib/card-memory');
  const { useSession } = await import('../src/lib/session');
  rememberCard({...CARD,roleId:'owner-draft',sourceRoleId:'editable-source',status:'unlisted'});
  const root = await mountCard('/cards/owner-draft');
  const session=useSession();
  session.me={accountNumId:7,nickName:'Fixture author',avatar:''};
  session.profile={identities:[{provider:'lunatalk',externalId:7}]} as any;
  await flush();
  expect(root.querySelector('a[href="/cards/100021/edit?provider=lunatalk"]')).not.toBeNull();
  expect([...root.querySelectorAll('button')].some(e=>e.textContent?.trim()===i18n.global.t('mine.action.submit'))).toBe(true);
  session.profile={identities:[{provider:'harbor',externalId:7}]} as any;
  session.me=null;
  await flush();
  expect(root.querySelector('a[href*="/edit?"]')).toBeNull();
});

function detailFetch(detail: Promise<Response>, card = CARD) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url.includes("/role/detail")) return detail;
    if (url.includes("/v1/cards?")) return Promise.resolve(new Response(JSON.stringify({ items: [{ ...card, provider: "harbor" }], total: 1, hasNext: false, limit: 24, offset: 0, sort: "hot" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    return fakeFetch(input, init);
  };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("作者寫的介紹", () => {
  it("詳情到之前先畫骨架；到了照 Markdown 畫，不顯示開場白", async () => {
    let answer!: (r: Response) => void;
    vi.stubGlobal("fetch", detailFetch(new Promise<Response>((r) => { answer = r; })));
    await fetchBoard();
    const root = await mountCard("/cards/role-abc");
    expect(root.querySelector(".role__intro-ghost"), "介紹到之前要有占位").not.toBeNull();
    // 評論不必等介紹
    expect(root.querySelector("#comments")).not.toBeNull();
    answer(ok({ roleReadme: "# 怎麼玩\n\n每回合**選一個**線索。", roleWelcome: "雨夜，你推開了偵探社的門。" }));
    await flush();
    expect(root.querySelector(".role__intro-ghost")).toBeNull();
    expect(root.querySelector(".readme h3")?.textContent).toBe("怎麼玩");
    expect(root.querySelector(".readme strong")?.textContent).toBe("選一個");
    expect(root.textContent).not.toContain("雨夜，你推開了偵探社的門。");
  });

  it("沒寫介紹、簡介又短：不另外放一塊，簡介只在頁首出現一次", async () => {
    vi.stubGlobal("fetch", detailFetch(Promise.resolve(ok({ roleReadme: "" }))));
    await fetchBoard();
    const root = await mountCard("/cards/role-abc");
    expect(root.querySelector(".role__intro-ghost")).toBeNull();
    expect(root.querySelector("[data-tour='card-intro']")).toBeNull();
    expect(root.textContent!.split("民國背景推理").length - 1).toBe(1);
  });

  it("沒寫介紹、簡介很長（舊卡把整段介紹塞在簡介裡）：把簡介當介紹顯示", async () => {
    const long = "雨夜的上海，".repeat(30);
    vi.stubGlobal("fetch", detailFetch(Promise.resolve(ok({})), { ...CARD, summary: long }));
    await fetchBoard();
    const root = await mountCard("/cards/role-abc");
    expect(root.querySelector("[data-tour='card-intro'] .role__text")?.textContent).toBe(long);
  });
});

/**
 * 開始對話一定在第一屏（owner 2026-10-11）：排在身分列裡、名字與作者下面，不在可以很長的下半部。
 * 右欄量好自己的高度交給 CSS，放不下就先跟著頁面捲再貼住。
 */
describe("開始對話搆得到", () => {
  it("遊玩區在身分列裡、分級標示緊跟在後；右欄的高度寫進 --side-h", async () => {
    let resize: (() => void) | null = null;
    vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resize = cb; } observe() {} disconnect() {} });
    await fetchBoard();
    const root = await mountCard("/cards/role-abc");
    const hero = root.querySelector<HTMLElement>(".role__hero")!;
    expect(hero.querySelector(".role__platforms")).not.toBeNull();
    expect(root.querySelector(".role__body .role__platforms")).toBeNull();
    const side = root.querySelector<HTMLElement>(".role__side")!;
    Object.defineProperty(side, "offsetHeight", { configurable: true, get: () => 1240 });
    expect(resize, "右欄要被量高度").not.toBeNull();
    resize!();
    expect(side.style.getPropertyValue("--side-h")).toBe("1240px");
  });
});
