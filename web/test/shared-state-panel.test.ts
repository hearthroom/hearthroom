/**
 * 編輯頁「玩家投票與計數」（components/SharedStatePanel.vue，規格 editor-toggle-ui.md）：四種狀態、
 * 立即寫入的開關、要確認的歸零與清空、讀不到不藏、結果不明不重送。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { i18n } from "../src/lib/i18n";
const api = vi.hoisted(() => ({ fetch: vi.fn(), set: vi.fn(), reset: vi.fn(), clear: vi.fn() }));
const confirm = vi.hoisted(() => ({ answer: true, calls: [] as unknown[] }));
vi.mock("../src/lib/api", async (original) => ({
  ...(await original<typeof import("../src/lib/api")>()),
  fetchSharedStateSettings: api.fetch, setSharedStateEnabled: api.set, resetSharedStateKey: api.reset, clearSharedStateDraft: api.clear,
}));
vi.mock("../src/lib/confirm", () => ({ confirmDialog: async (o: unknown) => { confirm.calls.push(o); return confirm.answer; } }));
import { ApiError } from "../src/lib/api";
import SharedStatePanel from "../src/components/SharedStatePanel.vue";

const settings = (over: Record<string, unknown> = {}) => ({
  platformEnabled: true, authorOff: false, platformOff: false,
  declaration: { polls: { "p1-4": { options: ["a", "b"] } }, counters: { boss: { goal: 100, maxStep: 5, perMember: 50 } } },
  live: { "p1-4": { kind: "poll", counts: { a: 3, b: 1 }, total: 4 }, boss: { kind: "counter", total: 42, goal: 100, reachedAt: null } },
  draft: { "p1-4": { kind: "poll", counts: { a: 0, b: 0 }, total: 0 }, boss: { kind: "counter", total: 0, goal: 100, reachedAt: null } },
  ...over,
});
let app: ReturnType<typeof createApp>, root: HTMLElement;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await nextTick(); };
async function mount() {
  root = document.createElement("div");
  document.body.append(root);
  app = createApp(SharedStatePanel, { roleId: "src-1", provider: "harbor", cardName: "夜宴", token: async () => "tok" }).use(i18n);
  app.mount(root);
  await settle();
}
const panel = () => root.querySelector("[data-shared-state]");
const box = () => root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const buttons = () => [...root.querySelectorAll<HTMLButtonElement>("button")];
const resetButtons = () => buttons().filter((b) => b.classList.contains("shared__reset"));

beforeEach(() => {
  i18n.global.locale.value = "zh-Hant";
  confirm.answer = true; confirm.calls = [];
  api.fetch.mockReset().mockResolvedValue(settings());
  api.set.mockReset().mockResolvedValue({ authorOff: true });
  api.reset.mockReset().mockResolvedValue(undefined);
  api.clear.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { app?.unmount(); root?.remove(); });

describe("狀態", () => {
  it("平台沒開、或這張卡沒宣告：整塊不顯示", async () => {
    api.fetch.mockResolvedValue(settings({ platformEnabled: false }));
    await mount();
    expect(panel()).toBeNull();
    app.unmount(); root.remove();
    api.fetch.mockResolvedValue(settings({ declaration: { polls: {}, counters: {} } }));
    await mount();
    expect(panel()).toBeNull();
  });

  it("開放中：開關勾著，玩家數字與試玩數字分開列出", async () => {
    await mount();
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(false);
    const text = panel()!.textContent!;
    expect(text).toContain("開放中");
    expect(text).toContain("3 票");
    expect(text).toContain("42 / 100");
    expect(text).toContain("尚未達標");
    expect(resetButtons().map((b) => b.getAttribute("aria-label"))).toEqual(["將「p1-4」的玩家數字歸零", "將「boss」的玩家數字歸零", "將「p1-4」的試玩數字歸零", "將「boss」的試玩數字歸零"]);
  });

  it("平台暫停這張卡：數字照樣看得到，開關與歸零都停用", async () => {
    api.fetch.mockResolvedValue(settings({ platformOff: true }));
    await mount();
    expect(panel()!.textContent).toContain("平台已暫停");
    expect(box().checked).toBe(false);
    expect(box().disabled).toBe(true);
    expect(resetButtons().every((b) => b.disabled)).toBe(true);
  });

  it("讀不到（含宣告讀不到）不藏起來：就地顯示錯誤與重新載入", async () => {
    api.fetch.mockRejectedValue(new ApiError(503, "", "declaration_unavailable"));
    await mount();
    expect(panel()!.textContent).toContain("投票與計數暫時無法載入。");
    api.fetch.mockResolvedValue(settings());
    buttons().find((b) => b.textContent!.includes("重新載入"))!.click();
    await settle();
    expect(box().checked).toBe(true);
  });
});

describe("操作", () => {
  it("暫停不必確認：寫入後重新讀狀態，畫面照讀回的值", async () => {
    await mount();
    api.fetch.mockResolvedValue(settings({ authorOff: true }));
    box().click();
    await settle();
    expect(api.set).toHaveBeenCalledWith("src-1", false, "tok", "harbor");
    expect(confirm.calls).toHaveLength(0);
    expect(box().checked).toBe(false);
    expect(panel()!.textContent).toContain("已暫停");
  });

  it("歸零要確認：取消就不送；確認了 ns 一定明確給（玩家數字 live、試玩 draft）", async () => {
    await mount();
    confirm.answer = false;
    resetButtons()[0]!.click();
    await settle();
    expect(api.reset).not.toHaveBeenCalled();
    confirm.answer = true;
    resetButtons()[1]!.click();
    await settle();
    expect(api.reset).toHaveBeenLastCalledWith("src-1", "boss", "live", "tok", "harbor");
    expect(confirm.calls[1]).toMatchObject({ danger: true, dangerAppearance: "subdued", focusCancel: true, title: "要將「boss」的玩家數字歸零嗎？" });
    resetButtons()[2]!.click();
    await settle();
    expect(api.reset).toHaveBeenLastCalledWith("src-1", "p1-4", "draft", "tok", "harbor");
  });

  it("清空試玩數字要確認，只清試玩那一份", async () => {
    await mount();
    buttons().find((b) => b.classList.contains("shared__clear"))!.click();
    await settle();
    expect(api.clear).toHaveBeenCalledWith("src-1", "tok", "harbor");
    expect(confirm.calls[0]).toMatchObject({ danger: true, dangerAppearance: "subdued", focusCancel: true, title: "要清空全部試玩數字嗎？" });
  });

  it("送出後斷線＝結果不明：不重送、重新讀狀態，說明留著", async () => {
    await mount();
    api.reset.mockRejectedValue(new TypeError("Failed to fetch"));
    resetButtons()[1]!.click();
    await settle();
    expect(api.reset).toHaveBeenCalledTimes(1);
    expect(api.fetch).toHaveBeenCalledTimes(2);
    expect(panel()!.textContent).toContain("操作結果尚未確認。");
  });

  it("伺服器明確拒絕：保留原數字並說沒做成", async () => {
    await mount();
    api.reset.mockRejectedValue(new ApiError(429, "", "rate_limited"));
    resetButtons()[1]!.click();
    await settle();
    expect(panel()!.textContent).toContain("數字未能歸零。");
    expect(panel()!.textContent).toContain("42 / 100");
  });
});
