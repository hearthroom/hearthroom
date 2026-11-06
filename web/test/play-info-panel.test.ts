/**
 * 對話頁的卡片資訊面板（任務 2026-11-06-play-info-panel，規格 2026-11-04-play-info-panel-design/ui.md）：
 * 三個分頁（資訊預設、評論、榜單），疊在畫布上；第一次打開才掛，關掉只藏起來，草稿與分頁都留著；
 * 作者關評論就沒有評論分頁；面板裡只有兩個連結，都開新分頁；榜單只列拿到的榮譽，沒有就不畫那一塊。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n, applyLocale } from "../src/lib/i18n";
import { playSocial, registerPlayCard } from "../src/lib/play-social";
import type { CommunityCard } from "../src/lib/types";

vi.mock("../src/lib/oauth", () => ({ restorePersisted: () => null, refresh: async () => null, persist: () => {}, revokeSession: async () => {}, beginLogin: async () => {} }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "play", setSurface: () => {} }));
const api = vi.hoisted(() => ({
  fetchCard: vi.fn(), fetchCardScore: vi.fn(), fetchCardHonors: vi.fn(), fetchRoleDetail: vi.fn(),
}));
vi.mock("../src/lib/api", async (orig) => ({ ...(await orig<typeof import("../src/lib/api")>()), ...api }));
vi.mock("../src/components/CommentPanel.vue", () => ({
  default: defineComponent({
    emits: ["count"],
    setup(_, { emit }) {
      const draft = ref("");
      emit("count", 7);
      return () => h("textarea", { class: "cmt-stub", value: draft.value, onInput: (e: Event) => { draft.value = (e.target as HTMLTextAreaElement).value; } });
    },
  }),
}));
vi.mock("../src/components/CardSpendLeaderboard.vue", () => ({
  default: defineComponent({ props: ["cardId", "layout"], setup: (p) => () => h("section", { class: "spend-stub", "data-layout": p.layout }) }),
}));

import PlayInfoPanel from "../src/components/PlayInfoPanel.vue";

const CARD: CommunityCard = {
  id: "c1", roleId: "role", num: 100021, zone: "zh", name: "夜行偵探", summary: "民國背景推理",
  names: { zh: "夜行偵探", en: "", ja: "", ko: "" }, summaries: { zh: "民國背景推理", en: "", ja: "", ko: "" },
  avatarUrl: null, backgroundUrl: null, slug: null, tags: ["推理", "民國"], fandom: "",
  author: { handle: "abcdefgh", accountNumId: 7, name: "月光", avatar: "" },
  talkNum: 1200, followNum: 0, favoriteCount: 30, trending: 0, heat: 50, registeredAt: 1, syncedAt: 1, provider: "lunatalk", rating: "G", honors: [],
} as unknown as CommunityCard;

let app: App | null = null;
let wide = false;
async function mount(card: Partial<CommunityCard> = {}, detail: { comments: boolean; readme: string } | null = { comments: true, readme: "" }) {
  registerPlayCard({ roleId: "role", cardId: "c1", provider: "lunatalk", card: { ...CARD, ...card } as CommunityCard });
  playSocial.detail = detail;
  const host = document.body.appendChild(document.createElement("div"));
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/play/100021");
  app = createApp(PlayInfoPanel).use(createPinia()).use(router).use(i18n);
  app.mount(host);
  await nextTick();
}
async function flush() { for (let i = 0; i < 6; i++) { await nextTick(); await Promise.resolve(); } }
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const tabs = () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
const shown = (el: Element | null) => !!el && (el as HTMLElement).style.display !== "none" && !(el as HTMLElement).closest('[style*="display: none"]');

beforeEach(async () => {
  // 頭像與名字樣式會去問公開外觀；這裡不測它
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  // 預設手機寬度（底部面板）；桌機案例自己改 wide
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide && query.includes("min-width: 760px"), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  wide = false;
  await applyLocale("zh-Hant");
  api.fetchCard.mockResolvedValue(CARD);
  api.fetchCardScore.mockResolvedValue({ average: 4.5, count: 12, histogram: [0, 0, 1, 3, 8], mine: null });
  api.fetchCardHonors.mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllGlobals(); app?.unmount(); app = null; registerPlayCard(null); document.body.innerHTML = ""; vi.clearAllMocks(); });

describe("PlayInfoPanel", () => {
  it("mounts nothing and asks for nothing until the player first opens it", async () => {
    await mount();
    expect(dialog()).toBeNull();
    expect(api.fetchCardScore).not.toHaveBeenCalled();
    playSocial.open = true;
    await flush();
    expect(dialog()?.getAttribute("aria-label")).toBe("卡片資訊");
    expect(tabs().map(t => t.textContent?.replace(/\d+$/, "").trim())).toEqual(["資訊", "評論", "榜單"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    // Focus lands on the panel itself, so a touch open draws no focus ring on a tab.
    expect(document.activeElement).toBe(dialog());
    expect(api.fetchCardScore).toHaveBeenCalledTimes(1);
    // The card read when the play page opened paints the header at once.
    expect(document.querySelector(".pip-info__name")?.textContent).toContain("夜行偵探");
  });

  it("has no comments tab when the author turned comments off", async () => {
    await mount({}, { comments: false, readme: "" });
    playSocial.open = true;
    await flush();
    expect(tabs().map(t => t.textContent?.trim())).toEqual(["資訊", "榜單"]);
    expect(document.querySelector(".cmt-stub")).toBeNull();
  });

  it("keeps the comment draft and the last tab across close and reopen, and across tab switches", async () => {
    await mount();
    playSocial.open = true;
    await flush();
    tabs()[1].click();
    await flush();
    const input = document.querySelector<HTMLTextAreaElement>(".cmt-stub")!;
    input.value = "寫到一半";
    input.dispatchEvent(new Event("input"));
    expect(tabs()[1].textContent).toContain("7");
    tabs()[2].click();
    await flush();
    tabs()[1].click();
    await flush();
    playSocial.open = false;
    await flush();
    await new Promise((done) => setTimeout(done, 30));
    expect(shown(dialog())).toBe(false);
    playSocial.open = true;
    await flush();
    expect(playSocial.tab).toBe("comments");
    expect(document.querySelector<HTMLTextAreaElement>(".cmt-stub")).toBe(input);
    expect(input.value).toBe("寫到一半");
    // Reopening refreshes the card quietly.
    expect(api.fetchCard).toHaveBeenCalledTimes(1);
  });

  it("switches tabs with the arrow keys", async () => {
    await mount();
    playSocial.open = true;
    await flush();
    tabs()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flush();
    expect(playSocial.tab).toBe("comments");
    tabs()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    tabs()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await flush();
    expect(playSocial.tab).toBe("rankings");
  });

  it("offers only two links, both in a new tab, so the play page is never replaced", async () => {
    await mount({ tags: ["推理"], fandom: "福爾摩斯" });
    playSocial.open = true;
    await flush();
    const links = [...dialog()!.querySelectorAll<HTMLAnchorElement>("a[href]")];
    expect(links).toHaveLength(2);
    for (const a of links) { expect(a.target).toBe("_blank"); expect(a.rel).toContain("noopener"); }
    expect(links.map(a => new URL(a.href).pathname)).toEqual(["/me", "/cards/100021"]);
    // Tags and the fandom are plain chips here, not search links.
    expect(dialog()!.querySelector(".pip-info__chips a")).toBeNull();
    expect(dialog()!.querySelector(".pip-info__chips")?.textContent).toContain("#推理");
  });

  it("shows one line when the card has no honors and no kindred-spirit board", async () => {
    await mount();
    playSocial.tab = "rankings";
    playSocial.open = true;
    await flush();
    expect(api.fetchCardHonors).not.toHaveBeenCalled();
    expect(document.querySelector(".pip-rank__honors")).toBeNull();
    expect(document.querySelector(".pip-rank__empty")?.textContent).toBe("這張卡還沒有榜單紀錄");
  });

  it("lists only the honors earned, with ×N, and the kindred-spirit board for Harbor cards", async () => {
    api.fetchCardHonors.mockResolvedValue([
      { zone: "clean", window: "day", band: 1, period: "2026-11-03", at: 1 },
      { zone: "clean", window: "day", band: 1, period: "2026-11-04", at: 2 },
      { zone: "all", window: "week", band: 3, period: "2026-11-02", at: 3 },
    ]);
    await mount({ provider: "harbor", honors: [{ zone: "clean", window: "day", band: 1 }, { zone: "all", window: "week", band: 3 }] });
    playSocial.tab = "rankings";
    playSocial.open = true;
    await flush();
    const labels = [...document.querySelectorAll(".pip-rank__honors .badge-label")];
    expect(labels.map(l => `${l.querySelector(".badge-label__text")?.textContent}${l.querySelector(".badge-label__times")?.textContent ?? ""}`)).toEqual(["清水日榜第一×2", "綜合週榜前三"]);
    expect(document.querySelector(".pip-rank__all")?.textContent).toBe("查看全部 3 項");
    expect(document.querySelector(".spend-stub")?.getAttribute("data-layout")).toBe("summary");
    expect(document.querySelector(".pip-rank__empty")).toBeNull();
  });

  it("closes on Escape unless a dialog opened from the panel is on top", async () => {
    await mount();
    playSocial.open = true;
    await flush();
    const nested = document.body.appendChild(document.createElement("div"));
    nested.className = "modal-backdrop";
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(playSocial.open).toBe(true);
    nested.remove();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(playSocial.open).toBe(false);
  });

  it("keeps swipes and the wheel from reaching the chat below unless the pane under the finger can still scroll", async () => {
    await mount();
    playSocial.open = true;
    await flush();
    const pane = document.querySelector<HTMLElement>("#pip-pane-info")!;
    pane.style.overflowY = "auto";
    const geometry = (box: { scrollHeight: number; clientHeight: number; scrollTop?: number }) => {
      Object.defineProperty(pane, "scrollHeight", { configurable: true, value: box.scrollHeight });
      Object.defineProperty(pane, "clientHeight", { configurable: true, value: box.clientHeight });
      Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: box.scrollTop ?? 0 });
    };
    const swipe = (target: Element, fromY: number, toY: number) => {
      const at = (y: number) => [{ clientX: 100, clientY: y }];
      const start = new Event("touchstart", { bubbles: true, cancelable: true });
      Object.defineProperty(start, "touches", { value: at(fromY) });
      target.dispatchEvent(start);
      const move = new Event("touchmove", { bubbles: true, cancelable: true });
      Object.defineProperty(move, "touches", { value: at(toY) });
      target.dispatchEvent(move);
      return move.defaultPrevented;
    };
    const inside = pane.querySelector(".pip-info__summary")!;
    geometry({ scrollHeight: 200, clientHeight: 400 });
    expect(swipe(inside, 300, 200)).toBe(true);
    geometry({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });
    expect(swipe(inside, 300, 200)).toBe(false);
    expect(swipe(inside, 200, 300)).toBe(true);
    geometry({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    expect(swipe(inside, 300, 200)).toBe(true);
    expect(swipe(inside, 200, 300)).toBe(false);
    geometry({ scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
    expect(swipe(document.querySelector(".pip__tabs")!, 300, 200)).toBe(true);
    expect(swipe(document.querySelector(".pip")!, 300, 200)).toBe(true);
    geometry({ scrollHeight: 200, clientHeight: 400 });
    const wheel = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true });
    inside.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it("closes when the handle is dragged down past 80px, and snaps back when not", async () => {
    await mount();
    playSocial.open = true;
    await flush();
    const handle = document.querySelector<HTMLElement>(".pip__handle")!;
    const pointer = (type: string, y: number) => { const e = new MouseEvent(type, { bubbles: true, clientY: y }); Object.defineProperty(e, "pointerId", { value: 1 }); handle.dispatchEvent(e); };
    pointer("pointerdown", 100); pointer("pointermove", 150); pointer("pointerup", 150);
    expect(playSocial.open).toBe(true);
    pointer("pointerdown", 100); pointer("pointermove", 200); pointer("pointerup", 200);
    expect(playSocial.open).toBe(false);
  });

  it("on a wide window floats beside the chat without a mask, below the stage header", async () => {
    wide = true;
    const header = document.body.appendChild(document.createElement("div"));
    header.setAttribute("data-lt", "header");
    header.getBoundingClientRect = () => ({ bottom: 64 } as DOMRect);
    await mount();
    playSocial.open = true;
    await flush();
    const overlay = document.querySelector<HTMLElement>(".pip")!;
    expect(overlay.classList.contains("pip--side")).toBe(true);
    expect(dialog()?.getAttribute("aria-modal")).toBe("false");
    expect(overlay.style.getPropertyValue("--pip-top")).toBe("64px");
    expect(document.querySelector(".pip__handle")).toBeNull();
    // Clicking beside the panel reaches the chat; it does not close the panel.
    overlay.click();
    expect(playSocial.open).toBe(true);
  });

  it("is not held open by the stage's closed popups, which keep aria-modal on hidden content", async () => {
    // canvas-popup.vue: the closed popup root is hidden + inert, its content still says aria-modal="true".
    const popup = document.body.appendChild(document.createElement("div"));
    popup.hidden = true;
    popup.setAttribute("inert", "");
    popup.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    await mount();
    playSocial.open = true;
    await flush();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(playSocial.open).toBe(false);
  });

  it("on a wide window leaves Esc to the chat when focus is outside the panel, and ignores IME composition", async () => {
    wide = true;
    await mount();
    playSocial.open = true;
    await flush();
    const composer = document.body.appendChild(document.createElement("textarea"));
    composer.focus();
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(playSocial.open).toBe(true);
    const tab = tabs()[0];
    tab.focus();
    tab.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }));
    expect(playSocial.open).toBe(true);
    tab.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(playSocial.open).toBe(false);
    // Clicking plain text inside the panel drops focus to body; Esc still closes it.
    playSocial.open = true;
    await flush();
    (document.activeElement as HTMLElement | null)?.blur();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(playSocial.open).toBe(false);
  });

  it("keeps the header and shows an error with reload when the card details could not be read", async () => {
    await mount({}, null);
    playSocial.detailStatus = "failed";
    playSocial.open = true;
    await flush();
    expect(document.querySelector(".pip-info__name")?.textContent).toContain("夜行偵探");
    const notice = document.querySelector<HTMLElement>(".pip-info__error")!;
    expect(notice.textContent).toContain("卡片資訊暫時無法載入");
    api.fetchRoleDetail.mockResolvedValueOnce({ roleReadme: "# 介紹" });
    notice.querySelector("button")!.click();
    await flush();
    expect(api.fetchRoleDetail).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".pip-info__error")).toBeNull();
    expect(document.querySelector(".pip-info__intro-wrap")).not.toBeNull();
  });

  it("draws a placeholder for the introduction while the card details are still loading", async () => {
    await mount({}, null);
    playSocial.detailStatus = "loading";
    playSocial.open = true;
    await flush();
    expect(document.querySelector(".pip-info__intro-ghost")).not.toBeNull();
  });
});
