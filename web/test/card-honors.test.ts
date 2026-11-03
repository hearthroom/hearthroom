/**
 * 榜單榮譽（徽章第一期，2026-11-03）：封面左上一列是「目前名次（榜單頁）＋日週月徽章」，右上是限制級的 R 方塊。
 * 徽章只放期別字與名次，完整名稱給讀屏與 tooltip；沒有榮譽的卡完全不畫這一列。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n, applyLocale } from "../src/lib/i18n";

vi.mock("../src/lib/oauth", () => ({ restorePersisted: () => null, refresh: async () => null, persist: () => {}, revokeSession: async () => {}, beginLogin: async () => {} }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "card", setSurface: () => {} }));

import CardTile from "../src/components/CardTile.vue";

const BASE = {
  id: "abc", roleId: "role-abc", num: 100021, zone: "zh", name: "夜行偵探", summary: "民國背景推理",
  names: { zh: "夜行偵探", en: "", ja: "", ko: "" }, summaries: { zh: "民國背景推理", en: "", ja: "", ko: "" },
  avatarUrl: null, backgroundUrl: null, slug: null, tags: [],
  author: { handle: "abcdefgh", accountNumId: 7, name: "月光", avatar: "" },
  talkNum: 1, followNum: 0, trending: 0, registeredAt: 1, syncedAt: 1, provider: "harbor", rating: null,
};
let app: App | null = null, el: HTMLElement | null = null;
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; });
async function mount(card: Record<string, unknown>, rank?: number) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  el = document.createElement("div"); document.body.append(el);
  app = createApp(CardTile, { card: { ...BASE, ...card }, ...(rank ? { rank } : {}) }).use(createPinia()).use(router).use(i18n);
  app.mount(el); await nextTick();
  return el;
}

describe("cover honors", () => {
  it("draws one badge per period, day before week before month, and names each in full for screen readers", async () => {
    await applyLocale("zh-Hant");
    const root = await mount({ honors: [{ zone: "all", window: "month", band: 10 }, { zone: "clean", window: "day", band: 1 }, { zone: "all", window: "week", band: 3 }] });
    const badges = [...root.querySelectorAll(".card__marks .rank-badge")];
    expect(badges.map(b => b.getAttribute("aria-label"))).toEqual(["清水日榜第一", "綜合週榜前三", "綜合月榜前十"]);
    expect(badges.map(b => b.textContent?.replace(/\s/g, ""))).toEqual(["清水日榜第一日1", "綜合週榜前三週3", "綜合月榜前十月10"]);
    expect(badges.map(b => (b as SVGElement).dataset.zone)).toEqual(["clean", "all", "all"]);
  });

  it("puts the current board rank first in the same row", async () => {
    await applyLocale("en");
    const root = await mount({ honors: [{ zone: "clean", window: "week", band: 1 }] }, 12);
    const row = root.querySelector(".card__marks")!;
    expect(row.firstElementChild?.classList.contains("card__rank")).toBe(true);
    expect(row.querySelector(".rank-badge")?.getAttribute("aria-label")).toBe("SFW Weekly #1");
    expect(row.querySelector(".rank-badge text")?.textContent).toBe("W");
  });

  it("leaves no placeholder on a card without honors", async () => {
    const root = await mount({ honors: [] });
    expect(root.querySelector(".card__marks")).toBeNull();
  });

  it("shows adult cards as a named R square instead of the wide rating chip", async () => {
    await applyLocale("zh-Hant");
    const root = await mount({ rating: "R" });
    const flag = root.querySelector(".card__flag")!;
    expect(flag.textContent).toBe("R");
    expect(flag.getAttribute("role")).toBe("img");
    expect(flag.getAttribute("aria-label")).toBe("限制級");
    expect(root.querySelector(".rating-chip")).toBeNull();
  });
});

import CardHonors from "../src/components/CardHonors.vue";
describe("card page honors", () => {
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); await nextTick(); };
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });
  async function mountList(honors: unknown[], items: unknown[] | Error) {
    const fetchMock = vi.fn(async (url: string) => items instanceof Error ? new Response("{}", { status: 500 }) : new Response(JSON.stringify({ items }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    el = document.createElement("ul"); document.body.append(el);
    app = createApp(CardHonors, { cardId: "abc", honors }).use(createPinia()).use(i18n);
    app.mount(el); await flush();
    return { root: el, fetchMock };
  }

  it("leads the tag row with one chip: the highest honor, plus how many there are when more than one", async () => {
    await applyLocale("zh-Hant");
    const { root, fetchMock } = await mountList([{ zone: "clean", window: "day", band: 1 }, { zone: "all", window: "week", band: 10 }], [
      { zone: "all", window: "week", band: 10, period: "2026-11-02", at: Date.UTC(2026, 10, 16) },
      { zone: "clean", window: "day", band: 1, period: "2026-11-03", at: Date.UTC(2026, 10, 4) },
      { zone: "all", window: "day", band: 3, period: "2026-11-03", at: Date.UTC(2026, 10, 4) },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/cards\/abc\/honors/);
    // 卡片頁標籤列只放一顆，和 #標籤 同高（owner 2026-11-03：「這裡有大有小好奇怪」）
    const chips = root.querySelectorAll("button.card-honors__chip");
    expect(chips).toHaveLength(1);
    expect(chips[0].classList.contains("chip")).toBe(true);
    expect(chips[0].querySelector(".rank-badge")).not.toBeNull();
    expect(chips[0].querySelector(".card-honors__name")?.textContent).toBe("清水日榜第一");
    expect(chips[0].querySelector(".card-honors__count")?.textContent).toBe("+2");
    // 唸出來的名字就是看得到的字（Label in Name）；共幾項放在描述裡
    expect(chips[0].hasAttribute("aria-label")).toBe(false);
    const desc = document.getElementById(chips[0].getAttribute("aria-describedby")!);
    expect(desc?.textContent).toBe("查看這張卡的全部榮譽，共 3 項");
  });

  it("opens the full list as a dialog, closes on Escape and returns focus to the opener", async () => {
    await applyLocale("en");
    const { root } = await mountList([{ zone: "clean", window: "day", band: 1 }], [{ zone: "clean", window: "day", band: 1, period: "2026-11-03", at: Date.UTC(2026, 10, 4) }]);
    const opener = root.querySelector<HTMLButtonElement>("button.card-honors__chip")!;
    expect(opener.querySelector(".card-honors__name")?.textContent).toBe("SFW Daily #1");
    expect(opener.querySelector(".card-honors__count")).toBeNull();
    opener.focus(); opener.click(); await flush();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector(".modal__title")?.textContent).toBe("Card honors");
    expect(dialog.textContent).toContain("SFW Daily #1");
    expect(dialog.textContent).toContain("Nov 3");
    expect(document.activeElement?.classList.contains("card-honors__close")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("does not ask the server for honors when the card has none", async () => {
    const { root, fetchMock } = await mountList([], []);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(root.querySelector("li")).toBeNull();
  });

  it("asks for the full list once when the page swaps in a fresh copy of the same card", async () => {
    const { fetchMock } = await mountList([{ zone: "clean", window: "day", band: 1 }], [{ zone: "clean", window: "day", band: 1, period: "2026-11-03", at: 1 }]);
    const root = el!;
    app!.unmount(); root.remove();
    // 同一個元件換一份新的 honors 陣列（卡片頁先顯示快取、再換成剛讀到的那份）
    const { reactive, h } = await import("vue");
    const props = reactive({ cardId: "abc", honors: [{ zone: "clean", window: "day", band: 1 }] });
    el = document.createElement("ul"); document.body.append(el);
    app = createApp({ render: () => h(CardHonors, props) }).use(createPinia()).use(i18n); app.mount(el); await flush();
    const before = fetchMock.mock.calls.length;
    props.honors = [{ zone: "clean", window: "day", band: 1 }]; await flush();
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(el.querySelector(".card-honors__chip")).not.toBeNull();
  });

  it("still shows the chip from the cover honors when the full list fails, and retries when opened", async () => {
    await applyLocale("zh-Hant");
    const { root, fetchMock } = await mountList([{ zone: "all", window: "day", band: 3 }], new Error("down"));
    const chip = root.querySelector<HTMLButtonElement>("button.card-honors__chip")!;
    expect(chip.querySelector(".card-honors__name")?.textContent).toBe("綜合日榜前三");
    expect(chip.querySelector(".card-honors__count")).toBeNull();
    expect(chip.hasAttribute("aria-describedby")).toBe(false);
    const before = fetchMock.mock.calls.length;
    chip.click(); await flush();
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    expect(document.querySelector('[role="dialog"] [role="alert"]')).not.toBeNull();
  });
});

