import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { i18n } from "../src/lib/i18n";
import type { CommunityCard } from "../src/lib/types";

const f = vi.hoisted(() => ({ quality: vi.fn() }));
vi.mock("../src/lib/card-quality-capability", async () => { const { ref } = await import("vue"); return { useCardQualityCapability: () => ref(true) }; });
vi.mock("../src/lib/api", async (original) => ({ ...(await original<typeof import("../src/lib/api")>()), fetchCardQuality: f.quality }));
import CardQualitySection from "../src/components/CardQualitySection.vue";
import { ApiError } from "../src/lib/api";

let app: App, root: HTMLElement;
const settle = async () => { await nextTick(); await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
const phone = (matches: boolean) => vi.stubGlobal("matchMedia", () => ({ matches, addEventListener() {}, removeEventListener() {} }));
beforeEach(() => { f.quality.mockReset(); });
afterEach(() => { app?.unmount(); root?.remove(); vi.unstubAllGlobals(); });
const card = (id: string, signal: CommunityCard["qualitySignal"]) => ({ id, num: Number(id), name: "合成卡", qualitySignal: signal } as CommunityCard);
async function mount(c: CommunityCard) {
  root = document.createElement("div"); document.body.append(root);
  app = createApp(CardQualitySection, { card: c }).use(i18n); app.mount(root); await settle();
}

it("on phones starts folded into one line and opens from the title row", async () => {
  phone(true);
  f.quality.mockResolvedValue({ length: { total: 23000, setting: 3000, worldbook: { entries: 0, characters: 0 }, openings: { count: 1, characters: 0 }, presentation: { openingPage: false, displayRules: 0, panel: false } }, deepPlay: { reached: 164, players: 200, turns: 5, medianTurns: 6.5 }, rating: null, comments: null });
  await mount(card("101", { lengthCharacters: 23000, deepPlay: { reached: 164, players: 200, turns: 5 } }));
  const toggle = root.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.textContent).toContain("聊滿 5 回合 164/200・篇幅 2.3 萬字");
  expect((root.querySelector("#card-quality-body") as HTMLElement).style.display).toBe("none");
  toggle.click(); await settle();
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect((root.querySelector("#card-quality-body") as HTMLElement).style.display).toBe("");
  // 回合中位數可能是半回合：留一位小數，整數不補 .0
  expect(root.textContent).toContain("6.5 回合");
});

it("uses the fresh numbers once loaded, even when the card fell back under the player threshold", async () => {
  phone(true);
  f.quality.mockResolvedValue({ length: { total: 23000, setting: null, worldbook: { entries: 0, characters: 0 }, openings: { count: 0, characters: 0 }, presentation: { openingPage: false, displayRules: 0, panel: false } }, deepPlay: null, rating: null, comments: null });
  await mount(card("102", { lengthCharacters: 23000, deepPlay: { reached: 20, players: 20, turns: 5 } }));
  const summary = root.querySelector("button[aria-expanded]")!.textContent!;
  expect(summary).toContain("篇幅 2.3 萬字");
  expect(summary).not.toContain("20/20");
});

it("stays expanded on desktop without a toggle", async () => {
  phone(false);
  f.quality.mockResolvedValue({ length: { total: 3000, setting: 3000, worldbook: { entries: 0, characters: 0 }, openings: { count: 0, characters: 0 }, presentation: { openingPage: false, displayRules: 0, panel: false } }, deepPlay: null, rating: null, comments: null });
  await mount(card("104", { lengthCharacters: 3000, deepPlay: null }));
  expect(root.querySelector("button[aria-expanded]")).toBeNull();
  expect((root.querySelector("#card-quality-body") as HTMLElement).style.display).toBe("");
  expect(root.textContent).toContain("3,000 字");
});

it("hides itself when the server has no numbers for the card", async () => {
  phone(false);
  f.quality.mockRejectedValue(new ApiError(404, "not found"));
  await mount(card("103", null));
  expect(root.querySelector("section")).toBeNull();
});
