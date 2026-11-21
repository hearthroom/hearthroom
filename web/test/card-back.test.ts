/** 卡片頁返回鈕：回到進卡前那一頁，切分頁推的歷史一起退；直接開連結進來的交給連結去首頁。 */
import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import CardBackLink from "../src/components/CardBackLink.vue";
import { entryOf, readEntry, stepsBack } from "../src/lib/card-back";

it("goes back one step when the card was opened from a list", () => {
  expect(stepsBack(readEntry({ position: 4, back: "/search?q=x" }), readEntry({ position: 4, back: "/search?q=x" }))).toBe(1);
});
it("also undoes the history the card page pushed for its own tabs", () => {
  const entry = readEntry({ position: 4, back: "/" });
  expect(stepsBack(entry, readEntry({ position: 6, back: "/cards/1?tab=workshop" }))).toBe(3);
});
it("has no step back when the card was opened directly", () => {
  expect(stepsBack(readEntry({ position: 0, back: null }), readEntry({ position: 0, back: null }))).toBeNull();
  expect(stepsBack(readEntry(null), readEntry({ position: 2, back: "/" }))).toBeNull();
});
it("does not guess when the history went behind the entry", () => {
  expect(stepsBack(readEntry({ position: 4, back: "/" }), readEntry({ position: 3, back: "/" }))).toBeNull();
});

// 停在工坊分頁時重新整理、或從別頁返回到工坊分頁：頁面重新掛載，進卡那一筆要從 state 讀回，不能把分頁那一筆當入口
it("reads the card's entry carried on its own tab history after a remount", () => {
  const tabEntry = { position: 6, back: "/cards/1", cardEntry: { position: 4, back: "/search?q=x" } };
  expect(stepsBack(entryOf(tabEntry), readEntry(tabEntry))).toBe(3);
  const directThenTab = { position: 1, back: "/cards/1", cardEntry: { position: 0, back: null } };
  expect(stepsBack(entryOf(directThenTab), readEntry(directThenTab))).toBeNull();
  expect(entryOf({ position: 2, back: "/" })).toEqual({ position: 2, back: "/" });
});

let app: App | null = null;
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = ""; history.replaceState(null, "", "/"); });
async function mountLink(entry: { position: number; back: string | null }) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push("/cards/1");
  const push = vi.spyOn(router, "push"); const go = vi.spyOn(router, "go").mockImplementation(() => {});
  const el = document.createElement("div"); document.body.append(el);
  app = createApp({ render: () => h(CardBackLink, { to: "/", entry, class: "btn", "data-card-back": "" }, () => "Back") }).use(router);
  app.mount(el);
  return { link: el.querySelector<HTMLAnchorElement>("[data-card-back]")!, push, go };
}
const click = (init: MouseEventInit = {}) => new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });

// RouterLink 自己的換頁和退回同時跑，會先推一筆首頁再退，落點不定（code-review 2026-11-21）
it("starts exactly one navigation: back to the list when there is one", async () => {
  history.replaceState({ position: 5, back: "/" }, "", "/cards/1");
  const { link, push, go } = await mountLink({ position: 5, back: "/" });
  const e = click(); link.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  expect(go).toHaveBeenCalledWith(-1);
  expect(push).not.toHaveBeenCalled();
  expect(link.classList.contains("btn")).toBe(true);
});
it("starts exactly one navigation: home when opened directly", async () => {
  history.replaceState({ position: 0, back: null }, "", "/cards/1");
  const { link, push, go } = await mountLink({ position: 0, back: null });
  link.dispatchEvent(click());
  expect(go).not.toHaveBeenCalled();
  expect(push).toHaveBeenCalledTimes(1);
});
it("leaves modified clicks to the browser (new tab)", async () => {
  history.replaceState({ position: 5, back: "/" }, "", "/cards/1");
  const { link, push, go } = await mountLink({ position: 5, back: "/" });
  for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) {
    const e = click(init); link.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  }
  expect(go).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});
