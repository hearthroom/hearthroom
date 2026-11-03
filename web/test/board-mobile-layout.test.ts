/**
 * 首頁手機版面（owner 2026-10-02，來自成員意見）：
 *   - 「角色卡／關注動態」那顆分段控制拿掉，「關注」併到排序列：它是看另一個榜，不是換排法，
 *     選中時其他分頁全部不亮、類型列與張數不畫（順序見 BoardPage 的 TABS，2026-11-03 起「關注」在第六位）；
 *   - R18 開關搬到頁首（App.vue），榜單頁自己不再畫；
 *   - 類型列在窄螢幕收成一顆「類型」鈕，跟分級選單同一列；點開浮層列出全部分類（站方 2026-11-02，owner 2026-11-03）。
 *     選中的類型攤在鈕旁邊、點一下就拿掉（看得到自己開了什麼篩選、關得掉）；浮層 Esc 或點外面收，焦點回鈕。
 *     寬螢幕照舊全部攤開，沒有這顆鈕。
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
const sortButtons = () => [...root.querySelectorAll<HTMLButtonElement>(".sorts__item")];
const modeButton = () => sortButtons().find((b) => b.textContent?.trim() === i18n.global.t("board.mode.following"));
const tagsNav = () => root.querySelector<HTMLElement>(".discovery-tags");

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: narrow && /max-width/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
  narrow = true;
});
afterEach(() => { app?.unmount(); root?.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("首頁：關注併進排序列", () => {
  const TABS = ["day", "week", "month", "hot", "new", "following", "updated", "random"];
  const label = (s: string) => i18n.global.t(s === "following" ? "board.mode.following" : `board.sort.${s}`);
  it("八個分頁照站方要的順序排（2026-11-03），「關注」在第六位、跟其他分頁同一個樣式；榜單頁自己不畫 R18 開關", async () => {
    await mount("/");
    expect(sortButtons().map((b) => b.textContent?.trim())).toEqual(TABS.map(label));
    expect(root.querySelector(".sorts__mode")).toBeNull();
    expect(modeButton()?.getAttribute("aria-pressed")).toBe("false");
    // 預設日榜、排最左
    expect(sortButtons()[0].classList.contains("sorts__item--on"), "日榜亮著").toBe(true);
    expect(root.querySelector(".r18")).toBeNull();
    expect(root.querySelector(".seg")).toBeNull();
  });

  it.each(["favorites", "score"])("拿掉的分頁（?sort=%s）舊網址退回日榜", async (old) => {
    await mount(`/?sort=${old}`);
    expect(sortButtons().filter((b) => b.classList.contains("sorts__item--on")).map((b) => b.textContent?.trim())).toEqual([label("day")]);
    expect(vi.mocked(api.fetchBoard)).toHaveBeenCalled();
    expect(vi.mocked(api.fetchBoard)).not.toHaveBeenCalledWith(expect.objectContaining({ sort: old }));
  });

  it("點「關注」進關注動態：網址只剩 mode=following，其他分頁全部不亮，類型列與張數不畫", async () => {
    await mount("/?sort=hot&tag=roleplay&rating=PG15");
    modeButton()!.click(); await settle();
    expect(router.currentRoute.value.query).toEqual({ mode: "following" });
    expect(modeButton()?.getAttribute("aria-pressed")).toBe("true");
    expect(sortButtons().filter((b) => b !== modeButton()).every((b) => !b.classList.contains("sorts__item--on") && b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(tagsNav()).toBeNull();
    expect(root.querySelector(".feed")).not.toBeNull();
    // 點任一個排序就回到角色卡榜
    sortButtons()[1].click(); await settle();
    expect(router.currentRoute.value.query).toEqual({ sort: "week" });
    sortButtons()[6].click(); await settle();
    expect(router.currentRoute.value.query).toEqual({ sort: "updated" });
    expect(tagsNav()).not.toBeNull();
  });
});

describe("首頁窄螢幕：類型收成一顆鈕＋浮層", () => {
  const opener = () => root.querySelector<HTMLButtonElement>(".discovery-tags__button");
  const panel = () => root.querySelector<HTMLElement>(".discovery-tags__panel");
  const picked = () => [...root.querySelectorAll<HTMLButtonElement>(".discovery-tags__picked")];

  it("不畫四組，只有一顆類型鈕，放在分級那一列；點開才列出四組，浮層開著時首頁暫停載卡", async () => {
    await mount("/");
    expect(root.querySelectorAll("[data-group]")).toHaveLength(0);
    expect(opener()?.textContent?.trim()).toBe(i18n.global.t("board.tags"));
    expect(opener()?.closest(".count-row")?.querySelector(".rating-filter select")).not.toBeNull();
    expect(opener()?.getAttribute("aria-expanded")).toBe("false");
    // 新手引導框的是 nav.discovery-tags：窄螢幕也要在
    expect(tagsNav()?.contains(opener()!)).toBe(true);
    opener()!.click(); await settle();
    expect(opener()?.getAttribute("aria-expanded")).toBe("true");
    expect(panel()?.hasAttribute("data-discovery-overlay")).toBe(true);
    expect([...panel()!.querySelectorAll("[data-group]")].map((x) => x.getAttribute("data-group"))).toEqual(["play", "setting", "character", "kink"]);
    expect(panel()!.querySelectorAll(".tagchip[aria-pressed]").length).toBe(TAG_CATALOG.length);
  });

  it("在浮層裡選類型：浮層不收、可以連選；選中的籤攤在鈕旁邊，點一下就拿掉", async () => {
    await mount("/");
    opener()!.click(); await settle();
    button("催眠")!.click(); await settle();
    expect(router.currentRoute.value.query.tag).toEqual(["hypnosis"]);
    expect(panel()).not.toBeNull();
    button("武俠")!.click(); await settle();
    expect(router.currentRoute.value.query.tag).toEqual(["hypnosis", "wuxia"]);
    expect(opener()?.classList.contains("is-on")).toBe(true);
    expect(picked().map((b) => b.querySelector(".tagchip__label")?.textContent)).toEqual(["催眠", "武俠"]);
    expect(picked()[0]?.getAttribute("aria-label")).toBe(i18n.global.t("board.tags.remove", { name: "催眠" }));
    picked()[0]!.click(); await settle();
    expect(router.currentRoute.value.query.tag).toEqual(["wuxia"]);
  });

  it("網址帶著類型進來：浮層沒開也看得到選了什麼", async () => {
    await mount("/?tag=hypnosis&tag=roleplay");
    expect(panel()).toBeNull();
    expect(picked().map((b) => b.querySelector(".tagchip__label")?.textContent)).toEqual(["催眠", "角色扮演"]);
  });

  it("Esc 收浮層、焦點回鈕；點浮層外面也收", async () => {
    await mount("/");
    opener()!.click(); await settle();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await settle();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(opener());
    opener()!.click(); await settle();
    expect(panel()).not.toBeNull();
    sortButtons()[0]!.click(); await settle();
    expect(panel()).toBeNull();
  });

  it("清除類型與已隱藏的入口在浮層裡", async () => {
    await mount("/?tag=hypnosis", ["loli", "ntr"]);
    opener()!.click(); await settle();
    expect(panel()!.querySelectorAll('a[href$="#hidden"]')).toHaveLength(1);
    expect(button("蘿莉")).toBeUndefined();
    panel()!.querySelector<HTMLButtonElement>(".discovery-tags__clear")!.click(); await settle();
    expect(router.currentRoute.value.query.tag).toBeUndefined();
    expect(picked()).toHaveLength(0);
  });

  it("寬螢幕沒有這顆鈕，四組直接攤開", async () => {
    narrow = false;
    await mount("/");
    expect(opener()).toBeNull();
    expect(root.querySelectorAll("[data-group]")).toHaveLength(4);
  });
});
