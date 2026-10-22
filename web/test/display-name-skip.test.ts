/**
 * 標題裡沒有一個字需要換字形（簡體介面看簡體標題、正體介面看繁體標題），轉換結果就是原文：
 * 不為它下載 486 KB 的字典。先載一張小對照表（shared/hant-hans.ts）判斷要不要換。
 * 字典的工廠只在第一次載入時執行，所以「沒載」的斷言放在這個檔的第一個測試。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const loaded = vi.fn();
vi.mock("moonstage/display-script", () => {
  loaded();
  return { directionForLocale: () => "t2s", createDisplayScriptConverter: () => (t: string) => t.replace("與", "与"), convertPlainText: (t: string, c: (s: string) => string) => c(t) };
});

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); });

it("簡體介面看簡體標題、正體介面看繁體標題：不下載字典", async () => {
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  const { displayName } = await import("../src/lib/display-name");
  expect(displayName("凡人修仙传：人界篇", "zh-Hans")).toBe("凡人修仙传：人界篇");
  expect(displayName("魔法少女與黑貓", "zh-Hant")).toBe("魔法少女與黑貓");
  await new Promise((r) => setTimeout(r, 2500));
  // 對照表載好之後頁面會再畫一次：那一次也不該觸發字典
  expect(displayName("凡人修仙传：人界篇", "zh-Hans")).toBe("凡人修仙传：人界篇");
  expect(displayName("魔法少女與黑貓", "zh-Hant")).toBe("魔法少女與黑貓");
  await new Promise((r) => setTimeout(r, 2500));
  expect(loaded).not.toHaveBeenCalled();
}, 15000);

it("對照表載好之後，看到要換字形的標題就下載字典並換掉", async () => {
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  const { displayName } = await import("../src/lib/display-name");
  displayName("凡人修仙传", "zh-Hans");
  await new Promise((r) => setTimeout(r, 300));
  expect(displayName("龍與貓", "zh-Hans")).toBe("龍與貓");
  await vi.waitFor(() => expect(displayName("龍與貓", "zh-Hans")).toBe("龍与貓"), { timeout: 12000, interval: 200 });
}, 15000);
