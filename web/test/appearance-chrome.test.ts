/**
 * 對話頁把系統狀態列（theme-color）塗成卡片頂欄色；站台跟著系統切深淺時不能把它蓋回紙色。
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
});
afterEach(() => { vi.unstubAllGlobals(); document.head.innerHTML = ""; });

const meta = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content;

it("keeps the card's header color when the system switches between light and dark", async () => {
  const { useAppearance } = await import("@/lib/appearance");
  useAppearance().setChromeColor("rgb(32, 28, 40)");
  expect(meta()).toBe("rgb(32, 28, 40)");
  document.documentElement.style.setProperty("--bg", "#101014");
  changeListener?.({ matches: true });
  expect(meta()).toBe("rgb(32, 28, 40)");
});

it("returns to the site color when the conversation page is left", async () => {
  const { useAppearance } = await import("@/lib/appearance");
  useAppearance().setChromeColor("rgb(32, 28, 40)");
  useAppearance().setChromeColor(null);
  expect(meta()).toBe("#f5f5f7");
});
