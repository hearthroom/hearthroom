/**
 * 字典 486 KB：首屏還在載的時候不能一起抓（封面、卡片頁的開場白都在跟它搶頻寬），
 * 等頁面載完、網路安靜下來才下載。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const loaded = vi.fn();
vi.mock("moonstage/display-script", () => {
  loaded();
  return { directionForLocale: () => "t2s", createDisplayScriptConverter: () => (t: string) => t.replace("與", "与"), convertPlainText: (t: string, c: (s: string) => string) => c(t) };
});

beforeEach(() => { vi.resetModules(); loaded.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

it("頁面還在載入時不下載轉換器，載完、網路安靜後才下載並換成轉換後的標題", async () => {
  const state = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  const { displayName, displayScriptReady } = await import("../src/lib/display-name");
  expect(displayName("龍與貓", "zh-Hans")).toBe("龍與貓");
  await new Promise((r) => setTimeout(r, 300));
  expect(loaded).not.toHaveBeenCalled();
  state.mockReturnValue("complete");
  window.dispatchEvent(new Event("load"));
  await displayScriptReady();
  expect(loaded).toHaveBeenCalledTimes(1);
  expect(displayName("龍與貓", "zh-Hans")).toBe("龍与貓");
}, 15000);

it("載完之後頁面還在下載內容（卡片頁的開場白）時繼續等，安靜一秒才下載", async () => {
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  let finished = 0;
  const busy = setInterval(() => { finished += 1; }, 200);
  vi.spyOn(performance, "getEntriesByType").mockImplementation(() => Array.from({ length: finished }) as PerformanceEntry[]);
  const { displayName, displayScriptReady } = await import("../src/lib/display-name");
  displayName("龍與貓", "zh-Hans");
  await new Promise((r) => setTimeout(r, 1600));
  expect(displayName("龍與貓", "zh-Hans"), "still downloading page content").toBe("龍與貓");
  clearInterval(busy);
  await displayScriptReady();
  expect(displayName("龍與貓", "zh-Hans")).toBe("龍与貓");
}, 15000);
