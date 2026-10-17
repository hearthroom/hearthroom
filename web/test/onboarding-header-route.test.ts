import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { tourState } from "../src/lib/coach-tour";
import { guestAdult } from "../src/lib/adult-consent";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ ready: true, me: null, profile: null, restore: async () => {}, accessToken: async () => null }) }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board", setSurface: () => {} }));
vi.mock("../src/lib/notifications", () => ({ useNotifications: () => ({ refresh: async () => {} }) }));
vi.mock("../src/lib/review", () => ({ useReviewer: () => ({ refresh: async () => {} }) }));
vi.mock("../src/lib/appearance", () => ({ useAppearance: () => ({ init: () => {} }) }));
vi.mock("../src/lib/updates", () => ({ useUpdates: () => ({ load: async () => {}, visited: () => {} }) }));
vi.mock("../src/lib/share-ref", () => ({ watchShareRefBinding: () => {}, watchCampaignShareBinding: () => {}, campaignShareFromQuery: () => null }));
vi.mock("../src/lib/community", () => ({ communityRequest: async () => ({ invite: null }) }));
vi.mock("../src/components/SearchSuggest.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/components/AccountMenu.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/components/AppearanceMenu.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/components/LocaleSwitch.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/components/NewMark.vue", () => ({ default: { template: "<span />" } }));
vi.mock("../src/components/ConfirmDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/components/RatingDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/components/InstallToast.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/components/SukiPet.vue", () => ({ default: { template: "<div />" } }));
import App from "../src/App.vue";
import { forgetGuestAdult } from "../src/lib/adult-consent";

const Home = defineComponent({ render: () => h("div", { "data-tour": "starter" }, "starter") });
const Card = defineComponent({ render: () => h("div", [h("div", { "data-tour": "card-grade" }, "PG15"), h("button", { "data-tour": "card-play" }, "play")]) });
let app: ReturnType<typeof createApp> | undefined;
let root: HTMLElement;
let router: Router;
const settle = async () => { await new Promise(r => setTimeout(r, 260)); await nextTick(); };
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); tourState.step = null; tourState.card = 0;
  forgetGuestAdult();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ showNsfw: false, ageVerified: false, adultConsent: false }), { headers: { "Content-Type": "application/json" } })));
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => { app?.unmount(); root?.remove(); vi.unstubAllGlobals(); });
async function mount(path: string, locale: "zh-Hant" | "zh-Hans") {
  i18n.global.locale.value = locale;
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:locale(zh-Hans)?", children: [{ path: "", component: Home }, { path: "cards/:id", component: Card }, { path: ":pathMatch(.*)*", component: { template: "<div />" } }] }] });
  await router.push(path);
  root = document.createElement("div"); document.body.append(root);
  app = createApp(App).use(router).use(i18n); app.mount(root); await settle();
}
it.each(["/", "/zh-Hans", "/zh-Hans/"])("%s keeps the real header adult target and SFW tour reachable", async path => {
  await mount(path, path.startsWith("/zh-Hans") ? "zh-Hans" : "zh-Hant");
  expect(root.querySelector('button.r18[role="switch"]')).not.toBeNull();
  const next = () => [...root.querySelectorAll<HTMLButtonElement>(".coach button")].find(b => b.textContent?.trim() === i18n.global.t("tour.next"))!;
  next().click(); await settle();
  expect(tourState.step).toBe("r18");
  expect(root.querySelector(".coach")).not.toBeNull();
  (root.querySelector(".coach__close") as HTMLButtonElement).click(); await settle();
  next().click(); await settle();
  expect(router.currentRoute.value.path).toBe(path.startsWith("/zh-Hans") ? "/zh-Hans/cards/100216" : "/cards/100216");
  expect(guestAdult.showNsfw).toBe(false);
});
it.each(["/cards/100216", "/zh-Hans/cards/100216", "/zh-Hans/cards/100216/"])("%s keeps the header adult toggle off non-home pages", async path => {
  await mount(path, path.startsWith("/zh-Hans") ? "zh-Hans" : "zh-Hant");
  expect(root.querySelector("button.r18")).toBeNull();
});
