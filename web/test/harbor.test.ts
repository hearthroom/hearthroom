import { afterEach, describe, expect, it, vi } from "vitest";
import {
  harborCreateRole,
  harborPublish,
  harborSaveDocument,
  harborScoreRecords,
  harborUploadImage,
  harborWallet,
} from "../src/lib/harbor";

type Call = { url: string; init: RequestInit };

/** 依序回應的假 fetch：每個呼叫取下一個回應，並記下送出的內容。 */
function scripted(...responses: Array<[number, unknown]>) {
  const calls: Call[] = [];
  const queue = [...responses];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const [status, body] = queue.shift() ?? [500, {}];
    // 跟 Provider 一樣：沒有內容的回應（204、202 送審受理）就是空的 body
    return new Response(body === null ? null : JSON.stringify(body), { status });
  }));
  return calls;
}
const sent = (c: Call) => JSON.parse(String(c.init.body));

afterEach(() => vi.unstubAllGlobals());

describe("harborCreateRole", () => {
  it("走新設計的建卡端點，自報來源，回傳沿用 roleId 的形狀", async () => {
    const calls = scripted([201, { id: "r-1", origin: "hearthroom" }]);
    expect(await harborCreateRole({ roleName: "阿芙拉", language: "zh-Hant" }, "tok")).toEqual({ roleId: "r-1" });
    expect(calls[0]!.url).toMatch(/\/open\/v1\/roles$/);
    expect(sent(calls[0]!)).toEqual({ origin_locale: "zh-Hant", name: "阿芙拉", origin: "hearthroom" });
  });
});

describe("harborSaveDocument", () => {
  it("語區整行覆寫：先讀目前的原文，把改動併進去再送，沒改的欄位不會被清空", async () => {
    const calls = scripted(
      [200, { language: "en", roleName: "Ava", roleDesc: "old summary", roleDetailDesc: "persona", roleWelcome: "hi" }],
      [204, null],
    );
    await harborSaveDocument("r-1", { roleDesc: "new summary" }, "tok");
    expect(calls[0]!.url).toContain("/open/v1/role/detail?roleId=r-1");
    expect(calls[1]!.url).toMatch(/\/open\/v1\/roles\/r-1\/locales$/);
    expect(sent(calls[1]!)).toEqual({ locale: "en", name: "Ava", summary: "new summary", description: "persona", greeting: "hi" });
  });

  it("封面只送有換的那張，網址換回上傳時拿到的資產編號；清空送空字串", async () => {
    const calls = scripted(
      [201, { assetId: "a-1", upload: { url: "http://h/internal/blob/staging/a-1", method: "PUT", headers: { "Content-Type": "image/png" } } }],
      [204, null],
      [200, { id: "a-1", url: "http://h/blob/media/a-1" }],
    );
    const url = await harborUploadImage(new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }), "tok");
    expect(url).toBe("http://h/blob/media/a-1");

    const more = scripted([204, null]);
    await harborSaveDocument("r-1", { roleAvatar: url, roleBackground: "" }, "tok");
    expect(more).toHaveLength(1);
    expect(more[0]!.url).toMatch(/\/open\/v1\/roles\/r-1\/assets$/);
    expect(sent(more[0]!)).toEqual({ avatar: "a-1", background: "" });
    expect(calls[1]!.init.method).toBe("PUT");
  });

  it("不是這次上傳的網址（例如圖庫裡選的舊圖）送不了，明說而不是悄悄忽略", async () => {
    scripted();
    await expect(harborSaveDocument("r-1", { roleAvatar: "https://elsewhere/x.png" }, "tok")).rejects.toThrow();
  });
});

describe("harborPublish", () => {
  it("公開＝設為公開並送平台審核，分級由作者宣告", async () => {
    const calls = scripted([204, null], [202, null]);
    await harborPublish("r-1", true, "tok");
    expect(sent(calls[0]!)).toEqual({ visibility: "public" });
    expect(calls[1]!.url).toMatch(/\/roles\/r-1\/submit$/);
    expect(sent(calls[1]!)).toEqual({ content_rating: "mature" });
  });
});

describe("錢包", () => {
  it("餘額對到原本畫面的欄位；流水轉成加減紀錄", async () => {
    scripted([200, { available: 150, permanent: 100, expiring: 50, reserved: 0, ledger: [] }]);
    expect(await harborWallet("tok")).toEqual({ score: 100, tempScore: 50, plans: [] });

    scripted([200, { available: 150, permanent: 150, expiring: 0, reserved: 0, ledger: [
      { id: "l-2", at: "2026-09-14T08:00:00Z", reason: "chat", amount: -3 },
      { id: "l-1", at: "2026-09-13T08:00:00Z", reason: "purchase", amount: 100 },
    ] }]);
    const page = await harborScoreRecords("tok");
    expect(page.records.map((r) => [r.recordType, r.score, r.record])).toEqual([["sub", 3, "chat"], ["add", 100, "purchase"]]);
    expect(page.hasNextPage).toBe(false);
  });
});
