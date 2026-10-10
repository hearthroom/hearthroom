/**
 * 卡片頁的分享：按下去出一張自己的面板，不是系統的。
 *
 * 回報 2026-09-30（桌面 Safari）：按分享跳出「加入閱讀列表／隔空投送／備忘錄／提醒事項」，
 * 全是本機去處，沒有一個能把卡片連結交給朋友。
 *
 * 手機的系統面板裡確實有聊天軟體，而且是微信、QQ、Discord 這些沒有網頁入口的唯一去處，
 * 所以它留著——但降成面板裡的「更多」，不是取代面板：同一個按鈕在哪裡按都長一樣。
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
const tracked: { detail?: string; subject?: string }[] = [];
vi.mock("../src/lib/track", () => ({
  track: (_e: string, p: { detail?: string; subject?: string } = {}) => { tracked.push(p); },
  currentSurface: () => "card",
  setSurface: () => {},
}));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));
vi.mock("../src/lib/html-card-frame", () => ({ buildSrcdoc: () => "", SIZE_MESSAGE: "hc-card-size" }));

import CardPage from "../src/pages/CardPage.vue";
import { fetchBoard } from "../src/lib/api";

const CARD = {
  id: "abc", roleId: "role-abc", num: 100146, zone: "zh", name: "末日・進化", summary: "廢土求生",
  names: { zh: "末日・進化", en: "", ja: "", ko: "" }, summaries: { zh: "廢土求生", en: "", ja: "", ko: "" },
  avatarUrl: null, backgroundUrl: null, slug: null, tags: ["末日"],
  author: { handle: "abcdefgh", accountNumId: 7, name: "月光", avatar: "" },
  talkNum: 12, followNum: 3, trending: 0, registeredAt: 1, syncedAt: 1, provider: "lunatalk", rating: null,
};

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  if (url.includes("/comments")) return json({ total: 0, comments: [], isRoleCreator: false });
  if (/\/v1\/cards\/[^?]+\?/.test(url)) return new Promise(() => {});
  if (url.includes("/v1/cards?")) return json({ items: [CARD], total: 1, hasNext: false, limit: 24, offset: 0, sort: "hot" });
  if (url.endsWith("/v1/me")) return json({ error: "unauthorized" }, 401);
  return json({ error: "not_found" }, 404);
}

let app: App | null = null;
let el: HTMLElement | null = null;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };

async function mountCard() {
  el = document.createElement("div");
  document.body.appendChild(el);
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

/** 指標粗細與觸控點數，是「手持裝置還是桌機」唯一分得出來的兩件事。 */
function pretendDevice(coarse: boolean, touchPoints: number) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("pointer: coarse") ? coarse : false, media: q }));
  Object.defineProperty(navigator, "maxTouchPoints", { value: touchPoints, configurable: true });
}

const nativeShare = vi.fn(async () => {});
const writeText = vi.fn(async () => {});
/** 分享出去的是卡片自己的固定網址（卡片 ID），不是當下這一條路由——換個入口進來，分享出去的還是同一條連結。 */
const SHARE_URL = "http://localhost:3000/cards/abc";

/** 開面板，回傳面板裡那一排項目。 */
async function openPanel(root: HTMLElement) {
  (root.querySelector(".sh__btn") as HTMLButtonElement).click();
  await flush();
  return [...root.querySelectorAll<HTMLElement>(".sh__item")];
}
const labelsOf = (items: HTMLElement[]) => items.map((n) => n.querySelector(".sh__name")?.textContent?.trim());

beforeEach(() => {
  vi.stubGlobal("fetch", fakeFetch);
  setActivePinia(createPinia());
  tracked.length = 0;
  nativeShare.mockClear();
  writeText.mockClear();
  Object.defineProperty(navigator, "share", { value: nativeShare, configurable: true });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  app?.unmount(); el?.remove(); app = null; el = null;
  vi.unstubAllGlobals();
  // 量版面的那幾個假動作會留在原型上，不收掉會污染後面的案例
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollHeight;
  delete (HTMLElement.prototype as Partial<HTMLElement>).offsetWidth;
  document.documentElement.style.removeProperty("--header-h");
});

describe("卡片頁的分享面板", () => {
  it("桌面：出自己的面板，不叫系統分享", async () => {
    pretendDevice(false, 0);
    await fetchBoard();
    const root = await mountCard();

    const items = await openPanel(root);
    expect(nativeShare, "桌面的系統面板只有本機去處，對分享卡片沒有用").not.toHaveBeenCalled();
    expect(items.length, "複製連結 + 四個有網頁入口的去處").toBe(5);
    expect(labelsOf(items).slice(1)).toEqual(["X", "Telegram", "Reddit", "LINE"]);
    expect(labelsOf(items)[0], "複製連結排第一：微信、QQ、Discord 只能靠它").toBeTruthy();
  });

  it("每個去處都是一條帶著本頁網址的連結，而且開在新分頁", async () => {
    pretendDevice(false, 0);
    await fetchBoard();
    const root = await mountCard();
    const links = (await openPanel(root)).filter((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement);

    const encoded = encodeURIComponent(SHARE_URL);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      expect.stringContaining(`https://x.com/intent/post?url=${encoded}&text=`),
      expect.stringContaining(`https://t.me/share/url?url=${encoded}&text=`),
      expect.stringContaining(`https://www.reddit.com/submit?url=${encoded}&title=`),
      `https://social-plugins.line.me/lineit/share?url=${encoded}`,
    ]);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel"), "開新分頁一定要切斷 opener").toContain("noopener");
    }

    links[0].click();
    await flush();
    expect(tracked).toContainEqual({ detail: "share_x", subject: "role-abc" });
  });

  it("複製連結：拿到的是本頁網址，而且當場看得到已複製", async () => {
    pretendDevice(false, 0);
    await fetchBoard();
    const root = await mountCard();
    const [copy] = await openPanel(root);

    copy.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(SHARE_URL);
    expect(root.querySelector(".sh__item.is-done"), "要讓人看到「已複製」").not.toBeNull();
    expect(tracked).toContainEqual({ detail: "share_clipboard", subject: "role-abc" });
  });

  it("手機：面板照出，多一條「更多」通到系統面板", async () => {
    pretendDevice(true, 5);
    await fetchBoard();
    const root = await mountCard();
    const items = await openPanel(root);

    expect(items.length, "複製連結 + 四個去處 + 更多").toBe(6);
    items[items.length - 1].click();
    await flush();
    expect(nativeShare).toHaveBeenCalledWith({ title: "末日・進化", url: SHARE_URL });
    expect(tracked).toContainEqual({ detail: "share_web", subject: "role-abc" });
  });

  it("手機上按取消不算失敗，也不會再彈別的東西出來", async () => {
    pretendDevice(true, 5);
    nativeShare.mockRejectedValueOnce(Object.assign(new Error("cancel"), { name: "AbortError" }));
    await fetchBoard();
    const root = await mountCard();
    const items = await openPanel(root);

    items[items.length - 1].click();
    await flush();
    expect(writeText, "取消就是取消，不要順手複製").not.toHaveBeenCalled();
    expect(tracked).toContainEqual({ detail: "share_abort", subject: "role-abc", ok: false });
  });

  it("桌面沒有系統分享可走，所以面板裡不該出現「更多」", async () => {
    pretendDevice(false, 0);
    await fetchBoard();
    const root = await mountCard();
    const items = await openPanel(root);
    expect(items.length).toBe(5);
  });

  /** 按鈕在畫面上的位置，決定面板往哪邊開、要不要往右挪。jsdom 量不出版面，這裡直接給答案。 */
  function pretendButtonAt(top: number, height = 44, contentHeight = 232, right = 44) {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top, bottom: top + height, left: right - 44, right, width: 44, height, x: right - 44, y: top, toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { get: () => contentHeight, configurable: true });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { get: () => 216, configurable: true });
    vi.stubGlobal("innerHeight", 768);
    vi.stubGlobal("innerWidth", 1024);
    // 頁首浮在內容上，高度是站上的一個變數：往上開要讓開它
    document.documentElement.style.setProperty("--header-h", "60px");
  }

  it("按鈕靠近畫面底部時，面板往上開，不掉出畫面外", async () => {
    pretendDevice(false, 0);
    pretendButtonAt(700);
    await fetchBoard();
    const root = await mountCard();
    await openPanel(root);

    const p = root.querySelector(".sh__panel") as HTMLElement;
    expect(p.className, "下面只剩 12px，面板要翻上去").toContain("sh__panel--up");
    expect(p.style.getPropertyValue("--sh-max"), "頁首是浮的，往上開要讓開它（768 - 60 - 12 之外還要扣掉按鈕上緣）").toBe("628px");
  });

  it("按鈕在畫面上半部時照常往下開", async () => {
    pretendDevice(false, 0);
    pretendButtonAt(100);
    await fetchBoard();
    const root = await mountCard();
    await openPanel(root);
    expect((root.querySelector(".sh__panel") as HTMLElement).className).not.toContain("sh__panel--up");
  });

  it("上下都擠的時候挑大的那邊，而且不長過那一邊給得起的高度", async () => {
    pretendDevice(false, 0);
    // 視窗 768、頁首 60：按鈕上緣 400 → 上面 328、下面 324，兩邊都放不下 232 以外還想再多要
    pretendButtonAt(400, 44, 900);
    await fetchBoard();
    const root = await mountCard();
    await openPanel(root);

    const p = root.querySelector(".sh__panel") as HTMLElement;
    expect(p.className).toContain("sh__panel--up");
    expect(Number.parseInt(p.style.getPropertyValue("--sh-max"), 10)).toBe(328);
  });

  it("按鈕貼著畫面左邊時，面板往右挪回畫面裡", async () => {
    pretendDevice(false, 0);
    // 卡片頁的側欄就在畫面左邊：按鈕右緣只到 44，面板 216 寬，對齊右緣會讓左緣掉到 -172
    pretendButtonAt(100, 44, 232, 44);
    await fetchBoard();
    const root = await mountCard();
    await openPanel(root);

    const p = root.querySelector(".sh__panel") as HTMLElement;
    expect(p.style.getPropertyValue("--sh-shift"), "挪到左緣離畫面邊 12px").toBe("184px");
  });

  it("按鈕本來就離左邊夠遠時不要亂挪", async () => {
    pretendDevice(false, 0);
    pretendButtonAt(100, 44, 232, 800);
    await fetchBoard();
    const root = await mountCard();
    await openPanel(root);

    const p = root.querySelector(".sh__panel") as HTMLElement;
    expect(p.style.getPropertyValue("--sh-shift")).toBe("0px");
  });

  it("按 Esc 收起面板", async () => {
    pretendDevice(false, 0);
    await fetchBoard();
    const root = await mountCard();
    await openPanel(root);
    expect(root.querySelector(".sh__panel")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flush();
    expect(root.querySelector(".sh__panel")).toBeNull();
  });
});
