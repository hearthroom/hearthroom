/**
 * 新手引導（owner 2026-10-10，照魅魔島）：一頁一頁框出要點的地方，「下一步」自動跳頁。
 * 這裡用三個替身頁（首頁、卡片頁、對話頁）放上引導要框的元件，照真的路由走一遍。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { nextStep, prevStep, stepsOf, tourState } from "../src/lib/coach-tour";

const starters = vi.hoisted(() => ({ zh: { general: null as number | null, adult: null as number | null }, en: { general: null, adult: null }, ja: { general: null, adult: null }, ko: { general: null, adult: null } }));
vi.mock("../../shared/starter-cards", () => ({ STARTER_CARDS: starters }));
const session = vi.hoisted(() => ({ ready: true, me: null as null | { accountNumId: number }, profile: null as null | { memberSince: number; showNsfw: boolean } }));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));
const guest = vi.hoisted(() => ({ loaded: true, available: true, showNsfw: false, ageVerified: false, adultConsent: false }));
vi.mock("../src/lib/adult-consent", () => ({ guestAdult: guest, loadGuestAdult: async () => {}, viewerAdult: () => (session.me ? session.profile : guest) }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));

import CoachTour from "../src/components/CoachTour.vue";

describe("步驟", () => {
  const base = { adult: false, sandbox: false, prologue: true };
  it("一般卡：首頁 → 卡片頁 → 開場 → 開場選項", () => {
    expect(stepsOf(base)).toEqual(["card", "intro", "play", "opening", "prologue"]);
    expect(stepsOf({ ...base, adult: true })[0]).toBe("r18");
  });
  it("一般卡沒有開場選項：開場就是最後一步", () => {
    expect(nextStep("opening", { ...base, prologue: false })).toBeNull();
  });
  it("同層卡：對話頁只有一步，提示貼底", () => {
    expect(stepsOf({ ...base, sandbox: true }).slice(-1)).toEqual(["stage"]);
  });
  it("上一步可以回到上一頁那一步；第一步沒有上一步", () => {
    expect(prevStep("intro", base)).toBe("card");
    expect(prevStep("card", base)).toBeNull();
  });
});

let app: ReturnType<typeof createApp> | undefined; let root: HTMLElement | undefined; let router: Router;
let sandboxPlay = false;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { await wait(260); await nextTick(); };
const Home = defineComponent({ render: () => h("div", [h("button", { class: "r18" }, "R18"), h("div", { "data-tour": "starter" }, "starter")]) });
const Card = defineComponent({ render: () => h("div", [h("section", { "data-tour": "card-intro" }, "intro"), h("button", { "data-tour": "card-play" }, "play")]) });
const Play = defineComponent({ render: () => sandboxPlay ? h("iframe", { "data-lt": "sandbox-frame" }) : h("div", [h("div", { "data-lt": "message" }, "opening"), h("div", { "data-lt": "prologue" }, "options")]) });

async function mount(path = "/") {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: Home }, { path: "/cards/:id", component: Card }, { path: "/play/:id", component: Play }] });
  await router.push(path);
  root = document.createElement("div"); document.body.append(root);
  app = createApp(defineComponent({ render: () => [h(RouterView), h(CoachTour)] })).use(router).use(i18n);
  app.mount(root);
  await settle();
}
const title = () => document.querySelector("#coach-title")?.textContent ?? null;
const t = (k: string) => i18n.global.t(k);
async function press(key: string) {
  [...document.querySelectorAll<HTMLButtonElement>(".coach button")].find((b) => b.textContent?.trim() === t(key))!.click();
  await settle();
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); i18n.global.locale.value = "zh-Hant";
  Element.prototype.scrollIntoView = () => {};
  starters.zh.general = 100001; starters.zh.adult = null;
  session.me = null; session.profile = null; guest.showNsfw = false; guest.available = true; sandboxPlay = false;
  tourState.step = null; tourState.card = 0;
});
afterEach(() => { app?.unmount(); root?.remove(); app = undefined; });

describe("走一遍", () => {
  it("一般卡：框入門卡 → 下一步跳卡片頁 → 簡介 → 開始對話 → 下一步跳對話頁 → 開場 → 開場選項 → 完成", async () => {
    await mount();
    expect(title()).toBe(t("tour.card.title"));
    await press("tour.next");
    expect(router.currentRoute.value.path).toBe("/cards/100001");
    expect(title()).toBe(t("tour.intro.title"));
    await press("tour.next");
    expect(title()).toBe(t("tour.play.title"));
    await press("tour.next");
    expect(router.currentRoute.value.path).toBe("/play/100001");
    expect(title()).toBe(t("tour.opening.title"));
    await press("tour.next");
    expect(title()).toBe(t("tour.prologue.title"));
    await press("tour.done");
    expect(title()).toBeNull();
    expect(localStorage.getItem("hr-tour-done")).toBe("1");
  });

  it("有成人版、還沒開：首頁先框 R18", async () => {
    starters.zh.adult = 100002;
    await mount();
    expect(title()).toBe(t("tour.r18.title"));
    await press("tour.next");
    expect(title()).toBe(t("tour.card.title"));
  });

  it("在 R18 那一步開了成人內容：帶去成人版", async () => {
    starters.zh.adult = 100002;
    await mount();
    guest.showNsfw = true;
    await press("tour.next");
    await press("tour.next");
    expect(router.currentRoute.value.path).toBe("/cards/100002");
  });

  it("同層卡：對話頁只剩一步，按完成就結束", async () => {
    sandboxPlay = true;
    await mount();
    await press("tour.next"); await press("tour.next"); await press("tour.next");
    expect(title()).toBe(t("tour.stage.title"));
    await press("tour.done");
    expect(title()).toBeNull();
  });

  it("直接點了入門卡或開始對話，不按下一步：一樣往下走", async () => {
    await mount();
    await router.push("/cards/100001"); await settle();
    expect(title()).toBe(t("tour.intro.title"));
    await router.push("/play/100001"); await settle();
    expect(title()).toBe(t("tour.opening.title"));
  });

  it("上一步會跳回上一頁", async () => {
    await mount();
    await press("tour.next");
    await press("tour.prev");
    expect(router.currentRoute.value.path).toBe("/");
    expect(title()).toBe(t("tour.card.title"));
  });

  it("略過：收起來，這台裝置不再出現", async () => {
    await mount();
    (document.querySelector(".coach__close") as HTMLButtonElement).click();
    await settle();
    expect(title()).toBeNull();
    app!.unmount(); root!.remove(); tourState.step = null;
    await mount();
    expect(title()).toBeNull();
  });

  it("這個語言沒設入門卡、或是老成員：不出現", async () => {
    starters.zh.general = null;
    await mount();
    expect(title()).toBeNull();
    app!.unmount(); root!.remove();
    starters.zh.general = 100001; session.me = { accountNumId: 1 }; session.profile = { memberSince: Date.now() - 30 * 86_400_000, showNsfw: false };
    await mount();
    expect(title()).toBeNull();
  });
});
