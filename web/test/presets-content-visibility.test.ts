/**
 * 預設「只供使用」（內容不公開）：公開彈層的二選一、預設庫清單標記與詳情、我的預設切換模式。
 * 確認框這裡掛真的 ConfirmDialog：被拒時要留在框裡顯示原因，mock 掉就驗不到。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type Component } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n, SOURCE_LOCALE } from "../src/lib/i18n";
import { useSession } from "../src/lib/session";
import { setProvider } from "../src/lib/provider";
import { ApiError } from "../src/lib/api";
import { confirmState } from "../src/lib/confirm";
import type { PresetLibraryDetail, PresetLibraryItem, PresetSummary } from "../src/lib/presets";
import PresetListPage from "../src/pages/PresetListPage.vue";
import PresetLibraryPage from "../src/pages/PresetLibraryPage.vue";
import PresetLibraryHomePage from "../src/pages/PresetLibraryHomePage.vue";
import ConfirmDialog from "../src/components/ConfirmDialog.vue";

const mocks = vi.hoisted(() => ({
  token: vi.fn(), models: vi.fn(), list: vi.fn(), publish: vi.fn(), unpublish: vi.fn(),
  library: vi.fn(), hot: vi.fn(), shelf: vi.fn(), detail: vi.fn(),
}));
vi.mock("../src/lib/connections", () => ({ accountToken: mocks.token }));
vi.mock("../src/lib/presets", async (original) => ({
  ...(await original<typeof import("../src/lib/presets")>()),
  listPresets: mocks.list, publishPreset: mocks.publish, unpublishPreset: mocks.unpublish,
  listPresetLibrary: mocks.library, listPresetLibraryHot: mocks.hot, listPresetShelf: mocks.shelf,
  fetchLibraryPreset: mocks.detail, fetchModelCatalog: mocks.models,
}));

let app: ReturnType<typeof createApp> | undefined;
let root: HTMLElement;
let router: Router;
afterEach(() => { app?.unmount(); root?.remove(); confirmState.current = null; vi.clearAllMocks(); });

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); await nextTick(); };
const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const body$ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T;
const t = (key: string, values: Record<string, unknown> = {}, n?: number) => (n === undefined ? i18n.global.t(key, values) : i18n.global.t(key, values, n));

async function mount(path: string) {
  setProvider("harbor");
  i18n.global.locale.value = SOURCE_LOCALE;
  mocks.token.mockResolvedValue("tok");
  mocks.models.mockResolvedValue([]);
  mocks.hot.mockResolvedValue({ items: [] });
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
  app = createApp({ components: { ConfirmDialog }, template: "<RouterView /><ConfirmDialog />" }).use(pinia).use(router).use(i18n);
  app.mount(root);
  await flush();
}

const summary = (over: Partial<PresetSummary> = {}): PresetSummary => ({
  id: "p1", title: "細膩第三人稱", version: 2, sourceKind: "native", purpose: "general",
  recommendedModels: [], createdAt: "2026-10-29T00:00:00Z", updatedAt: "2026-10-29T00:00:00Z", bindingCount: 0,
  visibility: "private", contentVisibility: "open", contentHiddenAvailable: true, publishedAt: null, attribution: "", removed: false, ...over,
});
/** 預設是上游開關開著；switchOn=false 是開關關著，undefined 是舊上游（沒有這一項） */
const mineList = (items: PresetSummary[], switchOn: boolean | undefined = true) => ({ items, nextCursor: "", quota: { used: items.length, limit: 50 }, declarationVersion: "preset-publish-2026-10-30", ...(switchOn === undefined ? {} : { contentHiddenEnabled: switchOn }) });
/** 舊上游的一列：沒有 contentVisibility 與 contentHiddenAvailable */
const oldSummary = (over: Partial<PresetSummary> = {}): PresetSummary => {
  const { contentVisibility: _c, contentHiddenAvailable: _a, ...rest } = summary(over);
  return rest;
};
const item = (over: Partial<PresetLibraryItem> = {}): PresetLibraryItem => ({
  presetId: "s1", title: "電影感長篇", authorName: "Aster", authorNumId: 12345, authorAvatar: "", attribution: "",
  recommendedModels: [], enabledEntryCount: 12, usesLast7d: 3, publishedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-28T00:00:00Z",
  favorited: false, lastAppliedAt: null, listed: true, mine: false, contentVisibility: "open", ...over,
});
const overlap = () => new ApiError(422, "x", "preset_invalid", undefined, "preset_hidden_overlap");

async function openPublish() {
  $("[data-testid=preset-more]").click(); await flush();
  $("[data-testid=preset-publish]").click(); await flush();
}
const radio = (v: "open" | "hidden") => body$<HTMLInputElement>(`[data-testid=publish-content-${v}]`);

describe("公開彈層：內容公開方式", () => {
  it("兩個選項都不預選；沒選就按公開，彈層內一行錯誤，不送出", async () => {
    mocks.list.mockResolvedValue(mineList([summary()]));
    await mount("/me/presets");
    await openPublish();
    const sheet = body$("[data-testid=publish-sheet]");
    // 位置：說明句之後、用途之前
    const fields = [...sheet.querySelectorAll("fieldset")];
    expect(fields[0]!.querySelector("legend")!.textContent).toBe(t("preset.share.contentVisibility.label"));
    expect(fields[1]!.classList.contains("publish__purpose")).toBe(true);
    expect(radio("open").checked).toBe(false);
    expect(radio("hidden").checked).toBe(false);
    expect(radio("hidden").disabled).toBe(false);
    expect(sheet.textContent).toContain(t("preset.share.contentVisibility.open.hint"));
    expect(sheet.textContent).toContain(t("preset.share.contentVisibility.hidden.hint"));
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click(); await flush();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(body$("[data-testid=publish-error]").textContent).toBe(t("preset.share.contentVisibility.required"));
  });

  it("選只供使用：選項下方出現已知限制，送出帶 contentVisibility", async () => {
    mocks.list.mockResolvedValue(mineList([summary()]));
    mocks.publish.mockResolvedValue({ presetId: "p1", revisionId: "r2", version: 3 });
    await mount("/me/presets");
    await openPublish();
    expect(body$("[data-testid=publish-limit]")).toBeNull();
    radio("hidden").click(); await flush();
    const limit = body$("[data-testid=publish-limit]");
    expect(limit.textContent).toBe(t("preset.share.contentVisibility.limitNote"));
    expect(radio("hidden").getAttribute("aria-describedby")).toContain(limit.id);
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click(); await flush();
    expect(mocks.publish.mock.calls[0]![2]).toMatchObject({ purpose: "general", contentVisibility: "hidden" });
    expect(body$("[data-testid=publish-sheet]")).toBeNull();
  });

  it("選公開內容也明送 open（之前設過只供使用、改回私人後再公開，不沿用舊的模式）", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ contentVisibility: "hidden" })]));
    mocks.publish.mockResolvedValue({ presetId: "p1", revisionId: "r2", version: 3 });
    await mount("/me/presets");
    await openPublish();
    expect(radio("hidden").checked).toBe(false);
    radio("open").click(); await flush();
    expect(body$("[data-testid=publish-limit]")).toBeNull();
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click(); await flush();
    expect(mocks.publish.mock.calls[0]![2]).toMatchObject({ contentVisibility: "open" });
  });

  it("匯入的預設：只供使用一打開就停用並寫原因，自動選公開內容", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ sourceKind: "imported", contentHiddenAvailable: false })]));
    mocks.publish.mockResolvedValue({ presetId: "p1", revisionId: "r2", version: 3 });
    await mount("/me/presets");
    await openPublish();
    expect(radio("hidden").disabled).toBe(true);
    expect(radio("open").checked).toBe(true);
    const why = body$("[data-testid=publish-hidden-why]");
    expect(why.textContent).toBe(t("preset.share.contentVisibility.disabledImported"));
    expect(radio("hidden").getAttribute("aria-describedby")).toContain(why.id);
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click(); await flush();
    expect(mocks.publish.mock.calls[0]![2]).toMatchObject({ contentVisibility: "open" });
  });

  it("比對到他人內容被拒：彈層不關，一行錯誤、只供使用停用寫原因、清掉選擇；改選公開內容再送", async () => {
    mocks.list.mockResolvedValue(mineList([summary()]));
    mocks.publish.mockRejectedValueOnce(overlap()).mockResolvedValueOnce({ presetId: "p1", revisionId: "r2", version: 3 });
    await mount("/me/presets");
    await openPublish();
    radio("hidden").click(); await flush();
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click(); await flush();
    expect(body$("[data-testid=publish-sheet]")).not.toBeNull();
    expect(body$("[data-testid=publish-error]").textContent).toBe(t("preset.share.contentVisibility.disabledOverlap"));
    expect(radio("hidden").disabled).toBe(true);
    expect(radio("hidden").checked).toBe(false);
    expect(radio("open").checked).toBe(false);
    expect(body$("[data-testid=publish-hidden-why]").textContent).toBe(t("preset.share.contentVisibility.disabledOverlap"));
    expect(body$("[data-testid=publish-limit]")).toBeNull();
    radio("open").click(); await flush();
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click(); await flush();
    expect(mocks.publish.mock.calls[1]![2]).toMatchObject({ contentVisibility: "open" });
    expect(body$("[data-testid=publish-sheet]")).toBeNull();
  });

  it("上游開關關著：不出現內容公開方式，照原本的流程公開，明送公開內容", async () => {
    // 之前設過只供使用、改回私人的也一樣：開關關著不能再只供使用，要明送 open 才不會沿用
    mocks.list.mockResolvedValue(mineList([summary({ contentHiddenAvailable: false, contentVisibility: "hidden" })], false));
    mocks.publish.mockResolvedValue({ presetId: "p1", revisionId: "r2", version: 3 });
    await mount("/me/presets");
    await openPublish();
    expect(body$("[data-testid=publish-content]")).toBeNull();
    expect(radio("hidden")).toBeNull();
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click(); await flush();
    expect(mocks.publish.mock.calls[0]![2]).toMatchObject({ purpose: "general", contentVisibility: "open" });
  });

  it("開關關著時匯入的預設也不出現這一組", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ sourceKind: "imported", contentHiddenAvailable: false })], false));
    await mount("/me/presets");
    await openPublish();
    expect(body$("[data-testid=publish-content]")).toBeNull();
  });

  it("舊上游（沒有開關與模式）：不出現這一組，也不送 contentVisibility", async () => {
    mocks.list.mockResolvedValue(mineList([oldSummary()], undefined));
    mocks.publish.mockResolvedValue({ presetId: "p1", revisionId: "r2", version: 3 });
    await mount("/me/presets");
    await openPublish();
    expect(body$("[data-testid=publish-content]")).toBeNull();
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click(); await flush();
    expect(mocks.publish.mock.calls[0]![2]).not.toHaveProperty("contentVisibility");
  });

  it("只供使用尚未開放（preset_hidden_disabled）：一般的公開失敗句，選項不停用", async () => {
    mocks.list.mockResolvedValue(mineList([summary()]));
    mocks.publish.mockRejectedValueOnce(new ApiError(422, "x", "preset_invalid", undefined, "preset_hidden_disabled"));
    await mount("/me/presets");
    await openPublish();
    radio("hidden").click(); await flush();
    body$<HTMLButtonElement>("[data-testid=publish-confirm]").click(); await flush();
    expect(body$("[data-testid=publish-error]").textContent).toBe(t("preset.share.error.publish"));
    expect(radio("hidden").disabled).toBe(false);
  });
});

describe("預設庫清單：只供使用標記", () => {
  it("只供使用的列多一顆 chip，排在我的之後、用途之前；公開內容的沒有", async () => {
    mocks.library.mockResolvedValue({ items: [item({ presetId: "a", contentVisibility: "hidden", mine: true }), item({ presetId: "b" })] });
    await mount("/presets/library");
    const [hidden, open] = $$("[data-testid=share-row]");
    const chip = hidden!.querySelector("[data-testid=share-content-hidden]")!;
    expect(chip.textContent?.trim()).toBe(t("preset.share.chip.contentHidden"));
    expect(chip.querySelector("svg")).not.toBeNull();
    expect(chip.nextElementSibling!.getAttribute("data-testid")).toBe("share-purpose");
    expect(chip.previousElementSibling!.textContent).toBe(t("preset.share.tabs.mine"));
    expect(open!.querySelector("[data-testid=share-content-hidden]")).toBeNull();
  });
});

describe("預設庫詳情：只供使用", () => {
  const emptyDoc = { schemaVersion: "hearthroom.st-preset.v1", st: { prompts: [], prompt_order: [] }, selection: { profileId: 100001, excludedEntryIds: [], acceptedAdaptationIds: [], excludedFields: [] } };
  const fullDoc = {
    schemaVersion: "hearthroom.st-preset.v1",
    st: { prompts: [{ identifier: "a", name: "主敘事規則", role: "system", content: "用鏡頭的方式寫場景。" }], prompt_order: [{ character_id: 100001, order: [{ identifier: "a", enabled: true }] }] },
    selection: { profileId: 100001, excludedEntryIds: [], acceptedAdaptationIds: [], excludedFields: [] },
  };
  const detail = (over: Partial<PresetLibraryDetail>, it: Partial<PresetLibraryItem>): PresetLibraryDetail => ({
    item: item(it),
    revision: { revisionId: "r1", presetId: "s1", version: 1, sourceKind: "native", compilerVersion: "x", contentHash: "", recommendedModels: [], createdAt: "", document: emptyDoc as never },
    compatibility: { compilerVersion: "x", reviewRequired: false, fields: [], entries: [] },
    parameters: {}, reportedByMe: false, contentHidden: false, ...over,
  });

  it("他人：不渲染任何條目，改顯示鎖頭、內容不公開、說明與啟用條目數；套用照舊", async () => {
    mocks.detail.mockResolvedValue(detail({ contentHidden: true }, { contentVisibility: "hidden", enabledEntryCount: 12 }));
    await mount("/presets/s1");
    expect($$("[data-testid=shared-entry]")).toHaveLength(0);
    expect($("[data-testid=shared-summary]")).toBeNull();
    const block = $("[data-testid=shared-hidden]");
    expect(block.querySelector("svg")).not.toBeNull();
    expect(block.querySelector("h2")!.textContent).toBe(t("preset.share.detail.contentHidden.title"));
    expect(block.textContent).toContain(t("preset.share.detail.contentHidden.body"));
    expect($("[data-testid=shared-hidden-count]").textContent).toBe(t("preset.share.detail.contentHidden.entryCount", { n: "12" }, 12));
    expect($("[data-testid=shared-content-chip]").textContent?.trim()).toBe(t("preset.share.chip.contentHidden"));
    expect($("[data-testid=shared-content-fact]").textContent).toBe(t("preset.share.detail.contentHidden.factValue"));
    expect($("[data-testid=shared-author-note]")).toBeNull();
    expect($("[data-testid=shared-apply]")).not.toBeNull();
    expect($("[data-testid=shared-fav]")).not.toBeNull();
    expect($("[data-testid=shared-report]")).not.toBeNull();
  });

  it("作者本人：照舊看到完整內容，上方多一條資訊條", async () => {
    mocks.detail.mockResolvedValue(detail({ contentHidden: false, revision: { ...detail({}, {}).revision, document: fullDoc as never } }, { contentVisibility: "hidden", mine: true }));
    await mount("/presets/s1");
    expect($$("[data-testid=shared-entry]")).toHaveLength(1);
    expect($("[data-testid=shared-hidden]")).toBeNull();
    expect($("[data-testid=shared-author-note]").textContent).toContain(t("preset.share.detail.contentHidden.authorNote"));
    expect($("[data-testid=shared-content-chip]")).not.toBeNull();
    expect($("[data-testid=shared-content-fact]").textContent).toBe(t("preset.share.contentVisibility.hidden"));
  });

  it("公開內容的預設：沒有標記、資訊條與內容事實列", async () => {
    mocks.detail.mockResolvedValue(detail({ revision: { ...detail({}, {}).revision, document: fullDoc as never } }, {}));
    await mount("/presets/s1");
    expect($$("[data-testid=shared-entry]")).toHaveLength(1);
    expect($("[data-testid=shared-content-chip]")).toBeNull();
    expect($("[data-testid=shared-content-fact]")).toBeNull();
    expect($("[data-testid=shared-author-note]")).toBeNull();
  });
});

describe("我的預設：顯示與切換模式", () => {
  const row = () => $("[data-testid=preset-row]");
  async function openMenu() { $("[data-testid=preset-more]").click(); await flush(); }
  const dialog = () => body$(".dlg");
  const dialogButton = (sel: string) => dialog().querySelector<HTMLButtonElement>(sel)!;

  it("只供使用的已公開列在已公開後多一顆 chip；私人的不顯示", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ visibility: "public", contentVisibility: "hidden" }), summary({ id: "p2", contentVisibility: "hidden" })]));
    await mount("/me/presets");
    const [pub, priv] = $$("[data-testid=preset-row]");
    const chip = pub!.querySelector("[data-testid=preset-content-hidden]")!;
    expect(chip.textContent?.trim()).toBe(t("preset.share.chip.contentHidden"));
    expect(chip.previousElementSibling!.getAttribute("data-testid")).toBe("preset-public");
    expect(priv!.querySelector("[data-testid=preset-content-hidden]")).toBeNull();
  });

  it("公開內容 → 只供使用：先確認（收不回的提醒、焦點在取消），確認後重新公開並 toast", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ visibility: "public", attribution: "原作者 A", purpose: "specific", recommendedModels: ["model:Gemini 4"] })]));
    mocks.publish.mockResolvedValue({ presetId: "p1", revisionId: "r2", version: 3 });
    await mount("/me/presets");
    await openMenu();
    expect($("[data-testid=preset-to-open]")).toBeNull();
    $("[data-testid=preset-to-hidden]").click(); await flush();
    expect(dialog().querySelector("#dlg-title")!.textContent).toBe(t("preset.share.switchToHidden.confirmTitle"));
    expect(dialog().textContent).toContain(t("preset.share.switchToHidden.warning"));
    expect(dialogButton("[data-cancel]").textContent?.trim()).toBe(t("preset.share.switchToHidden.keep"));
    expect(dialogButton("[data-confirm]").textContent?.trim()).toBe(t("preset.share.switchToHidden.confirm"));
    expect(document.activeElement).toBe(dialogButton("[data-cancel]"));
    expect(mocks.publish).not.toHaveBeenCalled();
    dialogButton("[data-confirm]").click(); await flush();
    expect(mocks.publish).toHaveBeenCalledWith("tok", "p1", { purpose: "specific", expectedVersion: 2, declaration: "preset-publish-2026-10-30", attribution: "原作者 A", contentVisibility: "hidden" }, expect.any(String));
    expect(dialog()).toBeNull();
    expect($("[data-testid=preset-toast]").textContent).toBe(t("preset.share.switchToHidden.toast"));
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("改為只供使用被比對擋下：確認框不關，框內一行原因；取消就什麼都不改", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ visibility: "public" })]));
    mocks.publish.mockRejectedValue(overlap());
    await mount("/me/presets");
    await openMenu();
    $("[data-testid=preset-to-hidden]").click(); await flush();
    dialogButton("[data-confirm]").click(); await flush();
    expect(dialog()).not.toBeNull();
    expect(dialog().querySelector("[role=alert]")!.textContent?.trim()).toBe(t("preset.share.contentVisibility.disabledOverlap"));
    dialogButton("[data-cancel]").click(); await flush();
    expect(dialog()).toBeNull();
    expect($("[data-testid=preset-toast]").textContent).toBe("");
  });

  it("別處先改過（409）：框內說明、清單重讀，再按一次送新的版本", async () => {
    mocks.list.mockResolvedValueOnce(mineList([summary({ visibility: "public" })])).mockResolvedValue(mineList([summary({ visibility: "public", version: 5 })]));
    mocks.publish.mockRejectedValueOnce(new ApiError(409, "x", "preset_conflict", undefined, "preset_revision_conflict")).mockResolvedValueOnce({ presetId: "p1", revisionId: "r2", version: 6 });
    await mount("/me/presets");
    await openMenu();
    $("[data-testid=preset-to-hidden]").click(); await flush();
    dialogButton("[data-confirm]").click(); await flush();
    expect(dialog().querySelector("[role=alert]")!.textContent?.trim()).toBe(t("preset.share.error.conflict"));
    dialogButton("[data-confirm]").click(); await flush();
    expect(mocks.publish.mock.calls[0]![2]).toMatchObject({ expectedVersion: 2 });
    expect(mocks.publish.mock.calls[1]![2]).toMatchObject({ expectedVersion: 5, contentVisibility: "hidden" });
    expect(dialog()).toBeNull();
  });

  it("只供使用 → 公開內容：也先確認，確認後送 open", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ visibility: "public", contentVisibility: "hidden" })]));
    mocks.publish.mockResolvedValue({ presetId: "p1", revisionId: "r2", version: 3 });
    await mount("/me/presets");
    await openMenu();
    expect($("[data-testid=preset-to-hidden]")).toBeNull();
    $("[data-testid=preset-to-open]").click(); await flush();
    expect(dialog().querySelector("#dlg-title")!.textContent).toBe(t("preset.share.switchToOpen.confirmTitle"));
    expect(dialog().textContent).toContain(t("preset.share.switchToOpen.warning"));
    expect(dialogButton("[data-cancel]").textContent?.trim()).toBe(t("preset.share.switchToOpen.keep"));
    dialogButton("[data-confirm]").click(); await flush();
    expect(mocks.publish.mock.calls[0]![2]).toMatchObject({ contentVisibility: "open", purpose: "general" });
    expect($("[data-testid=preset-toast]").textContent).toBe(t("preset.share.switchToOpen.toast"));
  });

  it("開關關著：公開內容的不能改成只供使用，已經只供使用的仍能改回公開內容", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ visibility: "public", contentHiddenAvailable: false }), summary({ id: "p2", visibility: "public", contentVisibility: "hidden", contentHiddenAvailable: false })], false));
    mocks.publish.mockResolvedValue({ presetId: "p2", revisionId: "r2", version: 3 });
    await mount("/me/presets");
    const [open, hidden] = $$("[data-testid=preset-row]");
    open!.querySelector<HTMLElement>("[data-testid=preset-more]")!.click(); await flush();
    expect($("[data-testid=preset-to-hidden]")).toBeNull();
    expect($("[data-testid=preset-to-open]")).toBeNull();
    hidden!.querySelector<HTMLElement>("[data-testid=preset-more]")!.click(); await flush();
    $("[data-testid=preset-to-open]").click(); await flush();
    dialogButton("[data-confirm]").click(); await flush();
    expect(mocks.publish.mock.calls[0]![2]).toMatchObject({ contentVisibility: "open" });
  });

  it("舊上游（沒有開關與模式）：選單沒有切換", async () => {
    mocks.list.mockResolvedValue(mineList([oldSummary({ visibility: "public" })], undefined));
    await mount("/me/presets");
    await openMenu();
    expect($("[data-testid=preset-to-hidden]")).toBeNull();
    expect($("[data-testid=preset-to-open]")).toBeNull();
  });

  it("匯入的、被下架的、私人的都沒有切換這一項", async () => {
    mocks.list.mockResolvedValue(mineList([summary({ visibility: "public", sourceKind: "imported", contentHiddenAvailable: false })]));
    await mount("/me/presets");
    await openMenu();
    expect($("[data-testid=preset-to-hidden]")).toBeNull();
    expect($("[data-testid=preset-to-open]")).toBeNull();
    app!.unmount(); root.remove();
    mocks.list.mockResolvedValue(mineList([summary({ visibility: "public", removed: true }), summary({ id: "p2" })]));
    await mount("/me/presets");
    for (const r of $$("[data-testid=preset-row]")) {
      r.querySelector<HTMLElement>("[data-testid=preset-more]")!.click(); await flush();
      expect($("[data-testid=preset-to-hidden]")).toBeNull();
      expect($("[data-testid=preset-to-open]")).toBeNull();
    }
    expect(row()).not.toBeNull();
  });
});
