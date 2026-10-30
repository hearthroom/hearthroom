import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type Component } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n, SOURCE_LOCALE } from "../src/lib/i18n";
import { useSession } from "../src/lib/session";
import { setProvider } from "../src/lib/provider";
import { ApiError } from "../src/lib/api";
import type { PresetLibraryDetail, PresetLibraryItem, PresetSummary } from "../src/lib/presets";
import { isNew } from "../src/components/preset/preset-share";
import PresetListPage from "../src/pages/PresetListPage.vue";
import PresetLibraryPage from "../src/pages/PresetLibraryPage.vue";

const mocks = vi.hoisted(() => ({
  token: vi.fn(), confirm: vi.fn(), models: vi.fn(),
  list: vi.fn(), publish: vi.fn(), unpublish: vi.fn(), library: vi.fn(), shelf: vi.fn(), detail: vi.fn(), favorite: vi.fn(), report: vi.fn(),
}));
vi.mock("../src/lib/connections", () => ({ accountToken: mocks.token }));
vi.mock("../src/lib/confirm", async (original) => ({ ...(await original<typeof import("../src/lib/confirm")>()), confirmDialog: mocks.confirm }));
vi.mock("../src/lib/presets", async (original) => ({
  ...(await original<typeof import("../src/lib/presets")>()),
  listPresets: mocks.list, publishPreset: mocks.publish, unpublishPreset: mocks.unpublish,
  listPresetLibrary: mocks.library, listPresetShelf: mocks.shelf, fetchLibraryPreset: mocks.detail,
  favoritePreset: mocks.favorite, reportPreset: mocks.report, fetchModelOptions: mocks.models,
}));

let app: ReturnType<typeof createApp> | undefined;
let root: HTMLElement;
let router: Router;
afterEach(() => { app?.unmount(); root?.remove(); vi.clearAllMocks(); });

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); await nextTick(); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
/** 彈層 Teleport 到 body，不在 root 裡 */
const body$ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T;
const t = (key: string, values: Record<string, unknown> = {}, n?: number) => (n === undefined ? i18n.global.t(key, values) : i18n.global.t(key, values, n));

async function mount(path: string) {
  setProvider("harbor");
  i18n.global.locale.value = SOURCE_LOCALE;
  mocks.token.mockResolvedValue("tok");
  mocks.confirm.mockResolvedValue(true);
  mocks.models.mockResolvedValue([{ value: "gemini-4", label: "Gemini 4" }, { value: "deepseek-v4", label: "DeepSeek V4" }]);
  const pinia = createPinia(); setActivePinia(pinia);
  const session = useSession();
  session.me = { accountNumId: 7, nickName: "Fixture", avatar: "" };
  session.profile = { identities: [{ provider: "harbor", externalId: 7 }] } as never;
  const stub: Component = { template: "<div />" };
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/me/presets", component: PresetListPage },
    { path: "/preset-library/:presetId", component: PresetLibraryPage },
    { path: "/:p(.*)*", component: stub },
  ] });
  await router.push(path);
  root = document.createElement("div"); document.body.append(root);
  app = createApp({ template: "<RouterView />" }).use(pinia).use(router).use(i18n);
  app.mount(root);
  await flush();
}

const DAY = 24 * 3600 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

const summary = (over: Partial<PresetSummary> = {}): PresetSummary => ({
  id: "p1", title: "細膩第三人稱", headRevisionId: "r2", version: 2, sourceKind: "native", archived: false,
  recommendedModels: ["gemini-4"], createdAt: "2026-10-29T00:00:00Z", updatedAt: "2026-10-29T00:00:00Z", allowedActions: ["delete"], bindingCount: 0,
  visibility: "private", publishedAt: null, attribution: "", removed: false, ...over,
});
const mineList = (items: PresetSummary[]) => ({ items, nextCursor: "", quota: { used: items.length, limit: 50, archived: 0 }, declarationVersion: "preset-publish-2026-10-30" });

const item = (over: Partial<PresetLibraryItem> = {}): PresetLibraryItem => ({
  presetId: "s1", title: "電影感長篇", authorName: "Aster", authorNumId: 12345, authorAvatar: "", attribution: "",
  recommendedModels: ["deepseek-v4"], enabledEntryCount: 3, usesLast7d: 215, publishedAt: iso(30 * DAY), updatedAt: "2026-10-28T00:00:00Z",
  favorited: false, lastAppliedAt: null, listed: true, mine: false, ...over,
});

describe("預設頁的三個分類", () => {
  it("預設是「我的」；切到公開記在網址上，重新整理還在", async () => {
    mocks.list.mockResolvedValue(mineList([summary()]));
    mocks.library.mockResolvedValue({ items: [item()] });
    await mount("/me/presets");
    expect($("[data-testid=preset-tab-mine]").getAttribute("aria-current")).toBe("page");
    expect($("[data-testid=preset-row]")).not.toBeNull();
    $("[data-testid=preset-tab-public]").click();
    await flush();
    expect(router.currentRoute.value.query.tab).toBe("public");
    expect($("[data-testid=share-public]")).not.toBeNull();
    // 只有「我的」有匯入與新增
    expect($("[data-testid=preset-create]")).toBeNull();
    app!.unmount(); root.remove();
    await mount("/me/presets?tab=public");
    expect($("[data-testid=preset-tab-public]").getAttribute("aria-current")).toBe("page");
    expect(mocks.library).toHaveBeenLastCalledWith("tok", { model: "all", q: "", offset: 0 });
  });
});

describe("公開列表", () => {
  it("預設全部；點通用、選模型、搜尋都重新向上游要，條件放在網址上", async () => {
    mocks.library.mockResolvedValue({ items: [item()] });
    await mount("/me/presets?tab=public");
    expect($("[data-testid=share-filter-all]").getAttribute("aria-pressed")).toBe("true");
    $("[data-testid=share-filter-general]").click();
    await flush();
    expect(router.currentRoute.value.query.model).toBe("general");
    expect(mocks.library).toHaveBeenLastCalledWith("tok", { model: "general", q: "", offset: 0 });

    const select = $<HTMLSelectElement>("[data-testid=share-filter-model]");
    expect([...select.options].map((o) => o.textContent)).toEqual([t("preset.share.filter.pickModel"), "Gemini 4", "DeepSeek V4"]);
    select.value = "gemini-4";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(mocks.library).toHaveBeenLastCalledWith("tok", { model: "gemini-4", q: "", offset: 0 });

    const search = $<HTMLInputElement>("[data-testid=share-search]");
    search.value = "Aster";
    search.dispatchEvent(new Event("input"));
    await wait(350);
    await flush();
    expect(router.currentRoute.value.query).toMatchObject({ tab: "public", model: "gemini-4", q: "Aster" });
    expect(mocks.library).toHaveBeenLastCalledWith("tok", { model: "gemini-4", q: "Aster", offset: 0 });
  });

  it("每列有作者、測試過的模型與近 7 天人數；0 人且公開未滿 7 天標新公開", async () => {
    mocks.library.mockResolvedValue({ items: [
      item(),
      item({ presetId: "s2", title: "新來的", usesLast7d: 0, publishedAt: iso(2 * DAY), recommendedModels: [] }),
      item({ presetId: "s3", title: "沒人用", usesLast7d: 0, publishedAt: iso(20 * DAY) }),
    ] });
    await mount("/me/presets?tab=public");
    const rows = $$("[data-testid=share-row]");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Aster");
    expect(rows[0]!.textContent).toContain(t("preset.share.tested", { model: "DeepSeek V4" }));
    expect(rows[0]!.textContent).toContain(t("preset.share.users7d", { n: "215" }, 215));
    expect(rows[1]!.textContent).toContain(t("preset.share.new"));
    expect(rows[1]!.textContent).toContain(t("preset.share.untested"));
    expect(rows[1]!.textContent).not.toContain(t("preset.share.users7d", { n: "0" }, 0));
    expect(rows[2]!.textContent).toContain(t("preset.share.users7d", { n: "0" }, 0));
    expect(rows[2]!.textContent).not.toContain(t("preset.share.new"));
  });

  it("按 ♥ 加入喜愛：按鈕變成選中，toast 一行；自己的預設沒有 ♥", async () => {
    mocks.library.mockResolvedValue({ items: [item(), item({ presetId: "own", mine: true })] });
    mocks.favorite.mockResolvedValue({ favorited: true });
    await mount("/me/presets?tab=public");
    const favs = $$("[data-testid=share-fav]");
    expect(favs).toHaveLength(1);
    expect($$("[data-testid=share-row]")[1]!.textContent).toContain(t("preset.share.tabs.mine"));
    favs[0]!.click();
    await flush();
    expect(mocks.favorite).toHaveBeenCalledWith("tok", "s1", true);
    expect($("[data-testid=share-fav]").getAttribute("aria-pressed")).toBe("true");
    expect($("[data-testid=share-fav]").getAttribute("aria-label")).toBe(t("preset.share.fav.remove"));
    expect($("[data-testid=preset-toast]").textContent).toBe(t("preset.share.fav.added"));
  });

  it("滿一頁才給載入更多，下一頁從已載入的筆數接著要", async () => {
    mocks.library.mockResolvedValueOnce({ items: Array.from({ length: 20 }, (_, i) => item({ presetId: `s${i}` })) }).mockResolvedValueOnce({ items: [item({ presetId: "last" })] });
    await mount("/me/presets?tab=public");
    $("[data-testid=share-more]").click();
    await flush();
    expect(mocks.library).toHaveBeenLastCalledWith("tok", { model: "all", q: "", offset: 20 });
    expect($$("[data-testid=share-row]")).toHaveLength(21);
    expect($("[data-testid=share-more]")).toBeNull();
  });

  it("沒有符合的說明換條件；讀不到的給重新載入", async () => {
    mocks.library.mockResolvedValueOnce({ items: [] });
    await mount("/me/presets?tab=public&q=zzz");
    expect($("[data-testid=share-public-empty]").textContent).toContain(t("preset.share.empty.public"));
    app!.unmount(); root.remove();
    mocks.library.mockRejectedValueOnce(new ApiError(503, "x", "temporarily_unavailable"));
    await mount("/me/presets?tab=public");
    expect($("[role=alert]").textContent).toContain(t("preset.share.error.load"));
  });
});

describe("喜愛與用過", () => {
  it("喜愛在前、最近用過在後；已不公開的標示加說明，照樣列著", async () => {
    mocks.shelf.mockResolvedValue({ items: [
      item({ favorited: true }),
      item({ presetId: "gone", title: "夜讀筆記", favorited: true, listed: false }),
      item({ presetId: "used", title: "靜夜獨白", lastAppliedAt: "2026-10-27T00:00:00Z" }),
    ] });
    await mount("/me/presets?tab=fav");
    const fav = $("[data-testid=share-group-fav]");
    const used = $("[data-testid=share-group-used]");
    expect(fav.querySelectorAll("[data-testid=share-row]")).toHaveLength(2);
    expect(used.textContent).toContain("靜夜獨白");
    const gone = fav.querySelectorAll("[data-testid=share-row]")[1]!;
    expect(gone.querySelector("[data-testid=share-unlisted]")!.textContent).toBe(t("preset.share.unlisted"));
    expect(gone.textContent).toContain(t("preset.share.unlisted.hint"));
    expect(gone.querySelector("a")!.getAttribute("href")).toBe("/preset-library/gone");
  });

  it("取消喜愛那一列不跳走；空的時候帶去逛公開", async () => {
    mocks.shelf.mockResolvedValueOnce({ items: [item({ favorited: true })] });
    mocks.favorite.mockResolvedValue({ favorited: false });
    await mount("/me/presets?tab=fav");
    $("[data-testid=share-fav]").click();
    await flush();
    expect(mocks.favorite).toHaveBeenCalledWith("tok", "s1", false);
    expect($("[data-testid=share-group-fav]").querySelectorAll("[data-testid=share-row]")).toHaveLength(1);
    app!.unmount(); root.remove();

    mocks.shelf.mockResolvedValueOnce({ items: [] });
    mocks.library.mockResolvedValue({ items: [] });
    await mount("/me/presets?tab=fav");
    expect($("[data-testid=share-shelf-empty]").textContent).toContain(t("preset.share.empty.fav.title"));
    $("[data-testid=share-browse]").click();
    await flush();
    expect(router.currentRoute.value.query.tab).toBe("public");
  });
});

describe("我的：公開與改回私人", () => {
  async function openMenu() {
    $("[data-testid=preset-more]").click();
    await flush();
  }

  it("已公開的列有標示；選單改回私人不另外確認，完成後 toast 一行", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ visibility: "public", publishedAt: "2026-10-30T00:00:00Z" })]));
    mocks.unpublish.mockResolvedValue({ presetId: "p1", revisionId: "r2", version: 3 });
    await mount("/me/presets");
    expect($("[data-testid=preset-public]").textContent).toBe(t("preset.share.chip.public"));
    await openMenu();
    expect($("[data-testid=preset-publish]")).toBeNull();
    $("[data-testid=preset-unpublish]").click();
    await flush();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.unpublish).toHaveBeenCalledWith("tok", "p1", 2, expect.any(String));
    expect($("[data-testid=preset-toast]").textContent).toBe(t("preset.share.unpublished.toast"));
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("被平台下架的標已下架加一行說明，公開不能按", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ removed: true, visibility: "public" })]));
    await mount("/me/presets");
    expect($("[data-testid=preset-taken-down]").textContent).toBe(t("preset.share.chip.takenDown"));
    expect($("[data-testid=preset-public]")).toBeNull();
    expect($("[data-testid=preset-row]").textContent).toContain(t("preset.share.takenDown.note"));
    await openMenu();
    expect($("[data-testid=preset-unpublish]")).toBeNull();
    expect($<HTMLButtonElement>("[data-testid=preset-publish]").disabled).toBe(true);
  });

  it("公開彈層：聲明句貼著公開鈕、連到服務條款；沒有取消鈕；送出帶目前的聲明版本", async () => {
    mocks.list.mockResolvedValue(mineList([summary()]));
    mocks.publish.mockResolvedValue({ presetId: "p1", revisionId: "r2", version: 2 });
    await mount("/me/presets");
    await openMenu();
    $("[data-testid=preset-publish]").click();
    await flush();
    const sheet = body$("[data-testid=publish-sheet]");
    expect(sheet.querySelector("h2")!.textContent).toBe(t("preset.share.publish.title", { name: "細膩第三人稱" }));
    const decl = sheet.querySelector("[data-testid=publish-declaration]")!;
    expect(decl.previousElementSibling).toBe(sheet.querySelector("[data-testid=publish-confirm]"));
    const link = decl.querySelector("a")!;
    expect(link.textContent).toBe(t("login.terms"));
    expect(link.getAttribute("href")).toBe("https://www.harperharbor.com/zh-Hant/legal/terms/");
    expect(decl.textContent).toBe(t("preset.publish.declaration", { terms: t("login.terms") }));
    expect([...sheet.querySelectorAll("button")].map((b) => b.textContent?.trim())).not.toContain(t("dialog.cancel"));
    // 原本標的模型帶進來；來源選填
    expect([...sheet.querySelectorAll("[data-testid=publish-model]")].map((b) => b.textContent?.trim())).toEqual(["Gemini 4"]);
    const source = sheet.querySelector<HTMLInputElement>("[data-testid=publish-source]")!;
    source.value = "  原作者 A  ";
    source.dispatchEvent(new Event("input"));
    sheet.querySelector<HTMLButtonElement>("[data-testid=publish-confirm]")!.click();
    await flush();
    // 模型沒動就不送，免得無謂地加一個版本
    expect(mocks.publish).toHaveBeenCalledWith("tok", "p1", { expectedVersion: 2, declaration: "preset-publish-2026-10-30", attribution: "原作者 A" }, expect.any(String));
    expect(body$("[data-testid=publish-sheet]")).toBeNull();
    expect($("[data-testid=preset-toast]").textContent).toBe(t("preset.share.published.toast", { name: "細膩第三人稱" }));
  });

  it("改了測試過的模型才送；留空就是通用", async () => {
    mocks.list.mockResolvedValue(mineList([summary()]));
    mocks.publish.mockResolvedValue({ presetId: "p1", revisionId: "r3", version: 3 });
    await mount("/me/presets");
    await openMenu();
    $("[data-testid=preset-publish]").click();
    await flush();
    body$<HTMLButtonElement>("[data-testid=publish-model]").click();
    await flush();
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click();
    await flush();
    expect(mocks.publish.mock.calls[0]![2]).toMatchObject({ recommendedModels: [] });
  });

  it("聲明換版：留在彈層說明，清單重讀拿新版本", async () => {
    mocks.list.mockResolvedValue(mineList([summary()]));
    mocks.publish.mockRejectedValue(new ApiError(409, "x", "preset_conflict", undefined, "preset_declaration_changed"));
    await mount("/me/presets");
    await openMenu();
    $("[data-testid=preset-publish]").click();
    await flush();
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click();
    await flush();
    expect(body$("[data-testid=publish-error]").textContent).toBe(t("preset.share.error.declarationChanged"));
    expect(mocks.list).toHaveBeenCalledTimes(2);
    body$<HTMLButtonElement>("[data-testid=sheet-close]").click();
    await flush();
    expect(body$("[data-testid=publish-sheet]")).toBeNull();
  });
});

describe("公開預設詳情", () => {
  const detail = (over: Partial<PresetLibraryDetail> = {}, it: Partial<PresetLibraryItem> = {}): PresetLibraryDetail => ({
    item: item(it),
    revision: {
      revisionId: "r1", presetId: "s1", version: 1, sourceKind: "native", compilerVersion: "x", contentHash: "h", recommendedModels: [], createdAt: "",
      document: {
        schemaVersion: "hearthroom.st-preset.v1",
        st: {
          prompts: [
            { identifier: "a", name: "主敘事規則", role: "system", content: "用鏡頭的方式寫場景。" },
            { identifier: "b", name: "文風細節", role: "system", content: "b" },
            { identifier: "off", name: "關掉的", role: "system", content: "off" },
            { identifier: "chatHistory", name: "Chat History", marker: true },
            { identifier: "c", name: "對話格式", role: "user", content: "c" },
            { identifier: "d", name: "收尾", role: "system", content: "d" },
            { identifier: "e", name: "多的一條", role: "system", content: "e" },
          ],
          prompt_order: [{ character_id: 100001, order: [
            { identifier: "a", enabled: true }, { identifier: "b", enabled: true }, { identifier: "off", enabled: false },
            { identifier: "chatHistory", enabled: true }, { identifier: "c", enabled: true }, { identifier: "d", enabled: true }, { identifier: "e", enabled: true },
          ] }],
        },
        selection: { profileId: 100001, excludedEntryIds: [], acceptedAdaptationIds: [], excludedFields: [] },
      },
    },
    compatibility: { compilerVersion: "x", reviewRequired: false, fields: [], entries: [] },
    parameters: { temperature: 0.9, top_p: 0.95 },
    reportedByMe: false,
    ...over,
  });

  it("唯讀內容：啟用的條目、取樣參數、測試過的模型與作者；沒有套用鈕，只有一行說明", async () => {
    mocks.detail.mockResolvedValue(detail({}, { enabledEntryCount: 5, attribution: "原作者 A" }));
    await mount("/preset-library/s1");
    expect(mocks.detail).toHaveBeenCalledWith("tok", "s1");
    expect($("[data-testid=shared-title]").textContent).toBe("電影感長篇");
    expect(root.textContent).toContain("Aster");
    expect($("[data-testid=shared-summary]").textContent).toBe(`${t("preset.share.detail.summary", { n: "5" }, 5)} · Temperature 0.9 · Top P 0.95`);
    // 只列會執行的：關掉的與歷史那格不列；先顯示四條
    expect($$("[data-testid=shared-entry]").map((e) => e.querySelector(".shared__entryName")!.textContent)).toEqual(["主敘事規則", "文風細節", "對話格式", "收尾"]);
    $("[data-testid=shared-more]").click();
    await flush();
    expect($$("[data-testid=shared-entry]")).toHaveLength(5);
    expect(root.textContent).toContain("DeepSeek V4");
    expect(root.textContent).toContain("原作者 A");
    expect($("[data-testid=shared-apply]").textContent).toBe(t("preset.share.detail.apply"));
    expect($("[data-testid=shared-fav]").classList.contains("btn--primary")).toBe(true);
    expect(root.textContent).not.toMatch(/匯出|另存/);
  });

  it("檢舉：選原因、補充選填，送出後頁面一直標你已檢舉", async () => {
    mocks.detail.mockResolvedValue(detail());
    mocks.report.mockResolvedValue({ reported: true });
    await mount("/preset-library/s1");
    $("[data-testid=shared-report]").click();
    await flush();
    const sheet = body$("[data-testid=report-sheet]");
    expect(sheet.querySelector<HTMLButtonElement>("[data-testid=report-submit]")!.disabled).toBe(true);
    sheet.querySelector<HTMLInputElement>("[data-testid=report-reason-copyright]")!.click();
    const detailBox = sheet.querySelector<HTMLTextAreaElement>("[data-testid=report-detail]")!;
    expect(detailBox.maxLength).toBe(500);
    detailBox.value = "抄了別人的";
    detailBox.dispatchEvent(new Event("input"));
    await flush();
    sheet.querySelector<HTMLButtonElement>("[data-testid=report-submit]")!.click();
    await flush();
    expect(mocks.report).toHaveBeenCalledWith("tok", "s1", "copyright", "抄了別人的");
    expect(body$("[data-testid=report-done]").textContent).toBe(t("preset.share.report.done.body"));
    expect($("[data-testid=shared-reported]").textContent).toContain(t("preset.share.report.reported"));
    expect($("[data-testid=shared-report]")).toBeNull();
  });

  it("之前檢舉過的一打開就標你已檢舉；自己的預設不給喜愛與檢舉", async () => {
    mocks.detail.mockResolvedValueOnce(detail({ reportedByMe: true }));
    await mount("/preset-library/s1");
    expect($("[data-testid=shared-reported]")).not.toBeNull();
    expect($("[data-testid=shared-report]")).toBeNull();
    app!.unmount(); root.remove();
    mocks.detail.mockResolvedValueOnce(detail({}, { mine: true }));
    await mount("/preset-library/s1");
    expect($("[data-testid=shared-fav]")).toBeNull();
    expect($("[data-testid=shared-report]")).toBeNull();
  });

  it("已不公開的標示加說明；看不到的說找不到", async () => {
    mocks.detail.mockResolvedValueOnce(detail({}, { listed: false, favorited: true }));
    await mount("/preset-library/s1");
    expect($("[data-testid=shared-unlisted]").textContent).toContain(t("preset.share.unlisted.hint"));
    expect($("[data-testid=shared-fav]").getAttribute("aria-pressed")).toBe("true");
    app!.unmount(); root.remove();
    mocks.detail.mockRejectedValueOnce(new ApiError(404, "x", "not_found"));
    await mount("/preset-library/zzz");
    expect($("[data-testid=shared-not-found]")).not.toBeNull();
  });
});

describe("新公開的判定", () => {
  it("只有 0 人而且公開未滿 7 天才算", () => {
    const now = Date.parse("2026-10-30T00:00:00Z");
    expect(isNew({ usesLast7d: 0, publishedAt: "2026-10-25T00:00:00Z" }, now)).toBe(true);
    expect(isNew({ usesLast7d: 0, publishedAt: "2026-10-20T00:00:00Z" }, now)).toBe(false);
    expect(isNew({ usesLast7d: 3, publishedAt: "2026-10-29T00:00:00Z" }, now)).toBe(false);
    expect(isNew({ usesLast7d: 0, publishedAt: null }, now)).toBe(false);
  });
});

describe("分享的上游請求", () => {
  it("公開列表：全部不帶 model，搜尋去頭尾空白；檢舉沒有補充就不帶 detail", async () => {
    const real = await vi.importActual<typeof import("../src/lib/presets")>("../src/lib/presets");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await real.listPresetLibrary("tok", { model: "all", q: "  夜  ", offset: 20 });
      const url = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(url.pathname).toBe("/open/v1/preset-library");
      expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "20", offset: "20", q: "夜" });

      fetchMock.mockResolvedValue(new Response(JSON.stringify({ reported: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
      await real.reportPreset("tok", "s1", "spam", "");
      const [reportUrl, init] = fetchMock.mock.calls[1]! as [string, RequestInit];
      expect(new URL(reportUrl).pathname).toBe("/open/v1/preset-library/s1/report");
      expect(JSON.parse(String(init.body))).toEqual({ reason: "spam" });

      fetchMock.mockResolvedValue(new Response(JSON.stringify({ presetId: "p1", revisionId: "r", version: 2 }), { status: 200, headers: { "Content-Type": "application/json" } }));
      await real.publishPreset("tok", "p1", { expectedVersion: 2, declaration: "d1", attribution: "" }, "k1");
      const [publishUrl, publishInit] = fetchMock.mock.calls[2]! as [string, RequestInit];
      expect(new URL(publishUrl).pathname).toBe("/open/v1/presets/p1/publish");
      expect((publishInit.headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
