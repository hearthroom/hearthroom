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
import PresetLibraryHomePage from "../src/pages/PresetLibraryHomePage.vue";

const mocks = vi.hoisted(() => ({
  token: vi.fn(), confirm: vi.fn(), models: vi.fn(),
  list: vi.fn(), publish: vi.fn(), unpublish: vi.fn(), library: vi.fn(), shelf: vi.fn(), detail: vi.fn(), favorite: vi.fn(), report: vi.fn(),
  hot: vi.fn(), binding: vi.fn(), apply: vi.fn(), conversations: vi.fn(),
}));
vi.mock("../src/lib/library", async (original) => ({ ...(await original<typeof import("../src/lib/library")>()), fetchConversations: mocks.conversations }));
vi.mock("../src/lib/connections", () => ({ accountToken: mocks.token }));
vi.mock("../src/lib/confirm", async (original) => ({ ...(await original<typeof import("../src/lib/confirm")>()), confirmDialog: mocks.confirm }));
vi.mock("../src/lib/presets", async (original) => ({
  ...(await original<typeof import("../src/lib/presets")>()),
  listPresets: mocks.list, publishPreset: mocks.publish, unpublishPreset: mocks.unpublish,
  listPresetLibrary: mocks.library, listPresetShelf: mocks.shelf, fetchLibraryPreset: mocks.detail,
  favoritePreset: mocks.favorite, reportPreset: mocks.report, fetchModelCatalog: mocks.models,
  listPresetLibraryHot: mocks.hot, fetchCardPreset: mocks.binding, applyPresetToCard: mocks.apply,
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
  mocks.models.mockResolvedValue([{ group: "Gemini", families: ["Gemini 4"] }, { group: "DeepSeek", families: ["DeepSeek V4"] }]);
  if (!mocks.hot.getMockImplementation()) mocks.hot.mockResolvedValue({ items: [] });
  if (!mocks.library.getMockImplementation()) mocks.library.mockResolvedValue({ items: [] });
  const pinia = createPinia(); setActivePinia(pinia);
  const session = useSession();
  session.me = { accountNumId: 7, nickName: "Fixture", avatar: "" };
  session.profile = { identities: [{ provider: "harbor", externalId: 7 }] } as never;
  vi.spyOn(session, "accessToken").mockResolvedValue("site-tok");
  const stub: Component = { template: "<div />" };
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/me/presets", component: PresetListPage },
    { path: "/presets/library", component: PresetLibraryHomePage },
    { path: "/presets/:presetId", component: PresetLibraryPage },
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
  recommendedModels: ["model:Gemini 4"], createdAt: "2026-10-29T00:00:00Z", updatedAt: "2026-10-29T00:00:00Z", allowedActions: ["delete"], bindingCount: 0,
  visibility: "private", publishedAt: null, attribution: "", removed: false, ...over,
});
const mineList = (items: PresetSummary[]) => ({ items, nextCursor: "", quota: { used: items.length, limit: 50, archived: 0 }, declarationVersion: "preset-publish-2026-10-30" });

const item = (over: Partial<PresetLibraryItem> = {}): PresetLibraryItem => ({
  presetId: "s1", title: "電影感長篇", authorName: "Aster", authorNumId: 12345, authorAvatar: "", attribution: "",
  recommendedModels: ["model:DeepSeek V4"], enabledEntryCount: 3, usesLast7d: 215, publishedAt: iso(30 * DAY), updatedAt: "2026-10-28T00:00:00Z",
  favorited: false, lastAppliedAt: null, listed: true, mine: false, ...over,
});

describe("預設頁的三個分類", () => {
  it("我的｜喜愛與用過｜預設庫：前兩格是這一頁的分頁，預設庫是自己的一頁", async () => {
    mocks.list.mockResolvedValue(mineList([summary()]));
    mocks.library.mockResolvedValue({ items: [item()] });
    await mount("/me/presets");
    expect($("[data-testid=preset-tab-mine]").getAttribute("aria-current")).toBe("page");
    expect($("[data-testid=preset-row]")).not.toBeNull();
    expect($("[data-testid=preset-tab-library]").textContent?.trim()).toBe(t("preset.share.tabs.public"));
    $("[data-testid=preset-tab-library]").click();
    await flush();
    expect(router.currentRoute.value.path).toBe("/presets/library");
    expect($("[data-testid=library-list]")).not.toBeNull();
    expect($("[data-testid=preset-tab-library]").getAttribute("aria-current")).toBe("page");
    // 管理動作只在「我的」
    expect($("[data-testid=preset-create]")).toBeNull();
  });

  it("舊的「公開」分頁連結轉到預設庫，篩選一起帶過去", async () => {
    mocks.list.mockResolvedValue(mineList([summary()]));
    await mount("/me/presets?tab=public&model=general");
    expect(router.currentRoute.value.fullPath).toBe("/presets/library?model=general");
    expect(mocks.library).toHaveBeenLastCalledWith("tok", { model: "general", q: "", sort: "hot", offset: 0 });
  });

  it("舊的詳情網址 /preset-library/:id 轉到 /presets/:id", async () => {
    const { router: appRouter } = await import("../src/router");
    const record = appRouter.getRoutes().find((r) => r.path.endsWith("/preset-library/:presetId"))!;
    const redirect = record.redirect as (to: unknown) => { path: string };
    expect(redirect({ params: { presetId: "abc" }, query: {}, hash: "", path: "/preset-library/abc" }).path).toBe("/presets/abc");
    expect(redirect({ params: { presetId: "abc", locale: "en" }, query: {}, hash: "", path: "/en/preset-library/abc" }).path).toBe("/en/presets/abc");
  });
});

describe("預設庫首頁：熱門", () => {
  it("熱門區依篩選讀上游；補滿用的最新公開標新公開，其餘寫使用人數與喜愛數", async () => {
    mocks.hot.mockResolvedValue({ items: [item({ usesLast7d: 342, favoriteCount: 58 }), item({ presetId: "s9", title: "古風章回", usesLast7d: 0, favoriteCount: 0, fresh: true })] });
    await mount("/presets/library");
    expect(mocks.hot).toHaveBeenLastCalledWith("tok", "all");
    const cards = $$("[data-testid=library-hot-card]");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain(t("preset.share.hot.stats", { n: "342", m: "58" }));
    expect(cards[1]!.querySelector("[data-testid=library-fresh]")!.textContent).toBe(t("preset.share.new"));
    expect(cards[1]!.getAttribute("href")).toBe("/presets/s9");
    $("[data-testid=share-filter-general]").click();
    await flush();
    expect(mocks.hot).toHaveBeenLastCalledWith("tok", "general");
  });

  it("沒有熱門就不出這一區；全部預設可切最新，排序記在網址上", async () => {
    mocks.hot.mockResolvedValue({ items: [] });
    mocks.library.mockResolvedValue({ items: [item()] });
    await mount("/presets/library");
    expect($("[data-testid=library-hot]")).toBeNull();
    $("[data-testid=library-sort-new]").click();
    await flush();
    expect(router.currentRoute.value.query.sort).toBe("new");
    expect(mocks.library).toHaveBeenLastCalledWith("tok", { model: "all", q: "", sort: "new", offset: 0 });
    // 換排序不重抓熱門
    expect(mocks.hot).toHaveBeenCalledTimes(1);
  });
});

describe("預設庫首頁：全部預設", () => {
  it("預設全部；點通用、選模型、搜尋都重新向上游要，條件放在網址上", async () => {
    mocks.library.mockResolvedValue({ items: [item()] });
    await mount("/presets/library");
    expect($("[data-testid=share-filter-all]").getAttribute("aria-pressed")).toBe("true");
    $("[data-testid=share-filter-general]").click();
    await flush();
    expect(router.currentRoute.value.query.model).toBe("general");
    expect(mocks.library).toHaveBeenLastCalledWith("tok", { model: "general", q: "", sort: "hot", offset: 0 });

    // 網頁沒有目前的模型：選單（跟編輯器同一個）只列系列與模型兩層，單選；值照原字送 model=
    const pick = $<HTMLInputElement>("#share-filter-model");
    pick.focus(); pick.dispatchEvent(new Event("focus")); await flush();
    // 清單掛在 body 上（選單在彈層裡也不會被裁掉），不在頁面元件裡
    const options = () => [...document.body.querySelectorAll<HTMLElement>("[role=option]")];
    expect(options().map((o) => o.textContent?.trim())).toEqual([
      `Gemini ${t("preset.models.seriesAll")}`, "Gemini 4", `DeepSeek ${t("preset.models.seriesAll")}`, "DeepSeek V4",
    ]);
    options()[1]!.click(); await flush();
    expect(router.currentRoute.value.query.model).toBe("model:Gemini 4");
    expect(mocks.library).toHaveBeenLastCalledWith("tok", { model: "model:Gemini 4", q: "", sort: "hot", offset: 0 });
    // 單選：選到的值在框裡，不在框上方另起一列標籤
    expect(pick.value).toBe("Gemini 4");
    expect($("[data-testid=model-chip]")).toBeNull();

    const search = $<HTMLInputElement>("[data-testid=share-search]");
    search.value = "Aster";
    search.dispatchEvent(new Event("input"));
    await wait(350);
    await flush();
    expect(router.currentRoute.value.query).toMatchObject({ model: "model:Gemini 4", q: "Aster" });
    expect(mocks.library).toHaveBeenLastCalledWith("tok", { model: "model:Gemini 4", q: "Aster", sort: "hot", offset: 0 });
    // 選整個系列送 series:；拿掉選的值就回到全部
    pick.focus(); pick.dispatchEvent(new Event("focus")); await flush();
    options().find((o) => o.textContent?.includes("DeepSeek") && o.textContent.includes(t("preset.models.seriesAll")))!.click(); await flush();
    expect(mocks.library).toHaveBeenLastCalledWith("tok", { model: "series:DeepSeek", q: "Aster", sort: "hot", offset: 0 });
    expect(pick.value).toBe(t("preset.models.series", { name: "DeepSeek" }));
    $<HTMLButtonElement>("[data-testid=model-pick-clear]").click(); await flush();
    expect(router.currentRoute.value.query.model).toBeUndefined();
    expect($("[data-testid=share-filter-all]").getAttribute("aria-pressed")).toBe("true");
  });

  it("每列有作者、測試過的模型與近 7 天人數；0 人且公開未滿 7 天標新公開", async () => {
    mocks.library.mockResolvedValue({ items: [
      item(),
      item({ presetId: "s2", title: "新來的", usesLast7d: 0, publishedAt: iso(2 * DAY), recommendedModels: [] }),
      item({ presetId: "s3", title: "沒人用", usesLast7d: 0, publishedAt: iso(20 * DAY) }),
    ] });
    await mount("/presets/library");
    const rows = $$("[data-testid=share-row]");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Aster");
    expect(rows[0]!.textContent).toContain(t("preset.share.tested", { model: "DeepSeek V4" }));
    expect(rows[0]!.textContent).not.toContain("model:");
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
    await mount("/presets/library");
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
    await mount("/presets/library");
    $("[data-testid=share-more]").click();
    await flush();
    expect(mocks.library).toHaveBeenLastCalledWith("tok", { model: "all", q: "", sort: "hot", offset: 20 });
    expect($$("[data-testid=share-row]")).toHaveLength(21);
    expect($("[data-testid=share-more]")).toBeNull();
  });

  it("沒有符合的說明換條件；讀不到的給重新載入", async () => {
    mocks.library.mockResolvedValueOnce({ items: [] });
    await mount("/presets/library?q=zzz");
    expect($("[data-testid=share-public-empty]").textContent).toContain(t("preset.share.empty.public"));
    app!.unmount(); root.remove();
    mocks.library.mockRejectedValueOnce(new ApiError(503, "x", "temporarily_unavailable"));
    await mount("/presets/library");
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
    // 列表上只留標示加一句短的，長說明在詳情頁
    expect(gone.textContent).toContain(t("preset.share.unlisted.short"));
    expect(gone.textContent).not.toContain(t("preset.share.unlisted.hint"));
    expect(gone.querySelector("a")!.getAttribute("href")).toBe("/presets/gone");
  });

  it("已不公開的取消喜愛會找不回來：先確認；不取消就什麼都不送，確認了就從清單拿掉", async () => {
    mocks.shelf.mockResolvedValue({ items: [item({ presetId: "gone", title: "夜讀筆記", favorited: true, listed: false }), item({ favorited: true })] });
    mocks.favorite.mockResolvedValue({ favorited: false });
    await mount("/me/presets?tab=fav");
    mocks.confirm.mockResolvedValueOnce(false);
    $$("[data-testid=share-fav]")[0]!.click();
    await flush();
    expect(mocks.confirm.mock.calls[0]![0]).toMatchObject({
      title: t("preset.share.unfavorite.title", { name: "夜讀筆記" }), message: t("preset.share.unfavorite.body"),
      confirmText: t("preset.share.unfavorite.confirm"), cancelText: t("preset.share.unfavorite.keep"), danger: true, dangerAppearance: "subdued", focusCancel: true,
    });
    expect(mocks.favorite).not.toHaveBeenCalled();
    mocks.confirm.mockResolvedValueOnce(true);
    $$("[data-testid=share-fav]")[0]!.click();
    await flush();
    expect(mocks.favorite).toHaveBeenCalledWith("tok", "gone", false);
    expect($$("[data-testid=share-row]").map((r) => r.querySelector("strong")!.textContent)).toEqual(["電影感長篇"]);
    // 還公開的不用確認
    $("[data-testid=share-fav]").click();
    await flush();
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
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
    expect(router.currentRoute.value.path).toBe("/presets/library");
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

  it("被平台下架的標已下架（狀態色）加一行說明；仍能改回私人，私人的公開不能按", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ removed: true, visibility: "public" }), summary({ id: "p2", removed: true, visibility: "private" })]));
    await mount("/me/presets");
    const [publicRow, privateRow] = $$("[data-testid=preset-row]");
    expect(publicRow!.querySelector("[data-testid=preset-taken-down]")!.textContent).toBe(t("preset.share.chip.takenDown"));
    expect(publicRow!.querySelector("[data-testid=preset-taken-down]")!.classList.contains("presets__chip--down")).toBe(true);
    expect($("[data-testid=preset-public]")).toBeNull();
    expect(publicRow!.textContent).toContain(t("preset.share.takenDown.note"));
    // 作者要能在平台恢復前就先改回私人，恢復後才不會又回到公開
    publicRow!.querySelector<HTMLElement>("[data-testid=preset-more]")!.click();
    await flush();
    expect($("[data-testid=preset-unpublish]")).not.toBeNull();
    expect($("[data-testid=preset-publish]")).toBeNull();
    privateRow!.querySelector<HTMLElement>("[data-testid=preset-more]")!.click();
    await flush();
    expect($("[data-testid=preset-unpublish]")).toBeNull();
    expect($<HTMLButtonElement>("[data-testid=preset-publish]").disabled).toBe(true);
  });

  it("封存的預設不標已公開，也不給改回私人或公開", async () => {
    mocks.list.mockResolvedValue({ ...mineList([summary({ archived: true, visibility: "public" })]), quota: { used: 1, limit: 50, archived: 1 } });
    await mount("/me/presets");
    $<HTMLInputElement>("[data-testid=preset-show-archived]").click();
    await flush();
    expect($("[data-testid=preset-public]")).toBeNull();
    await openMenu();
    expect($("[data-testid=preset-unpublish]")).toBeNull();
    expect($("[data-testid=preset-publish]")).toBeNull();
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
    expect([...sheet.querySelectorAll("[data-testid=model-chip]")].map((b) => b.textContent?.trim())).toEqual(["Gemini 4"]);
    // 還沒加的：選單框裡是提示字，不是一個看起來已選的選項
    const add = sheet.querySelector<HTMLInputElement>("#publish-models")!;
    expect(add.value).toBe("");
    expect(add.placeholder).toBe(t("preset.models.placeholder"));
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
    body$<HTMLButtonElement>("[data-testid=model-chip] button").click();
    await flush();
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click();
    await flush();
    expect(mocks.publish.mock.calls[0]![2]).toMatchObject({ recommendedModels: [] });
  });

  it("公開彈層加測試過的模型：選系列存 series:，選模型存 model:", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ recommendedModels: [] })]));
    mocks.publish.mockResolvedValue({ presetId: "p1", revisionId: "r3", version: 3 });
    await mount("/me/presets");
    await openMenu();
    $("[data-testid=preset-publish]").click();
    await flush();
    const input = body$<HTMLInputElement>("#publish-models");
    input.focus(); input.dispatchEvent(new Event("focus")); await flush();
    const options = () => [...document.body.querySelectorAll<HTMLElement>("[role=option]")];
    options().find((o) => o.textContent?.includes("Gemini") && o.textContent.includes(t("preset.models.seriesAll")))!.click(); await flush();
    options().find((o) => o.textContent?.trim() === "DeepSeek V4")!.click(); await flush();
    expect([...document.body.querySelectorAll("[data-testid=model-chip]")].map((c) => c.textContent?.trim())).toEqual([t("preset.models.series", { name: "Gemini" }), "DeepSeek V4"]);
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click();
    await flush();
    expect(mocks.publish.mock.calls[0]![2]).toMatchObject({ recommendedModels: ["series:Gemini", "model:DeepSeek V4"] });
  });

  it("版本衝突用公開自己的說法，不用編輯器存檔那句", async () => {
    mocks.list.mockResolvedValue(mineList([summary()]));
    mocks.publish.mockRejectedValue(new ApiError(409, "x", "preset_conflict", undefined, "preset_revision_conflict"));
    await mount("/me/presets");
    await openMenu();
    $("[data-testid=preset-publish]").click();
    await flush();
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click();
    await flush();
    expect(body$("[data-testid=publish-error]").textContent).toBe(t("preset.share.error.conflict"));
    expect(body$("[data-testid=publish-error]").textContent).not.toBe(t("preset.error.revisionConflict"));
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

  it("唯讀內容：啟用的條目全部列出、取樣參數、測試過的模型與作者；主行動是套用到某張卡", async () => {
    // 上游的 enabledEntryCount 連綺夢社提供的格也算；畫面上的數字要跟列出來的條目一致
    mocks.detail.mockResolvedValue(detail({}, { enabledEntryCount: 9, attribution: "原作者 A" }));
    await mount("/presets/s1");
    expect(mocks.detail).toHaveBeenCalledWith("tok", "s1");
    expect($("[data-testid=shared-title]").textContent).toBe("電影感長篇");
    expect(root.textContent).toContain("Aster");
    expect($("[data-testid=shared-summary]").textContent).toBe(`${t("preset.share.detail.summary", { n: "5" }, 5)} · Temperature 0.9 · Top P 0.95`);
    // 只列會執行的：關掉的與歷史那格不列；原型拿掉了「看其餘」，全部列出
    expect($$("[data-testid=shared-entry]").map((e) => e.querySelector(".shared__entryName")!.textContent)).toEqual(["主敘事規則", "文風細節", "對話格式", "收尾", "多的一條"]);
    expect($$("[data-testid=shared-entry] .shared__chevron")).toHaveLength(5);
    expect(root.textContent).toContain("DeepSeek V4");
    expect(root.textContent).not.toContain("model:");
    expect(root.textContent).toContain("原作者 A");
    expect($("[data-testid=shared-apply]").textContent?.trim()).toBe(t("preset.share.detail.applyAction"));
    expect($("[data-testid=shared-apply]").classList.contains("btn--primary")).toBe(true);
    expect($("[data-testid=shared-fav]").classList.contains("btn--primary")).toBe(false);
    expect($("[data-testid=shared-back]").getAttribute("href")).toBe("/presets/library");
    // 檢舉是無框的次要鈕，不跟喜愛同權重
    expect($("[data-testid=shared-report]").classList.contains("btn--ghost")).toBe(true);
    expect(root.textContent).not.toMatch(/匯出|另存/);
  });

  it("檢舉：選原因、補充選填，送出後頁面一直標你已檢舉", async () => {
    mocks.detail.mockResolvedValue(detail());
    mocks.report.mockResolvedValue({ reported: true });
    await mount("/presets/s1");
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

  it("複製連結：複製這一頁的網址，toast 一行", async () => {
    mocks.detail.mockResolvedValue(detail());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await mount("/presets/s1");
    $("[data-testid=shared-copy]").click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/presets/s1`);
    expect($("[data-testid=shared-toast]").textContent).toBe(t("preset.share.detail.linkCopied"));
  });

  describe("套用到某張卡", () => {
    const conv = (roleId: string, roleName: string) => ({ provider: "harbor", conversationId: `c-${roleId}`, conversationRoleId: roleId, conversationTitle: null, roleName, roleAvatar: "" });
    async function open() {
      mocks.detail.mockResolvedValue(detail());
      mocks.conversations.mockResolvedValue({ conversations: [conv("r1", "QA 探針"), conv("r2", "白露的書店"), conv("r1", "QA 探針")], hasNextPage: false });
      mocks.binding.mockImplementation(async (_tk: string, roleId: string) => roleId === "r1"
        ? { mode: "preset", presetId: "x", presetTitle: "細膩第三人稱", bindingVersion: 3 }
        : { mode: "card_default", presetId: null, bindingVersion: 0 });
      await mount("/presets/s1");
      $("[data-testid=shared-apply]").click();
      await flush();
    }
    const rows = () => [...document.body.querySelectorAll<HTMLElement>("[data-testid=card-pick-row]")];

    it("列我玩過的卡（同一張只列一次）與它目前的預設；選了才能套用，套用後 toast", async () => {
      await open();
      const sheet = body$("[data-testid=card-pick-sheet]");
      expect(sheet.querySelector("h2")!.textContent).toBe(t("preset.share.cardPick.title", { name: "電影感長篇" }));
      expect(mocks.conversations).toHaveBeenCalledWith("site-tok", expect.any(String), 1);
      expect(rows().map((r) => [r.querySelector(".pick__name")!.textContent, r.querySelector(".pick__using")!.textContent])).toEqual([
        ["QA 探針", t("preset.share.cardPick.row.using", { name: "細膩第三人稱" })],
        ["白露的書店", t("preset.share.cardPick.row.none")],
      ]);
      expect(body$<HTMLButtonElement>("[data-testid=card-pick-apply]").disabled).toBe(true);
      // 已有預設的卡說會換掉；沒有預設的卡用另一句
      rows()[1]!.click(); await flush();
      expect(body$("[data-testid=card-pick-note]").textContent).toBe(t("preset.share.cardPick.note.fresh"));
      rows()[0]!.click(); await flush();
      expect(body$("[data-testid=card-pick-note]").textContent).toBe(t("preset.share.cardPick.note.replace"));
      expect(body$("[data-testid=card-pick-apply]").textContent?.trim()).toBe(t("preset.share.cardPick.apply", { card: "QA 探針" }));
      mocks.apply.mockResolvedValue({ mode: "preset", presetId: "s1", bindingVersion: 4 });
      body$<HTMLButtonElement>("[data-testid=card-pick-apply]").click();
      await flush();
      expect(mocks.apply).toHaveBeenCalledWith("tok", { roleId: "r1", presetId: "s1", expectedVersion: 3 }, expect.any(String));
      expect(body$("[data-testid=card-pick-sheet]")).toBeNull();
      expect($("[data-testid=shared-toast]").textContent).toBe(t("preset.share.cardPick.applied", { name: "電影感長篇", card: "QA 探針" }));
    });

    it("別處剛改過這張卡（409）：重讀綁定再送一次", async () => {
      await open();
      rows()[1]!.click(); await flush();
      mocks.binding.mockResolvedValueOnce({ mode: "card_default", presetId: null, bindingVersion: 0 }).mockResolvedValueOnce({ mode: "preset", presetId: "y", bindingVersion: 1 });
      mocks.apply.mockRejectedValueOnce(new ApiError(409, "x", "preset_conflict", undefined, "preset_revision_conflict")).mockResolvedValueOnce({ mode: "preset", presetId: "s1", bindingVersion: 2 });
      body$<HTMLButtonElement>("[data-testid=card-pick-apply]").click();
      await flush();
      expect(mocks.apply).toHaveBeenCalledTimes(2);
      expect(mocks.apply.mock.calls[1]![1]).toEqual({ roleId: "r2", presetId: "s1", expectedVersion: 1 });
      expect(mocks.apply.mock.calls[0]![2]).not.toBe(mocks.apply.mock.calls[1]![2]);
      expect($("[data-testid=shared-toast]").textContent).toBe(t("preset.share.cardPick.applied", { name: "電影感長篇", card: "白露的書店" }));
    });

    it("搜尋卡名；沒玩過任何卡時說明怎麼才有", async () => {
      await open();
      const search = body$<HTMLInputElement>("[data-testid=card-pick-search]");
      search.value = "書店"; search.dispatchEvent(new Event("input")); await flush();
      expect(rows()).toHaveLength(1);
      search.value = "沒有這張"; search.dispatchEvent(new Event("input")); await flush();
      expect(body$("[data-testid=card-pick-no-results]").textContent).toBe(t("preset.share.cardPick.noResults"));
      body$<HTMLButtonElement>("[data-testid=sheet-close]").click(); await flush();
      mocks.conversations.mockResolvedValue({ conversations: [], hasNextPage: false });
      $("[data-testid=shared-apply]").click(); await flush();
      expect(body$("[data-testid=card-pick-empty]").textContent).toContain(t("preset.share.cardPick.empty.title"));
    });
  });

  it("之前檢舉過的一打開就標你已檢舉；自己的預設不給喜愛與檢舉", async () => {
    mocks.detail.mockResolvedValueOnce(detail({ reportedByMe: true }));
    await mount("/presets/s1");
    expect($("[data-testid=shared-reported]")).not.toBeNull();
    expect($("[data-testid=shared-report]")).toBeNull();
    app!.unmount(); root.remove();
    mocks.detail.mockResolvedValueOnce(detail({}, { mine: true }));
    await mount("/presets/s1");
    expect($("[data-testid=shared-fav]")).toBeNull();
    expect($("[data-testid=shared-report]")).toBeNull();
    // 自己的也能套用到自己的卡
    expect($("[data-testid=shared-apply]")).not.toBeNull();
  });

  it("詳情：已不公開的取消喜愛先確認，取消後回到喜愛與用過", async () => {
    mocks.detail.mockResolvedValue(detail({}, { listed: false, favorited: true }));
    mocks.favorite.mockResolvedValue({ favorited: false });
    await mount("/presets/s1");
    mocks.confirm.mockResolvedValueOnce(false);
    $("[data-testid=shared-fav]").click();
    await flush();
    expect(mocks.favorite).not.toHaveBeenCalled();
    $("[data-testid=shared-fav]").click();
    await flush();
    expect(mocks.favorite).toHaveBeenCalledWith("tok", "s1", false);
    expect(router.currentRoute.value.fullPath).toBe("/me/presets?tab=fav");
  });

  it("已不公開的標示加說明；看不到的說找不到", async () => {
    mocks.detail.mockResolvedValueOnce(detail({}, { listed: false, favorited: true }));
    await mount("/presets/s1");
    expect($("[data-testid=shared-unlisted]").textContent).toContain(t("preset.share.unlisted.hint"));
    expect($("[data-testid=shared-fav]").getAttribute("aria-pressed")).toBe("true");
    app!.unmount(); root.remove();
    mocks.detail.mockRejectedValueOnce(new ApiError(404, "x", "not_found"));
    await mount("/presets/zzz");
    expect($("[data-testid=shared-not-found]")).not.toBeNull();
  });
});

describe("測試過的模型的顯示名", () => {
  it("series: 顯示全系列，model: 顯示模型名，目錄沒有的舊值照原字", async () => {
    i18n.global.locale.value = SOURCE_LOCALE;
    const { modelValueLabel } = await vi.importActual<typeof import("../src/lib/presets")>("../src/lib/presets");
    expect(modelValueLabel("series:Gemini")).toBe(t("preset.models.series", { name: "Gemini" }));
    expect(modelValueLabel("model:DeepSeek V4")).toBe("DeepSeek V4");
    expect(modelValueLabel("deepseek-v4-lane")).toBe("deepseek-v4-lane");
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
