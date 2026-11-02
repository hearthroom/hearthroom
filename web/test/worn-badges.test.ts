/**
 * 名字旁的展示列（徽章第一期）：只放展示中的徽章、一排不折行、放不下的收成「+N」；
 * 作者沒有對外可見的徽章時整列連同「全部徽章」連結都不出現。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n, applyLocale } from "../src/lib/i18n";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/lib/community", async (original) => ({ ...(await original<object>()), communityRequest: api.request }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ profile: { handle: "me" }, accessToken: async () => "token" }) }));
import WornBadges from "../src/components/WornBadges.vue";

let app: App, el: HTMLDivElement;
const settle = async () => { for (let i = 0; i < 4; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } };
const badge = (key: string, extra: Record<string, unknown> = {}) => ({ key, icon: "star", category: "creation", titles: { en: `Title ${key}` }, descriptions: { en: `How to get ${key}` }, state: "earned", earnedAt: Date.UTC(2026, 9, 20), expiresAt: null, ...extra });
async function mount(collection: unknown, props: Record<string, unknown> = { handle: "moon" }) {
  api.request.mockResolvedValue(collection);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  app = createApp(WornBadges, props).use(router).use(i18n); app.mount(el); await settle();
}
beforeEach(async () => { vi.clearAllMocks(); await applyLocale("en"); el = document.createElement("div"); document.body.append(el); });
afterEach(() => { app?.unmount(); el.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

it("lists featured badges in the member's order, names board honors in full and counts repeats", async () => {
  await mount({ items: [badge("a"), badge("rank_clean_week_1", { icon: "award", category: "rank", count: 3, lastPeriod: "2026-11-02" }), badge("b")], featured: ["rank_clean_week_1", "a"] });
  expect(api.request).toHaveBeenCalledWith("/community/members/moon/badges", undefined);
  const labels = [...el.querySelectorAll(".worn__row .badge-label")];
  expect(labels.map((l) => l.querySelector(".badge-label__text")?.textContent)).toEqual(["SFW Weekly #1", "Title a"]);
  expect(labels[0].querySelector(".badge-label__times")?.textContent).toBe("×3");
  expect(labels[0].getAttribute("data-layers")).toBe("2");
  expect(el.querySelector(".worn__all")?.textContent).toBe("All badges (3)");
  expect(el.querySelector(".worn__all")?.getAttribute("href")).toBe("/authors/moon/badges");
});

it("shows nothing at all when the author has no public badges", async () => {
  await mount({ items: [], featured: [] });
  expect(el.querySelector(".worn")).toBeNull();
});

it("keeps the link but no empty row when badges are earned but none are featured", async () => {
  await mount({ items: [badge("a")], featured: [] });
  expect(el.querySelector(".worn__row")).toBeNull();
  expect(el.querySelector(".worn__all")?.textContent).toBe("All badges (1)");
});

it("hides labels from the end into +N so the row never wraps", async () => {
  // 每枚 100 寬、「+N」36 寬、列寬 250：100+8+100 = 208，再加 8+36 = 252 > 250，所以只留一枚
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-measure-plus") ? 36 : 100; });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("worn__row") ? 250 : 1000; });
  await mount({ items: ["a", "b", "c"].map((k) => badge(k)), featured: ["a", "b", "c"] });
  const visible = [...el.querySelectorAll<HTMLElement>(".worn__row > li")].filter((li) => li.style.display !== "none");
  expect(visible.map((li) => li.textContent?.trim())).toEqual(["Title a", "+2"]);
  expect(el.querySelector(".worn__more")?.getAttribute("aria-label")).toBe("2 more badges");
});

it("opens a detail layer with the period of the latest honor and closes it on Escape", async () => {
  await mount({ items: [badge("rank_all_month_10", { icon: "award", category: "rank", count: 1, lastPeriod: "2026-10-01" })], featured: ["rank_all_month_10"] });
  const opener = el.querySelector<HTMLButtonElement>(".worn__row button")!;
  opener.click(); await settle();
  const layer = document.querySelector(".worn-detail")!;
  expect(layer.querySelector("h3")?.textContent).toBe("Overall Monthly Top 10");
  expect(layer.textContent).toContain("Honor for October 2026");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await settle();
  expect(document.querySelector(".worn-detail")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("uses the collection the profile page already loaded instead of asking again", async () => {
  await mount(null, { handle: "me", own: true, collection: { items: [badge("a")], featured: ["a"], public: true } });
  expect(api.request).not.toHaveBeenCalled();
  expect(el.querySelector(".worn__all")?.getAttribute("href")).toBe("/me/badges");
});

it("keeps the entry to the badges page on your own profile even before you earn anything", async () => {
  await mount(null, { handle: "me", own: true, collection: { items: [], featured: [], public: false } });
  expect(el.querySelector(".worn__row")).toBeNull();
  expect(el.querySelector(".worn__all")?.getAttribute("href")).toBe("/me/badges");
});

it("keeps Tab inside the phone sheet even though its only stop is a link", async () => {
  vi.spyOn(window, "matchMedia").mockImplementation((q: string) => ({ matches: q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
  await mount({ items: [badge("a")], featured: ["a"] });
  el.querySelector<HTMLButtonElement>(".worn__row button")!.click(); await settle();
  const link = document.querySelector<HTMLAnchorElement>(".worn-detail a")!;
  link.focus();
  const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
  document.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(link);
});

it("closes the desktop popover when focus moves out of it", async () => {
  await mount({ items: [badge("a")], featured: ["a"] });
  el.querySelector<HTMLButtonElement>(".worn__row button")!.click(); await settle();
  const layer = document.querySelector<HTMLElement>(".worn-detail")!;
  const outside = document.createElement("button"); document.body.append(outside);
  layer.dispatchEvent(new FocusEvent("focusout", { relatedTarget: outside, bubbles: true }));
  await settle();
  expect(document.querySelector(".worn-detail")).toBeNull();
});

it("stays open when a click inside the popover blurs its link to nowhere", async () => {
  await mount({ items: [badge("a")], featured: ["a"] });
  el.querySelector<HTMLButtonElement>(".worn__row button")!.click(); await settle();
  const layer = document.querySelector<HTMLElement>(".worn-detail")!;
  layer.dispatchEvent(new FocusEvent("focusout", { relatedTarget: null, bubbles: true }));
  await settle();
  expect(document.querySelector(".worn-detail")).not.toBeNull();
});
