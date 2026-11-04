import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));

import AccountMenu from "../src/components/AccountMenu.vue";
import { useSession } from "../src/lib/session";

let app: App | null = null;
let el: HTMLElement | null = null;
// 選單打開後簽到、審核會在背景讀取；這裡只看積分，一律回 404
vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; });

async function mount(wallet: { score: number; tempScore: number } | null, props: { compact?: boolean } = {}) {
  el = document.createElement("div");
  document.body.appendChild(el);
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSession();
  session.me = { accountNumId: 7, nickName: "Mock", avatar: "" } as never;
  // 有效的登入：選單打開後背景的簽到、審核讀取不會因為換發失敗把人登出
  session.token = { accessToken: "tok", refreshToken: "r", expiresAt: Date.now() + 3_600_000 } as never;
  session.wallet = wallet ? { ...wallet, plans: [] } : null;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  app = createApp(AccountMenu, props).use(pinia).use(router).use(i18n);
  app.mount(el);
  await nextTick();
  return el;
}

// 頁首的積分鈕要有資訊量：顯示餘額本身，讀不到就不放，不留一顆只寫「積分與會員」的鈕（owner 2026-10-11）
describe("頁首的積分", () => {
  it("顯示實際餘額（一般＋限時），點了去積分頁", async () => {
    const root = await mount({ score: 12000, tempScore: 345 });
    const link = root.querySelector<HTMLAnchorElement>(".acct__credits")!;
    expect(link.textContent?.trim()).toBe("12,345");
    expect(link.getAttribute("href")).toBe("/wallet");
  });

  it("百萬以上縮寫，免得把頁首撐開", async () => {
    const root = await mount({ score: 1_234_567, tempScore: 0 });
    expect(root.querySelector(".acct__credits")?.textContent?.trim()).not.toBe("1,234,567");
  });

  it("讀不到餘額就整顆不放", async () => {
    const root = await mount(null);
    expect(root.querySelector(".acct__credits")).toBeNull();
  });
});

// 手機沒有頁首那顆積分鈕，頭像選單裡的「積分與會員」直接帶出餘額，不用再點進去看（酒館大廳玩家 2026-11-04）
describe("頭像選單裡的積分", () => {
  async function walletItem(wallet: { score: number; tempScore: number } | null, compact = true) {
    const root = await mount(wallet, { compact });
    root.querySelector<HTMLButtonElement>(".acct__btn")!.click();
    await nextTick();
    return root.querySelector<HTMLAnchorElement>('.menu__item[href="/wallet"]')!;
  }

  it("「積分與會員」右側顯示餘額，格式跟頁首一樣", async () => {
    const item = await walletItem({ score: 12000, tempScore: 345 });
    expect(item.querySelector(".menu__aside")?.textContent?.trim()).toBe("12,345");
  });

  it("寬頁首的選單不帶：餘額鈕就在頭像旁邊", async () => {
    const item = await walletItem({ score: 12000, tempScore: 345 }, false);
    expect(item.querySelector(".menu__aside")).toBeNull();
  });

  it("讀不到餘額（載入中或失敗）就只留標籤", async () => {
    const item = await walletItem(null);
    expect(item.querySelector(".menu__aside")).toBeNull();
    expect(item.textContent?.trim()).toBe(item.textContent?.trim().replace(/\d/g, ""));
  });
});
