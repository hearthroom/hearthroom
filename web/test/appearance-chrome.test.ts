/**
 * 對話頁把系統狀態列（theme-color）塗成卡片頂欄色。
 * iOS Safari 對既有標籤改 content 不會重新染色，所以要換掉整個 <meta>（LunaTalk mobile 同一招）；
 * body 也塗成同色；站台跟著系統切深淺時不能把它蓋回紙色。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let changeListener: ((e: { matches: boolean }) => void) | null = null;
beforeEach(() => {
  vi.resetModules();
  changeListener = null;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { changeListener = fn; },
    removeEventListener: () => {},
  }));
  document.head.innerHTML = '<meta name="theme-color" content="#f5f5f7">';
  document.documentElement.style.setProperty("--bg", "#f5f5f7");
  document.body.removeAttribute("style");
});
afterEach(() => { vi.unstubAllGlobals(); document.head.innerHTML = ""; });

const meta = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!;

it("replaces the theme-color tag instead of editing it, and paints the body in the same color", async () => {
  const { useAppearance } = await import("@/lib/appearance");
  const original = meta();
  useAppearance().setChromeColor("rgb(32, 28, 40)");
  expect(meta().content).toBe("rgb(32, 28, 40)");
  expect(meta()).not.toBe(original);
  expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  expect(document.body.style.backgroundColor).toBe("rgb(32, 28, 40)");
  const tinted = meta();
  useAppearance().setChromeColor("rgb(32, 28, 40)");
  expect(meta()).toBe(tinted);
});

it("keeps the card's header color when the system switches between light and dark", async () => {
  const { useAppearance } = await import("@/lib/appearance");
  useAppearance().setChromeColor("rgb(32, 28, 40)");
  document.documentElement.style.setProperty("--bg", "#101014");
  changeListener?.({ matches: true });
  expect(meta().content).toBe("rgb(32, 28, 40)");
});

it("returns to the site color and clears the body color when the conversation page is left", async () => {
  const { useAppearance } = await import("@/lib/appearance");
  useAppearance().setChromeColor("rgb(32, 28, 40)");
  useAppearance().setChromeColor(null);
  expect(meta().content).toBe("#f5f5f7");
  expect(document.body.style.backgroundColor).toBe("");
});
