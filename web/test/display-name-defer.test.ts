/**
 * 字典 486 KB：首屏還在載（封面圖是最大內容繪製）時不能一起抓，等頁面載完、瀏覽器空下來才下載。
 */
import { afterEach, expect, it, vi } from "vitest";

const loaded = vi.fn();
vi.mock("moonstage/display-script", () => {
  loaded();
  return { directionForLocale: () => "t2s", createDisplayScriptConverter: () => (t: string) => t.replace("與", "与"), convertPlainText: (t: string, c: (s: string) => string) => c(t) };
});

afterEach(() => { vi.restoreAllMocks(); });

it("頁面還在載入時不下載轉換器，載完、空閒後才下載並換成轉換後的標題", async () => {
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
});
