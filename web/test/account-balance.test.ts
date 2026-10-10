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
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; });

async function mount(wallet: { score: number; tempScore: number } | null) {
  el = document.createElement("div");
  document.body.appendChild(el);
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSession();
  session.me = { accountNumId: 7, nickName: "Mock", avatar: "" } as never;
  session.wallet = wallet ? { ...wallet, plans: [] } : null;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  app = createApp(AccountMenu).use(pinia).use(router).use(i18n);
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
