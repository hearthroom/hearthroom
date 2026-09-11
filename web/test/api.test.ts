import { afterEach, describe, expect, it, vi } from "vitest";
import { createRole, fetchLibraryImages, fetchWorldbookEntries, readKeywordList } from "../src/lib/api";

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
      { entryId: "e-1", name: "eldoria", content: "A forest.", keywords: ["eldoria", "wood", "forest"], secondaryKeywords: [], isEnabled: true, isConstant: false, category: "custom", triggerRegion: "both", activationCount: 0 },
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

describe("fetchLibraryImages", () => {
  it("明說 kind（上游不給就只看圖片），拆 {code,data} 殼，存量圖沒 kind 當圖片", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { total: 1, quota: 10000, usedBytes: 5, byteQuota: 500 << 20, imageList: [{ id: 9, imageUrl: "https://cdn.test/9.png", moderationState: "legacy" }] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const page = await fetchLibraryImages({ kind: "unfiled" }, 2, 24, "tok", "font");
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain("/open/v1/image/list?scope=unfiled&kind=font&pageNum=2&pageSize=24");
    expect(page.items[0]).toMatchObject({ id: 9, kind: "image", byteSize: 0 });
    expect(page.byteQuota).toBe(500 << 20);
  });
});

describe("錯誤訊息給人看", () => {
  it("認得的錯誤碼各有一句人話；不認得的碼附在後面；伺服器寫給人看的句子原樣講", async () => {
    const { describeApiError } = await import("../src/lib/api");
    const { i18n } = await import("../src/lib/i18n");
    expect(describeApiError(400, "role_in_review")).toBe(i18n.global.t("error.roleInReview"));
    expect(describeApiError(400, "invalid_arguments")).toBe(i18n.global.t("error.invalidArguments"));
    expect(describeApiError(400, "weird_code")).toBe(`${i18n.global.t("state.requestFailed")} (weird_code)`);
    expect(describeApiError(400, "內容包含不適當字詞")).toBe("內容包含不適當字詞");
    expect(describeApiError(502, "")).toBe(i18n.global.t("state.serverBusy"));
  });

  // 2026-09-11 一位作者存 1.18 MB 的規則只看到「請求失敗 (validate_reject)」。
  // 上游現在附 detail：有就講出多大、上限多少、第幾條叫什麼；沒有就退回通用那句。
  it("validate_reject 帶明細就照明細講", async () => {
    const { describeApiError } = await import("../src/lib/api");
    const { i18n } = await import("../src/lib/i18n");
    const whole = describeApiError(400, "validate_reject", { reason: "rulesTotal", index: -1, name: "", max: 32 * 1024 * 1024, actual: 34 * 1024 * 1024, unit: "bytes" });
    expect(whole).toBe(i18n.global.t("error.validateReject.rulesTotal", { sizeMB: "34", maxMB: 32, index: 0, name: "", sizeKB: 34816, maxKB: 32768 }));
    expect(whole).toContain("34");
    expect(whole).toContain("32");
    const one = describeApiError(400, "validate_reject", { reason: "ruleReplace", index: 1, name: "特化庫", max: 131072, actual: 131073, unit: "bytes" });
    expect(one).toContain("2");
    expect(one).toContain("特化庫");
    expect(one).toContain("129");
    expect(describeApiError(400, "validate_reject")).toBe(i18n.global.t("error.validateReject"));
    expect(describeApiError(400, "validate_reject", { reason: "mountLayer" })).toBe(i18n.global.t("error.validateReject"));
    expect(describeApiError(413, "")).toBe(i18n.global.t("error.payloadTooLarge"));
  });
});

describe("使用者設定（全局人設）", () => {
  it("讀回上游的人設與暱稱；存檔只送動到的欄位", async () => {
    const { fetchPlayerPersona, savePlayerPersona } = await import("../src/lib/api");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/player/persona")) return new Response(JSON.stringify({ userName: "小明", userSex: "man", userDefine: "", nickName: "阿強", exists: true }), { status: 200 });
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ userDefine: "高二學生" });
      return new Response(JSON.stringify({ userName: "小明", userSex: "man", userDefine: "高二學生" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const p = await fetchPlayerPersona("tok");
    expect(p).toEqual({ userName: "小明", userSex: "man", userDefine: "", nickName: "阿強", exists: true });
    const saved = await savePlayerPersona({ userDefine: "高二學生" }, "tok");
    expect(saved.userDefine).toBe("高二學生");
    vi.unstubAllGlobals();
  });
});
