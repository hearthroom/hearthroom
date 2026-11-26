/**
 * 開場網頁的大頁面那一半（任務 2026-11-25-opening-page-object-storage）：
 * 大小規則、上限從契約讀、存檔怎麼送（原始上傳／JSON／openingPageClear）、讀取與上傳的失敗與取消。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorAsset } from "../src/lib/api";

const api = vi.hoisted(() => ({
  fetchOpeningPage: vi.fn(),
  uploadOpeningPage: vi.fn(),
}));
vi.mock("../src/lib/api", () => api);
vi.mock("../src/lib/save-file", () => ({ downloadBlob: vi.fn() }));

import {
  formatPageSize, isAbortError, isHtmlFile, OPENING_PAGE_EDIT_MAX_BYTES,
  openingPageMaxBytes, pageLimitMB, setOpeningPageLimitsForTest, utf8Length, workshopOpeningPageMaxBytes,
} from "../src/lib/opening-page";
import { useOpeningFile } from "../src/lib/opening-file";
import { downloadBlob } from "../src/lib/save-file";

const KB = 1024;
const MB = 1000 * 1000;
const html = (bytes: number) => "<p>" + "a".repeat(Math.max(0, bytes - 7)) + "</p>";
const asset = (extra: Partial<AuthorAsset>): AuthorAsset => ({
  rules: [], mountTrigger: "", mountLayer: "over", pageMode: "sandbox", cardFormat: "", openingPage: "", status: "passed", version: 4, ...extra,
});
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };

function harness(opts: { confirmClear?: boolean; confirmReplace?: boolean } = {}) {
  const state = { text: "", original: "" };
  const control = useOpeningFile({
    text: () => state.text,
    setText: (value, baseline) => { state.text = value; if (baseline) state.original = value; },
    token: async () => "tok",
    confirmClear: async () => opts.confirmClear ?? true,
    confirmReplace: async () => opts.confirmReplace ?? true,
    maxBytes: openingPageMaxBytes,
  });
  return { state, control };
}

beforeEach(() => {
  api.fetchOpeningPage.mockReset();
  api.uploadOpeningPage.mockReset();
  setOpeningPageLimitsForTest({ max: 100 * MB });
});
afterEach(() => setOpeningPageLimitsForTest({ max: null, workshop: null }));

describe("大小規則", () => {
  it("預設讀取正式的 100 MB 與工坊的 512 KiB，測試仍能模擬舊上限", () => {
    setOpeningPageLimitsForTest({ max: null });
    expect(openingPageMaxBytes()).toBe(100000000);
    setOpeningPageLimitsForTest({ max: 524288 });
    expect(openingPageMaxBytes()).toBe(524288);
    expect(workshopOpeningPageMaxBytes()).toBe(524288);

  });

  it("UTF-8 位元組與 TextEncoder 一致（中文、emoji、落單代理字元）", () => {
    for (const s of ["abc", "開場網頁", "😀x", "a\ud800b", "\udc00"]) expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length);
  });

  it("大小 1 MB 以下印 KB、以上印 MB（十進位，跟上游的 100 MB 同一把尺），無條件進位；上限印成 MB 數字", () => {
    expect(formatPageSize(512_000, "en")).toBe("512 KB");
    expect(formatPageSize(512_001, "en")).toBe("512.1 KB");
    expect(formatPageSize(512 * KB, "en")).toBe("524.3 KB");
    expect(formatPageSize(1_500_000, "en")).toBe("1.5 MB");
    expect(formatPageSize(100_000_000, "en")).toBe("100 MB");
    expect(formatPageSize(100_000_001, "en")).toBe("100.1 MB");
    expect(pageLimitMB(512 * KB, "en")).toBe("0.5");
    expect(pageLimitMB(100_000_000, "en")).toBe("100");
  });

  it("只收 .html／.htm；取消不是錯誤", () => {
    expect(isHtmlFile({ name: "a.HTML" })).toBe(true);
    expect(isHtmlFile({ name: "a.htm" })).toBe(true);
    expect(isHtmlFile({ name: "a.txt", type: "text/plain" })).toBe(false);
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("x"))).toBe(false);
  });
});

describe("讀進來", () => {
  it("舊上游（沒有大小與網址）：照舊，什麼都不讀", () => {
    const { state, control } = harness();
    state.text = state.original = "<div>小</div>";
    control.adopt(asset({ openingPage: "<div>小</div>" }));
    expect(control.file.value).toBeNull();
    expect(control.storedLarge.value).toBe(false);
    expect(api.fetchOpeningPage).not.toHaveBeenCalled();
  });

  it("上游沒內嵌、在編輯門檻內：自動讀進文字框，算是「上次存的」", async () => {
    const page = html(600 * KB);
    api.fetchOpeningPage.mockResolvedValueOnce(new Blob([page]));
    const { state, control } = harness();
    control.adopt(asset({ openingPageBytes: 600 * KB, openingPageUrl: "/open/v1/role/author-asset/opening?roleId=r1" }));
    expect(control.file.value?.bytes).toBe(600 * KB);
    await flush();
    expect(api.fetchOpeningPage).toHaveBeenCalledWith("/open/v1/role/author-asset/opening?roleId=r1", "tok", expect.objectContaining({ total: 600 * KB }));
    expect(control.file.value).toBeNull();
    expect(state.text).toBe(page);
    expect(state.original).toBe(page);
    expect(control.storedLarge.value).toBe(true);
  });

  it("超過編輯門檻：只顯示檔案卡，不讀內容", () => {
    const { control } = harness();
    control.adopt(asset({ openingPageBytes: OPENING_PAGE_EDIT_MAX_BYTES + 1, openingPageUrl: "/u" }));
    expect(control.file.value).toMatchObject({ bytes: OPENING_PAGE_EDIT_MAX_BYTES + 1, blob: null, pending: false });
    expect(api.fetchOpeningPage).not.toHaveBeenCalled();
  });

  it("自動讀取失敗：留在檔案卡上並說讀不到", async () => {
    api.fetchOpeningPage.mockRejectedValueOnce(new Error("503"));
    const { state, control } = harness();
    control.adopt(asset({ openingPageBytes: 600 * KB, openingPageUrl: "/u" }));
    await flush();
    expect(control.file.value?.bytes).toBe(600 * KB);
    expect(control.error.value).toBe("errDownload");
    expect(state.text).toBe("");
  });

  it("內嵌的頁面超過編輯門檻（門檻低於 512 KB 時）：移出文字框、保留內容", () => {
    const { state, control } = harness();
    const page = html(OPENING_PAGE_EDIT_MAX_BYTES + 10);
    state.text = state.original = page;
    // 上游只內嵌 512 KB 以下，門檻在 512 KB 以上時這只會發生在自架的上游；照樣不放進文字框
    control.adopt(asset({ openingPage: page }));
    expect(control.file.value?.blob).toBeInstanceOf(Blob);
    expect(state.text).toBe("");
    expect(state.original).toBe("");
  });
});

describe("上傳檔案、貼上、清除", () => {
  it("不是網頁檔或超過上限：原本的內容不動", async () => {
    const { state, control } = harness();
    state.text = "原本";
    expect(await control.pick(new File(["x"], "a.txt", { type: "text/plain" }))).toBe(false);
    expect(control.error.value).toBe("errType");
    setOpeningPageLimitsForTest({ max: 524288 });
    expect(await control.pick(new File([html(600 * KB)], "a.html"))).toBe(false);
    expect(control.error.value).toBe("errTooBig");
    expect(state.text).toBe("原本");
  });

  it("已有內容先確認；不取代就什麼都不變", async () => {
    const { state, control } = harness({ confirmReplace: false });
    state.text = "原本";
    expect(await control.pick(new File(["<p>新</p>"], "a.html"))).toBe(false);
    expect(state.text).toBe("原本");
  });

  it("門檻內的檔案進文字框，門檻外的變成待存檔案", async () => {
    const { state, control } = harness();
    await control.pick(new File(["<p>新</p>"], "a.html"));
    expect(state.text).toBe("<p>新</p>");
    expect(control.file.value).toBeNull();
    expect(control.notice.value).toBe("picked");
    const big = new File([html(OPENING_PAGE_EDIT_MAX_BYTES + 1)], "big.htm");
    await control.pick(big);
    expect(control.file.value).toMatchObject({ bytes: big.size, pending: true });
    expect(state.text).toBe("");
    expect(control.dirty()).toBe(true);
  });

  it("一次貼上超過門檻：整份收成待存檔案", async () => {
    const { state, control } = harness();
    const page = html(OPENING_PAGE_EDIT_MAX_BYTES + 5);
    control.paste(page);
    expect(control.notice.value).toBe("pasted");
    expect(state.text).toBe("");
    expect(await control.file.value!.blob!.text()).toBe(page);
  });

  it("清除要確認；不確認就不動", async () => {
    const kept = harness({ confirmClear: false });
    kept.control.adopt(asset({ openingPageBytes: 5 * MB, openingPageUrl: "/u" }));
    expect(await kept.control.clear()).toBe(false);
    expect(kept.control.file.value).not.toBeNull();
    const { control } = harness();
    control.adopt(asset({ openingPageBytes: 5 * MB, openingPageUrl: "/u" }));
    expect(await control.clear()).toBe(true);
    expect(control.file.value).toBeNull();
    expect(control.cleared.value).toBe(true);
  });

  it("下載：本機有內容直接存成 opening.html；上游的先讀", async () => {
    const { state, control } = harness();
    state.text = "<p>x</p>";
    await control.download();
    expect(downloadBlob).toHaveBeenLastCalledWith(expect.any(Blob), "opening.html");
    control.adopt(asset({ openingPageBytes: 5 * MB, openingPageUrl: "/u" }));
    api.fetchOpeningPage.mockResolvedValueOnce(new Blob(["remote"]));
    await control.download();
    expect(api.fetchOpeningPage).toHaveBeenCalledTimes(1);
    const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
    expect(await (blob as Blob).text()).toBe("remote");
    await control.download();
    expect(api.fetchOpeningPage).toHaveBeenCalledTimes(1);
  });
});

describe("存檔怎麼送", () => {
  it("512 KB 以下照舊放在 JSON；沒改的也照送", async () => {
    const { control } = harness();
    expect(await control.planSave({ text: "<p>a</p>", original: "<p>a</p>", dropPage: false })).toEqual({ upload: null, json: "<p>a</p>", clear: false });
    expect(await control.planSave({ text: "<p>b</p>", original: "<p>a</p>", dropPage: false })).toEqual({ upload: null, json: "<p>b</p>", clear: false });
  });

  it("超過 512 KB 且改過：走原始上傳，JSON 送空字串（不變）", async () => {
    const { control } = harness();
    const page = html(600 * KB);
    const plan = await control.planSave({ text: page, original: "", dropPage: false });
    expect(plan.json).toBe("");
    expect(plan.clear).toBe(false);
    expect(await plan.upload!.text()).toBe(page);
  });

  it("超過 512 KB 但沒改（讀進來的）：不再上傳", async () => {
    const { control } = harness();
    const page = html(600 * KB);
    expect(await control.planSave({ text: page, original: page, dropPage: false })).toEqual({ upload: null, json: "", clear: false });
  });

  it("上游存著大頁面：清空、清除、換成開場白都帶 openingPageClear；舊上游（小頁面）不帶", async () => {
    const { state, control } = harness();
    control.adopt(asset({ openingPageBytes: 5 * MB, openingPageUrl: "/u" }));
    expect(await control.planSave({ text: "", original: "", dropPage: true })).toEqual({ upload: null, json: "", clear: true });
    expect(await control.planSave({ text: "", original: "", dropPage: false })).toEqual({ upload: null, json: "", clear: false });
    await control.clear();
    expect(await control.planSave({ text: state.text, original: "", dropPage: false })).toEqual({ upload: null, json: "", clear: true });
    const small = harness();
    small.state.text = small.state.original = "<p>a</p>";
    small.control.adopt(asset({ openingPage: "<p>a</p>" }));
    expect(await small.control.planSave({ text: "", original: "<p>a</p>", dropPage: false })).toEqual({ upload: null, json: "", clear: false });
  });

  it("待存的大檔案走原始上傳；上游存著、沒動的檔案不送", async () => {
    const { control } = harness();
    control.adopt(asset({ openingPageBytes: 5 * MB, openingPageUrl: "/u" }));
    expect(await control.planSave({ text: "", original: "", dropPage: false })).toEqual({ upload: null, json: "", clear: false });
    const big = new File([html(OPENING_PAGE_EDIT_MAX_BYTES + 1)], "big.html");
    await control.pick(big);
    expect((await control.planSave({ text: "", original: "", dropPage: false })).upload).toBe(big);
  });

  it("上傳成功：檔案不再是待存；失敗：檔案留著、說沒完成；取消：不算失敗", async () => {
    const { control } = harness();
    const big = new File([html(OPENING_PAGE_EDIT_MAX_BYTES + 1)], "big.html");
    await control.pick(big);
    api.uploadOpeningPage.mockRejectedValueOnce(new Error("503"));
    await expect(control.upload("r1", big, 4, "tok")).rejects.toThrow("503");
    expect(control.error.value).toBe("errFail");
    expect(control.file.value?.pending).toBe(true);
    api.uploadOpeningPage.mockImplementationOnce((_r: string, _p: Blob, _v: number, _t: string, opts: { signal: AbortSignal }) =>
      new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const pending = control.upload("r1", big, 4, "tok");
    expect(control.transfer.value?.kind).toBe("upload");
    control.cancel();
    await expect(pending).rejects.toSatisfy(isAbortError);
    expect(control.error.value).toBe("");
    expect(control.file.value?.pending).toBe(true);
    expect(control.transfer.value).toBeNull();
    api.uploadOpeningPage.mockImplementationOnce(async (_r: string, _p: Blob, _v: number, _t: string, opts: { onProgress: (a: number, b: number) => void }) => {
      opts.onProgress(big.size / 2, big.size);
      expect(control.transfer.value).toEqual({ kind: "upload", percent: 50 });
      return asset({ version: 5, openingPageBytes: big.size, openingPageUrl: "/u" });
    });
    const saved = await control.upload("r1", big, 4, "tok");
    expect(saved.version).toBe(5);
    expect(control.file.value).toMatchObject({ pending: false, bytes: big.size });
    expect(control.storedLarge.value).toBe(true);
    expect(control.dirty()).toBe(false);
  });
});
