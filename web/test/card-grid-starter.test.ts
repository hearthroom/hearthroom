import { afterEach, describe, expect, it } from "vitest";
import { createApp, nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import CardGrid from "../src/components/CardGrid.vue";
import type { CommunityCard } from "../src/lib/types";

const card = (num: number) => ({
  id: String(num), num, name: `Card ${num}`, summary: "", tags: [], zone: "zh", avatarUrl: null,
  author: { handle: null, name: "Author", avatar: "" }, talkNum: 0, trending: 0,
} as CommunityCard);
let app: ReturnType<typeof createApp>;
let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); });
async function mount(starter: CommunityCard | null, cards = [card(1), card(100218), card(2)], loading = false) {
  root = document.createElement("div"); document.body.append(root);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
  await router.push("/");
  app = createApp(CardGrid, { cards, starter, loading, ranked: true }).use(router).use(i18n);
  app.mount(root); await nextTick();
}
describe("starter in the normal card grid", () => {
  it("prepends one normal tile, deduplicates it, and preserves other cards' order and ranks", async () => {
    await mount(card(100218));
    const grid = root.querySelector(".grid")!;
    expect(grid.children).toHaveLength(3);
    const starter = grid.firstElementChild!;
    expect(starter.matches('article.card[data-tour="starter"]')).toBe(true);
    expect(starter.querySelector(".card__rank")).toBeNull();
    expect([...grid.querySelectorAll(".card__link")].map(a => a.getAttribute("href"))).toEqual(["/cards/100218", "/cards/1", "/cards/2"]);
    expect([...grid.querySelectorAll(".card__rank")].map(e => e.textContent)).toEqual(["1", "3"]);
  });
  it("without a tour, preserves the original feed without an injected tile", async () => {
    await mount(null);
    expect(root.querySelector('[data-tour="starter"]')).toBeNull();
    expect([...root.querySelectorAll(".card__link")].map(a => a.getAttribute("href"))).toEqual(["/cards/1", "/cards/100218", "/cards/2"]);
  });
  it("keeps a loaded starter clickable while the rest of the feed is loading or empty", async () => {
    await mount(card(100218), [], true);
    expect(root.querySelector('[data-tour="starter"] .card__link')?.getAttribute("href")).toBe("/cards/100218");
  });
});
