/**
 * 首頁的新手引導（owner 2026-10-10）：第一次來、還沒登入的訪客，引導他進一張入門卡。
 *   - 這個語言沒設入門卡：不出現（入門卡由營運寫好再填設定）。
 *   - 登入的人、看過的人：不出現。
 *   - 這組有成人版：先指出頁首的 R18 在哪；開了成人內容就帶去成人版，沒開就帶去一般版。
 *   - 略過或開始玩之後，這台裝置不再出現。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, reactive } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

const starters = vi.hoisted(() => ({ zh: { general: null as number | null, adult: null as number | null }, en: { general: null, adult: null }, ja: { general: null, adult: null }, ko: { general: null, adult: null } }));
vi.mock("../../shared/starter-cards", () => ({ STARTER_CARDS: starters }));
const session = vi.hoisted(() => ({ ready: true, me: null as null | { accountNumId: number }, profile: null }));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));
const guest = vi.hoisted(() => ({ loaded: true, available: true, showNsfw: false, ageVerified: false, adultConsent: false }));
vi.mock("../src/lib/adult-consent", async (original) => ({ ...(await original<typeof import("../src/lib/adult-consent")>()), guestAdult: guest, loadGuestAdult: async () => {}, viewerAdult: () => (session.me ? null : guest) }));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<typeof import("../src/lib/api")>()), fetchCard: async (id: string) => ({ id, num: Number(id), name: `卡${id}` }) }));

import WelcomeTour from "../src/components/WelcomeTour.vue";
import { tourFocus } from "../src/lib/onboarding";

let app: ReturnType<typeof createApp> | undefined; let root: HTMLElement | undefined;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
async function mount() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  root = document.createElement("div"); document.body.append(root);
  app = createApp(WelcomeTour).use(router).use(i18n); app.mount(root);
  await settle();
  return router;
}
const tour = () => root!.querySelector(".tour");
const button = (key: string) => [...root!.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t(key));
beforeEach(() => {
  localStorage.clear(); i18n.global.locale.value = "zh-Hant";
  starters.zh.general = null; starters.zh.adult = null; session.me = null; guest.showNsfw = false; guest.available = true; tourFocus.value = "";
});
afterEach(() => { app?.unmount(); root?.remove(); app = undefined; });

it("這個語言沒設入門卡：不出現", async () => {
  await mount();
  expect(tour()).toBeNull();
});

it("登入的人不出現", async () => {
  starters.zh.general = 100001; session.me = { accountNumId: 1 };
  await mount();
  expect(tour()).toBeNull();
});

it("只有一般版：直接指向入門卡，開始玩就進對話頁，之後不再出現", async () => {
  starters.zh.general = 100001;
  const router = await mount();
  expect(tour()?.textContent).toContain(i18n.global.t("tour.start.title"));
  expect(tour()?.textContent).toContain("卡100001");
  button("tour.start.go")!.click();
  await settle();
  expect(router.currentRoute.value.path).toBe("/play/100001");
  app!.unmount(); root!.remove();
  await mount();
  expect(tour()).toBeNull();
});

it("有成人版：先指出 R18；沒開成人內容就進一般版", async () => {
  starters.zh.general = 100001; starters.zh.adult = 100002;
  const router = await mount();
  expect(tour()?.textContent).toContain(i18n.global.t("tour.adult.title"));
  expect(tourFocus.value).toBe("r18");
  button("tour.next")!.click();
  await settle();
  expect(tourFocus.value).toBe("");
  button("tour.start.go")!.click();
  await settle();
  expect(router.currentRoute.value.path).toBe("/play/100001");
});

it("有成人版：在引導中開了成人內容，就帶去成人版", async () => {
  starters.zh.general = 100001; starters.zh.adult = 100002;
  const router = await mount();
  guest.showNsfw = true;
  button("tour.next")!.click();
  await settle();
  expect(tour()?.textContent, "介紹的是等一下要打開的那張").toContain("卡100002");
  button("tour.start.go")!.click();
  await settle();
  expect(router.currentRoute.value.path).toBe("/play/100002");
});

it("站上發不出遊客憑證（頁首沒有 R18 鈕）：不提 R18，直接指向入門卡", async () => {
  starters.zh.general = 100001; starters.zh.adult = 100002; guest.available = false;
  await mount();
  expect(tour()?.textContent).toContain(i18n.global.t("tour.start.title"));
  expect(tourFocus.value).toBe("");
});

it("已經開了成人內容（例如在卡片頁確認過年齡）：不再問 R18，直接指向成人版", async () => {
  starters.zh.general = 100001; starters.zh.adult = 100002; guest.showNsfw = true;
  await mount();
  expect(tour()?.textContent).toContain(i18n.global.t("tour.start.title"));
  expect(tour()?.textContent).toContain("卡100002");
  expect(tourFocus.value).toBe("");
});

it("略過：收起來，之後不再出現", async () => {
  starters.zh.general = 100001;
  await mount();
  button("tour.skip")!.click();
  await settle();
  expect(tour()).toBeNull();
  app!.unmount(); root!.remove();
  await mount();
  expect(tour()).toBeNull();
});

it("簡體中文跟繁體中文共用同一組入門卡", async () => {
  starters.zh.general = 100001; i18n.global.locale.value = "zh-Hans";
  await mount();
  expect(tour()).not.toBeNull();
});
