/**
 * 頭像選單：項目一多就要分組，不然找一個固定入口要從頭讀到尾。
 *   - 名字那一塊本身就是去「我的」的入口，不再另列一行「我的」；
 *   - 頁首已經有入口的不重複：通知有鈴鐺，對話與收藏有頂部分頁；
 *   - 其餘分成帳號、創作、設定三組，登出永遠在最底、跟其他項目隔開。
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
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board", setSurface: () => {} }));

import AccountMenu from "../src/components/AccountMenu.vue";
import { useSession } from "../src/lib/session";

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  if (url.includes("/open/v1/me/rewards")) return rewards ? json(rewards) : json({ error: "rewards_disabled" }, 404);
  if (url.includes("/open/v1/me")) return json({ accountNumId: 7, nickName: "月光", avatar: "" });
  if (url.endsWith("/v1/me")) return json({ handle: "abcdefgh", memberSince: 0, reviewer: false, identities: [], hiddenTags: [], showNsfw: false, ageVerified: false, adultConsent: false });
  return json({ error: "not_found" }, 404);
}

let rewards: unknown = null;
const panel = (todayClaimed: boolean) => ({ serverNow: "2026-10-20T10:00:00+08:00", businessDay: "2026-10-20", nextResetAt: "2026-10-21T04:00:00+08:00", weekResetAt: "2026-10-26T04:00:00+08:00", planVersion: 1,
  checkin: { streak: 3, todayClaimed, todayChests: todayClaimed ? [] : ["daily"], fallback: null, track: [], nextMilestone: null, makeup: { left: 0, repairableDays: [] } },
  today: { claims: [] }, tasks: { daily: [], weekly: [] }, newcomer: null, hints: [] });
let app: App | null = null;
let el: HTMLElement | null = null;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };

async function openMenu() {
  el = document.createElement("div");
  document.body.appendChild(el);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  const pinia = createPinia();
  setActivePinia(pinia);
  await useSession().restore();
  app = createApp(AccountMenu);
  app.use(pinia).use(router).use(i18n);
  await router.push("/");
  await router.isReady();
  app.mount(el);
  await flush();
  document.querySelector<HTMLButtonElement>(".acct__btn")!.click();
  await flush();
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}

const hrefs = (root: Element) => [...root.querySelectorAll<HTMLAnchorElement>("a")].map((a) => a.getAttribute("href"));

beforeEach(() => { vi.stubGlobal("fetch", fakeFetch); setActivePinia(createPinia()); });
afterEach(() => { rewards = null; app?.unmount(); el?.remove(); app = null; el = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

describe("頭像選單分組", () => {
  it("名字那一塊就是「我的」的入口，不再另列一行", async () => {
    const menu = await openMenu();
    const head = menu.querySelector<HTMLAnchorElement>("a.menu__head");
    expect(head?.getAttribute("href")).toBe("/me");
    expect(head?.textContent).toContain(useSession().displayName);
    expect(hrefs(menu).filter((h) => h === "/me")).toHaveLength(1);
  });

  it("頁首已有入口的通知、對話與收藏不再重複", async () => {
    const menu = await openMenu();
    expect(hrefs(menu)).not.toContain("/me/notifications");
    expect(hrefs(menu)).not.toContain("/library");
  });

  it("其餘項目分組，登出在最底且自成一組", async () => {
    rewards = panel(true);
    const menu = await openMenu();
    const groups = [...menu.querySelectorAll(".menu__group")];
    expect(groups.length).toBe(4);
    expect(hrefs(groups[0])).toEqual(["/wallet", "/checkin"]);
    expect(hrefs(groups[1])).toContain("/mine");
    // 更新紀錄、部落格、活動中心跟設定、開發者文件同一組：都是「關於這個站」而不是「我的東西」
    expect(hrefs(groups[2])).toEqual(["/settings", "/developers", "/updates?from=menu", "/blog", "/campaigns"]);
    const last = groups[groups.length - 1];
    expect(last.querySelectorAll("a")).toHaveLength(0);
    expect(last.textContent).toContain(i18n.global.t("nav.logout"));
    expect(menu.lastElementChild).toBe(last);
  });

  it("活動中心用 spark 圖示（跟「我的」頁一致），gift 留給邀請", async () => {
    const menu = await openMenu();
    const icon = (href: string) => menu.querySelector(`a[href="${href}"] svg`)!.innerHTML;
    expect(icon("/campaigns")).toBe(icon("/updates?from=menu"));
  });

  it("今天還沒簽到：選單的「簽到」與頭像各有一個點；簽過就沒有", async () => {
    rewards = panel(false);
    let menu = await openMenu();
    expect(menu.querySelector('a[href="/checkin"] .menu__dot')).not.toBeNull();
    expect(document.querySelector(".acct__btn .acct__dot")).not.toBeNull();
    app?.unmount(); el?.remove(); document.body.innerHTML = "";
    rewards = panel(true);
    menu = await openMenu();
    expect(menu.querySelector('a[href="/checkin"] .menu__dot')).toBeNull();
    expect(document.querySelector(".acct__btn .acct__dot")).toBeNull();
  });

  it("這個應用沒有開獎勵：選單不出現簽到", async () => {
    const menu = await openMenu();
    expect(hrefs(menu)).not.toContain("/checkin");
  });
});
