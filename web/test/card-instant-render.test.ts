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
vi.mock("../src/lib/html-card-frame", () => ({ buildSrcdoc: () => "", SIZE_MESSAGE: "hc-card-size" }));

import CardPage from "../src/pages/CardPage.vue";
import { fetchBoard } from "../src/lib/api";
import { recallCard } from "../src/lib/card-memory";

const CARD = {
  id: "abc", roleId: "role-abc", num: 100021, zone: "zh", name: "夜行偵探", summary: "民國背景推理",
  names: { zh: "夜行偵探", en: "", ja: "", ko: "" }, summaries: { zh: "民國背景推理", en: "", ja: "", ko: "" },
  avatarUrl: null, backgroundUrl: null, slug: null, tags: ["推理"],
  author: { handle: "abcdefgh", accountNumId: 7, name: "月光", avatar: "" },
  talkNum: 12, followNum: 3, trending: 0, registeredAt: 1, syncedAt: 1, provider: "lunatalk", nsfw: false,
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

it("loads the full comments panel only on first open and preserves it across tabs", async () => {
  await fetchBoard(); const root = await mountCard("/cards/role-abc");
  // 主頁的評論摘要讀一次第一頁；完整的評論區要到打開分頁才載
  expect(commentRequests).toBe(1);
  (root.querySelector("#tab-comments") as HTMLButtonElement).click(); await flush();
  expect(commentRequests).toBe(2);
  (root.querySelector("#tab-home") as HTMLButtonElement).click(); await flush();
  (root.querySelector("#tab-comments") as HTMLButtonElement).click(); await flush();
  expect(commentRequests).toBe(2);
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
