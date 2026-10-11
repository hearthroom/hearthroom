/**
 * 類型列分組與張數（2026-10-11）：52 顆籤平鋪佔掉半屏，而且點下去常常是空的。
 *   - 分成玩法、題材、角色、偏好四組，各組前面有組名；預設只攤開前兩組，其餘收進「更多類型」。
 *   - 選中的類型在收起來的組裡：自動展開（看得到自己開了什麼篩選、關得掉）。
 *   - 每顆籤後面標張數（再加上這一類會剩幾張）；0 張的變灰、點不下去，已選中的照樣點得掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import BoardPage from "../src/pages/BoardPage.vue";
import * as api from "../src/lib/api";

const counts: Record<string, number> = { roleplay: 12, story: 0, wuxia: 3, hypnosis: 2 };
vi.mock("../src/lib/api", async (original) => ({ ...await original<typeof api>(),
  fetchBoard: vi.fn(async () => ({ items: [], total: 0, hasNext: false, limit: 24, offset: 0, sort: "hot" })),
  fetchTagCounts: vi.fn(async () => counts),
}));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board", setSurface: () => {} }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));

let app: App | undefined; let root: HTMLElement; let router: Router;
const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };
async function mount(path: string) {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: BoardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  await router.push(path); await router.isReady();
  root = document.createElement("div"); document.body.appendChild(root);
  setActivePinia(createPinia());
  app = createApp({ template: "<router-view />" }).use(createPinia()).use(i18n).use(router);
  app.mount(root); await settle();
}
const chip = (label: string) => [...root.querySelectorAll<HTMLButtonElement>(".tagchip")].find((b) => b.querySelector(".tagchip__label")?.textContent?.trim() === label);
const visible = (el: HTMLElement | null | undefined) => !!el && !el.closest("[data-group]")?.hasAttribute("hidden") && (el.closest("[data-group]") as HTMLElement | null)?.style.display !== "none";
const groupLabel = (g: string) => root.querySelector(`[data-group="${g}"] .discovery-tags__group`)?.textContent?.trim();
const more = () => root.querySelector<HTMLButtonElement>(".discovery-tags__more");

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
});
afterEach(() => { app?.unmount(); root?.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("類型列分組", () => {
  it("四組各有組名；預設只攤開玩法、題材，點「更多類型」才看到角色與偏好", async () => {
    await mount("/");
    expect(groupLabel("play")).toBe(i18n.global.t("board.tagGroup.play"));
    expect(groupLabel("setting")).toBe(i18n.global.t("board.tagGroup.setting"));
    expect(visible(chip("角色扮演"))).toBe(true);
    expect(visible(chip("武俠"))).toBe(true);
    expect(visible(chip("御姐"))).toBe(false);
    expect(visible(chip("催眠"))).toBe(false);
    expect(more()?.getAttribute("aria-expanded")).toBe("false");
    more()!.click(); await nextTick();
    expect(visible(chip("御姐"))).toBe(true);
    expect(visible(chip("催眠"))).toBe(true);
    expect(more()?.getAttribute("aria-expanded")).toBe("true");
  });

  it("選中的類型在收起來的組裡：自動展開", async () => {
    await mount("/?tag=hypnosis");
    expect(visible(chip("催眠"))).toBe(true);
    expect(chip("催眠")?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("類型張數", () => {
  it("每顆籤標張數；0 張的變灰、點不下去", async () => {
    await mount("/");
    expect(chip("角色扮演")?.querySelector(".tagchip__n")?.textContent?.trim()).toBe("12");
    expect(chip("劇情")?.disabled).toBe(true);
    expect(chip("劇情")?.classList.contains("is-empty")).toBe(true);
    expect(chip("角色扮演")?.disabled).toBe(false);
    expect(vi.mocked(api.fetchTagCounts)).toHaveBeenCalledWith(expect.objectContaining({ zone: "zh", tag: [] }));
  });

  it("已選中的類型就算是 0 也點得掉", async () => {
    await mount("/?tag=story");
    expect(chip("劇情")?.disabled).toBe(false);
    chip("劇情")!.click(); await settle();
    expect(router.currentRoute.value.query.tag).toBeUndefined();
  });
});
