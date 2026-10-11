/**
 * 類型目錄分組（2026-10-11）：52 顆籤平鋪佔掉半屏。分成玩法、題材、角色、偏好四組，
 * 首頁預設只攤開前兩組。每顆籤恰好屬於一組，組的順序固定（畫面照這個順序排）。
 */
import { expect, it } from "vitest";
import { TAG_CATALOG, TAG_GROUPS, tagGroupOf } from "../shared/tag-catalog";

it("每顆籤恰好一組，四組照固定順序", () => {
  expect(TAG_GROUPS).toEqual(["play", "setting", "character", "kink"]);
  for (const entry of TAG_CATALOG) expect(TAG_GROUPS, entry.key).toContain(tagGroupOf(entry.key));
  expect(tagGroupOf("roleplay")).toBe("play");
  expect(tagGroupOf("xianxia")).toBe("setting");
  expect(tagGroupOf("onee-san")).toBe("character");
  expect(tagGroupOf("ntr")).toBe("kink");
  expect(tagGroupOf("not-a-key")).toBeNull();
});
