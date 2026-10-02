/**
 * 首頁手機版面（owner 2026-10-02，來自成員意見）：
 *   - 「角色卡／關注動態」那顆分段控制拿掉，「關注」併到排序列最右邊：它是看另一個榜，不是換排法，
 *     選中時六個排序全部不亮、類型列與張數不畫；
 *   - R18 開關搬到頁首（App.vue），榜單頁自己不再畫；
 *   - 類型列在窄螢幕不再橫滑，改收合：預設兩行，右上「全部 N 類」展開、「收合」收回；
 *     有選中的類型時自動展開（看得到自己開了什麼篩選、關得掉）；「已隱藏 N 類」放標題列，收合時也看得到。
 *     寬螢幕照舊全部攤開，沒有展開鈕。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { TAG_CATALOG } from "../../shared/tag-catalog";
import BoardPage from "../src/pages/BoardPage.vue";
import * as api from "../src/lib/api";
import { useSession } from "../src/lib/session";

vi.mock("../src/lib/api", async (original) => ({ ...await original<typeof api>(),
  fetchBoard: vi.fn(async () => ({ items: [], total: 0, hasNext: false, limit: 24, offset: 0, sort: "day" })),
}));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board", setSurface: () => {} }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));

let app: App | undefined;
let root: HTMLElement;
let router: Router;
/** 窄螢幕與否：元件問的是 matchMedia，這裡直接答 */
let narrow = true;
const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };

async function mount(path: string, hiddenTags: string[] = []) {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: BoardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  await router.push(path); await router.isReady();
  root = document.createElement("div"); document.body.appendChild(root);
  const pinia = createPinia(); setActivePinia(pinia);
  if (hiddenTags.length) useSession().profile = { handle: "abcdefgh", memberSince: 0, reviewer: false, identities: [], showNsfw: false, ageVerified: false, adultConsent: false, hiddenTags } as never;
  app = createApp({ template: "<router-view />" }).use(pinia).use(i18n).use(router);
  app.mount(root); await settle();
}
const buttons = () => [...root.querySelectorAll<HTMLButtonElement>("button")];
const button = (label: string) => buttons().find((x) => x.textContent?.trim() === label);
const sortButtons = () => [...root.querySelectorAll<HTMLButtonElement>(".sorts__item:not(.sorts__mode)")];
const modeButton = () => root.querySelector<HTMLButtonElement>(".sorts__mode");
const tagsNav = () => root.querySelector<HTMLElement>(".discovery-tags");
const expander = () => root.querySelector<HTMLButtonElement>(".discovery-tags__toggle");

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: narrow && /max-width/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
  narrow = true;
});
afterEach(() => { app?.unmount(); root?.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("首頁：關注併進排序列", () => {
  it("排序列最右邊一顆「關注」；榜單頁自己不畫 R18 開關，也沒有分段控制", async () => {
    await mount("/");
    expect(modeButton()?.textContent?.trim()).toBe(i18n.global.t("board.mode.following"));
    expect(modeButton()?.getAttribute("aria-pressed")).toBe("false");
    expect(sortButtons()).toHaveLength(6);
    expect(sortButtons()[0].classList.contains("sorts__item--on"), "日榜亮著").toBe(true);
    expect(root.querySelector(".r18")).toBeNull();
    expect(root.querySelector(".seg")).toBeNull();
  });

  it("點「關注」進關注動態：網址帶 mode=following，六個排序全部不亮，類型列與張數不畫", async () => {
    await mount("/?sort=hot&tag=roleplay");
    modeButton()!.click(); await settle();
    expect(router.currentRoute.value.query).toEqual({ mode: "following" });
    expect(modeButton()?.getAttribute("aria-pressed")).toBe("true");
    expect(sortButtons().every((b) => !b.classList.contains("sorts__item--on") && b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(tagsNav()).toBeNull();
    expect(root.querySelector(".feed")).not.toBeNull();
    // 點任一個排序就回到角色卡榜
    sortButtons()[1].click(); await settle();
    expect(router.currentRoute.value.query).toEqual({ sort: "week" });
    expect(tagsNav()).not.toBeNull();
  });
});

describe("首頁：類型列在窄螢幕收合", () => {
  it("預設收合，鈕上寫全部幾類；點開展開、再點收回", async () => {
    await mount("/");
    expect(tagsNav()?.classList.contains("discovery-tags--collapsed")).toBe(true);
    expect(expander()?.textContent?.trim()).toBe(i18n.global.t("board.tags.expand", { n: TAG_CATALOG.length }));
    expect(expander()?.getAttribute("aria-expanded")).toBe("false");
    // 收合時每一顆籤仍在文件裡（鍵盤與讀屏照常可達），只是容器限高
    expect(button("催眠")).toBeTruthy();
    expander()!.click(); await nextTick();
    expect(tagsNav()?.classList.contains("discovery-tags--collapsed")).toBe(false);
    expect(expander()?.textContent?.trim()).toBe(i18n.global.t("board.tags.collapse"));
    expect(expander()?.getAttribute("aria-expanded")).toBe("true");
    expander()!.click(); await nextTick();
    expect(tagsNav()?.classList.contains("discovery-tags--collapsed")).toBe(true);
  });

  it("有選中的類型就自動展開；清掉選擇才收回去", async () => {
    await mount("/?tag=hypnosis");
    expect(tagsNav()?.classList.contains("discovery-tags--collapsed")).toBe(false);
    expect(button("催眠")?.getAttribute("aria-pressed")).toBe("true");
    expect(expander(), "清單被選擇撐開時沒有收合鈕可按").toBeNull();
    button("全部")!.click(); await settle();
    expect(expander()).not.toBeNull();
    expect(router.currentRoute.value.query.tag).toBeUndefined();
    expect(tagsNav()?.classList.contains("discovery-tags--collapsed")).toBe(true);
  });

  it("「已隱藏 N 類」在標題列，收合時也看得到；寬螢幕沒有展開鈕、隱藏連結照舊排在籤尾", async () => {
    await mount("/", ["loli", "ntr"]);
    const head = root.querySelector(".discovery-tags__head");
    expect(head?.querySelector("a")?.textContent?.trim()).toBe(i18n.global.t("board.hidden", { n: 2 }));
    expect(root.querySelectorAll('a[href$="#hidden"]'), "同一條連結只出現一次，不在籤尾重複").toHaveLength(1);
    expect(button("蘿莉"), "隱藏的類型不畫").toBeUndefined();
    app!.unmount(); root.remove();

    narrow = false;
    await mount("/", ["loli", "ntr"]);
    expect(expander()).toBeNull();
    expect(root.querySelector(".discovery-tags__head")).toBeNull();
    expect(tagsNav()?.classList.contains("discovery-tags--collapsed")).toBe(false);
    const inner = root.querySelector(".discovery-tags__inner")!;
    expect(inner.lastElementChild?.classList.contains("tagchip--hidden")).toBe(true);
  });
});
