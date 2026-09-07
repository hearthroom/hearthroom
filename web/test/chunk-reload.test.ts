/**
 * 舊頁面撞上新部署：懶載入的區塊 hash 已換、拿到 404。要做的是整頁重載一次到目標網址，
 * 而且只能一次——重載完還是失敗就不是版本問題，別讓使用者的頁面無限轉。
 */
import { describe, expect, it } from "vitest";
import { isChunkLoadError, shouldReload } from "../src/lib/chunk-reload";

describe("isChunkLoadError", () => {
  it("三家瀏覽器的動態匯入失敗訊息都認得", () => {
    for (const msg of [
      "Failed to fetch dynamically imported module: https://hearthroom.club/assets/PlayPage-CaLnU3BK.js",
      "error loading dynamically imported module: https://hearthroom.club/assets/x.js",
      "Importing a module script failed.",
      "Unable to preload CSS for /assets/ResourcesPage-abc.css",
    ]) expect(isChunkLoadError(new Error(msg))).toBe(true);
  });
  it("別的錯誤不算", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError("string")).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("shouldReload", () => {
  it("沒重載過 → 重載；十秒內重載過 → 不再重載；過了十秒 → 可以再來", () => {
    expect(shouldReload(1_000_000, null)).toBe(true);
    expect(shouldReload(1_000_000, 995_000)).toBe(false);
    expect(shouldReload(1_000_000, 980_000)).toBe(true);
  });
});
