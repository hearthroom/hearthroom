// 「積分與會員」HarperHarbor 標題列右側的錢包入口（任務 2026-11-19-wallet-harbor-link）：兌換碼、收支、API 都從 HarperHarbor 錢包頁走。
// 入口是純連結，錢包讀不到時也要在。
import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 1 }, accessToken: async () => "tok", refreshWallet: async () => undefined }) }));
vi.mock("../src/lib/connections", async (orig) => ({ ...(await orig<object>()), accountToken: async () => "tok" }));
const track = vi.fn();
vi.mock("../src/lib/track", async (orig) => ({ ...(await orig<object>()), track: (...a: unknown[]) => track(...a) }));
import ServiceWallet from "../src/components/ServiceWallet.vue";
import { WALLET_PAGE } from "../src/lib/topup";

let app: ReturnType<typeof createApp> | undefined;
afterEach(() => { app?.unmount(); vi.unstubAllGlobals(); track.mockReset(); });

async function mount() {
  i18n.global.locale.value = "zh-Hant";
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  app = createApp(ServiceWallet, { provider: "harbor", externalId: 1 }).use(createPinia()).use(router).use(i18n);
  const root = document.createElement("div"); app.mount(root);
  for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); }
  return root;
}

it("標題列右側有開到 HarperHarbor 錢包頁的入口，新分頁開、記一筆點擊；錢包讀不到時照常顯示", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
  const root = await mount();
  const head = root.querySelector(".wallet__head")!;
  expect(head.querySelector("h2")?.textContent).toBe("HarperHarbor");
  const link = head.querySelector<HTMLAnchorElement>("a[data-testid=wallet-harbor-link]")!;
  expect(link.getAttribute("href")).toBe(WALLET_PAGE);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(link.classList.contains("btn--ghost")).toBe(false);
  expect(link.textContent).toContain("兌換碼與帳務");
  expect(link.querySelector(".sr-only")?.textContent).toContain("在新分頁開啟");
  link.dispatchEvent(new MouseEvent("click", { cancelable: true }));
  expect(track).toHaveBeenCalledWith("cta", { detail: "harbor_wallet", subject: "wallet" });
});
