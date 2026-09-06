import { afterEach, describe, expect, it, vi } from "vitest";
import { createRole, fetchWorldbookEntries, readKeywordList } from "../src/lib/api";

/** 上游真實回應的形狀（2026-09-06 線上抓的）：`list` 而不是 `entries`，關鍵詞是 JSON 字串。 */
const UPSTREAM_ROW = {
  id: 424561, entryId: "e-1", worldbookId: "wb-1", name: "eldoria",
  content: "A forest.", keywords: '["eldoria","wood","forest"]', category: "custom",
  isEnabled: true, isConstant: false, triggerRegion: "both", priority: 60, sortOrder: 0, activationCount: 0,
};

afterEach(() => vi.unstubAllGlobals());

describe("fetchWorldbookEntries", () => {
  it("讀上游的 list 與 JSON 字串關鍵詞", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ list: [UPSTREAM_ROW] }), { status: 200 })));
    const entries = await fetchWorldbookEntries("wb-1", "tok");
    expect(entries).toEqual([
      { entryId: "e-1", name: "eldoria", content: "A forest.", keywords: ["eldoria", "wood", "forest"], secondaryKeywords: [], isEnabled: true, isConstant: false, activationCount: 0 },
    ]);
  });

  it("也吃 entries 陣列那種形狀，關鍵詞已是陣列就原樣用", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ entries: [{ ...UPSTREAM_ROW, keywords: ["a"] }] }), { status: 200 })));
    expect((await fetchWorldbookEntries("wb-1", "tok"))[0].keywords).toEqual(["a"]);
  });
});

describe("readKeywordList", () => {
  it("JSON 字串、陣列、逗號分隔、空值", () => {
    expect(readKeywordList('["a"," b "]')).toEqual(["a", "b"]);
    expect(readKeywordList(["x", ""])).toEqual(["x"]);
    expect(readKeywordList("甲、乙, 丙")).toEqual(["甲", "乙", "丙"]);
    expect(readKeywordList("")).toEqual([]);
    expect(readKeywordList(null)).toEqual([]);
  });
});

describe("createRole", () => {
  it("建卡自報 origin=hearthroom：上游記在卡上，本站只認這種卡", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ roleId: "r1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createRole({ roleName: "阿芙拉", language: "zh-Hant" }, "tok");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({ roleName: "阿芙拉", language: "zh-Hant", origin: "hearthroom" });
  });
});
