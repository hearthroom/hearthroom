import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import type { CommunityCard } from "../src/lib/types";
import type { CardQualityDetail } from "../../shared/card-quality";

const f = vi.hoisted(() => ({ enabled: null as unknown as { value: boolean }, quality: vi.fn() }));
vi.mock("../src/lib/card-quality-capability", async () => {
  const { ref } = await import("vue");
  f.enabled = ref(true);
  return { useCardQualityCapability: () => f.enabled };
});
vi.mock("../src/lib/api", async (original) => ({ ...(await original<typeof import("../src/lib/api")>()), fetchCardQuality: f.quality }));
import CardGrid from "../src/components/CardGrid.vue";
import CardPreview from "../src/components/CardPreview.vue";
import { closeCardPreview } from "../src/lib/card-preview";

const card = (num: number, extra: Partial<CommunityCard> = {}) => ({
  id: String(num), num, name: `合成卡 ${num}`, summary: "合成簡介", tags: ["合成"], zone: "zh", avatarUrl: null,
  author: { handle: null, name: "合成作者", avatar: "" }, talkNum: 0, trending: 0, updatedAt: Date.now() - 3_600_000 * 5, ...extra,
} as CommunityCard);
const detail: CardQualityDetail = {
  length: { total: 23000, setting: 3000, worldbook: { entries: 18, characters: 19000 }, openings: { count: 3, characters: 1000 }, presentation: { openingPage: true, displayRules: 2, panel: false } },
  deepPlay: { rate: 82, medianTurns: 14 },
  rating: { average: 4.62, count: 30 },
  comments: 132,
};

let app: App, root: HTMLElement;
const settle = async () => { await nextTick(); await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
beforeEach(() => { f.enabled.value = true; f.quality.mockReset(); });
afterEach(() => { closeCardPreview(); app?.unmount(); root?.remove(); });
async function mount(cards: CommunityCard[]) {
  root = document.createElement("div"); document.body.append(root);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  app = createApp({ render: () => [h(CardGrid, { cards }), h(CardPreview)] }).use(router).use(i18n);
  app.mount(root); await settle();
}
it("shows no data line on tiles; the preview button stays on cards that have numbers", async () => {
  await mount([
    card(1, { qualitySignal: { lengthCharacters: 14000, deepPlay: null } }),
    card(2, { qualitySignal: { lengthCharacters: 23000, deepPlay: { rate: 82 } } }),
    card(3, { qualitySignal: null }),
  ]);
  // 磚上不寫篇幅或續玩率（owner 2026-11-29）
  expect(root.querySelector(".card__quality")).toBeNull();
  const text = root.textContent ?? "";
  for (const s of ["篇幅", "續玩率", "82%", "萬字"]) expect(text).not.toContain(s);
  // 沒有數字的那張不放預覽鈕
  expect(root.querySelectorAll(".card__preview")).toHaveLength(2);
});

it("keeps the old tile when the server has not turned the feature on", async () => {
  f.enabled.value = false;
  await mount([card(1, { qualitySignal: { lengthCharacters: 14000, deepPlay: null } })]);
  expect(root.querySelector(".card__quality")).toBeNull();
  expect(root.querySelector(".card__preview")).toBeNull();
  expect(root.querySelector(".card__corner--quality")).toBeNull();
});

it("opens the preview from the cover button, shows the data, and returns focus on Escape", async () => {
  f.quality.mockResolvedValue(detail);
  await mount([card(7, { featured: true, qualitySignal: { lengthCharacters: 23000, deepPlay: { rate: 82 } } })]);
  const button = root.querySelector<HTMLButtonElement>(".card__preview")!;
  expect(button.getAttribute("aria-label")).toBe("預覽「合成卡 7」");
  // 底列：精選槽、時間、預覽鈕都在同一列（畫面順序由 CSS order 排成時間、精選、預覽鈕）
  expect([...root.querySelector(".card__corner")!.children].map((e) => e.className.split(" ")[0])).toEqual(["card__feat-slot", "card__updated", "card__preview"]);
  button.focus(); button.click(); await settle();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  expect(f.quality).toHaveBeenCalledWith("7");
  expect(root.querySelector(".card")!.classList.contains("card--previewing")).toBe(true);
  const text = dialog.textContent ?? "";
  for (const s of ["續玩率", "82%", "4.6", "132", "14 回合", "內容", "3,000 字", "18 條・1.9 萬字", "開場網頁", "進入卡片"]) expect(text).toContain(s);
  // 內容只列設定、世界書、顯示規則：不列開場、不列篇幅總數與說明（owner 2026-11-29）
  for (const s of ["3 個", "1,000 字", "2.3 萬字", "篇幅", "面板"]) expect(text).not.toContain(s);
  const rows = [...dialog.querySelectorAll(".cq__row")].map((r) => [r.querySelector("dt")!.textContent, r.querySelector("dd")!.textContent]);
  expect(rows).toEqual([["設定字數", "3,000 字"], ["世界書", "18 條・1.9 萬字"], ["顯示規則", "2 條"]]);
  // 呈現方式只寫用了哪幾種，條數在上面
  expect([...dialog.querySelectorAll(".cq__chips li")].map((li) => li.textContent)).toEqual(["開場網頁", "顯示規則"]);
  expect(text).not.toContain("164/200");
  // 問號鈕：預設收起，點開才有怎麼算、分子分母與合格玩家資格
  const help = dialog.querySelector<HTMLButtonElement>('button[aria-label="續玩率怎麼算"]')!;
  const body = document.getElementById(help.getAttribute("aria-controls")!)!;
  expect(help.getAttribute("aria-expanded")).toBe("false");
  expect(body.style.display).toBe("none");
  help.click(); await settle();
  expect(help.getAttribute("aria-expanded")).toBe("true");
  expect(body.style.display).toBe("");
  expect(body.textContent).toContain("開聊的合格玩家中，玩了 5 回合以上的比例。");
  // 任何地方都不顯示玩家人數（owner 2026-11-28）
  expect(dialog.textContent).not.toMatch(/200|164/);
  expect(body.textContent).toContain("同一裝置的多個帳號算一人");
  expect(dialog.querySelector('a[href="/cards/7"]')).not.toBeNull();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("關閉預覽");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(button);
});

it("shows a retry line when the data does not load, and keeps the way into the card", async () => {
  f.quality.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...detail, deepPlay: null, rating: null, comments: 0 });
  await mount([card(8, { qualitySignal: { lengthCharacters: 23000, deepPlay: null } })]);
  root.querySelector<HTMLButtonElement>(".card__preview")!.click(); await settle();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.textContent).toContain("數據載入不了");
  expect(dialog.querySelector('a[href="/cards/8"]')).not.toBeNull();
  [...dialog.querySelectorAll("button")].find((b) => b.textContent?.includes("重試"))!.click(); await settle();
  expect(dialog.textContent).not.toContain("數據載入不了");
  // 未滿門檻、沒有評分與留言：整塊玩家數據不出現
  expect(dialog.textContent).not.toContain("玩家數據");
  expect(dialog.textContent).toContain("3,000 字");
});

it("treats a card the server has no numbers for as empty, not as a load failure", async () => {
  const { ApiError } = await import("../src/lib/api");
  f.quality.mockRejectedValue(new ApiError(404, "not found"));
  await mount([card(9, { qualitySignal: { lengthCharacters: 0, deepPlay: null } })]);
  root.querySelector<HTMLButtonElement>(".card__preview")!.click(); await settle();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.textContent).not.toContain("數據載入不了");
  expect(dialog.querySelector('a[href="/cards/9"]')).not.toBeNull();
});

it("opens the preview from the data the list already carries, without another request", async () => {
  await mount([card(10, { qualitySignal: { lengthCharacters: 23000, deepPlay: { rate: 82 }, detail } })]);
  root.querySelector<HTMLButtonElement>(".card__preview")!.click(); await settle();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(f.quality).not.toHaveBeenCalled();
  expect(dialog.querySelector(".cq__ghosts")).toBeNull();
  const text = dialog.textContent ?? "";
  for (const s of ["82%", "4.6", "132", "14 回合", "18 條・1.9 萬字"]) expect(text).toContain(s);
});
