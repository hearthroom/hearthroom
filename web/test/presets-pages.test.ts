import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type Component } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n, loadLocale, SOURCE_LOCALE } from "../src/lib/i18n";
import { useSession } from "../src/lib/session";
import { setProvider } from "../src/lib/provider";
import { ApiError } from "../src/lib/api";
import type { Compatibility, PresetDetail, PresetSummary } from "../src/lib/presets";
import type { PresetDocument } from "../src/lib/st-preset";
import PresetListPage from "../src/pages/PresetListPage.vue";
import PresetEditorPage from "../src/pages/PresetEditorPage.vue";
import PresetImportPage from "../src/pages/PresetImportPage.vue";

const mocks = vi.hoisted(() => ({
  token: vi.fn(), login: vi.fn(), confirm: vi.fn(),
  list: vi.fn(), detail: vi.fn(), revision: vi.fn(), analyze: vi.fn(), create: vi.fn(), revise: vi.fn(),
  remove: vi.fn(), archive: vi.fn(), preview: vi.fn(), selection: vi.fn(), confirmImport: vi.fn(), exportRevision: vi.fn(), models: vi.fn(),
}));
vi.mock("../src/lib/connections", () => ({ accountToken: mocks.token }));
vi.mock("../src/lib/oauth", async (original) => ({ ...(await original<typeof import("../src/lib/oauth")>()), beginLogin: mocks.login }));
vi.mock("../src/lib/confirm", async (original) => ({ ...(await original<typeof import("../src/lib/confirm")>()), confirmDialog: mocks.confirm }));
vi.mock("../src/lib/presets", async (original) => ({
  ...(await original<typeof import("../src/lib/presets")>()),
  listPresets: mocks.list, fetchPreset: mocks.detail, fetchRevision: mocks.revision, analyzePreset: mocks.analyze,
  createPreset: mocks.create, revisePreset: mocks.revise, deletePreset: mocks.remove, archivePreset: mocks.archive,
  previewImport: mocks.preview, updateImportSelection: mocks.selection, confirmImport: mocks.confirmImport, exportRevision: mocks.exportRevision, fetchModelOptions: mocks.models,
}));

let app: ReturnType<typeof createApp> | undefined;
let root: HTMLElement;
let router: Router;
afterEach(() => { app?.unmount(); root?.remove(); vi.clearAllMocks(); });

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); await nextTick(); };
const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const t = (key: string, values: Record<string, unknown> = {}) => i18n.global.t(key, values);

async function mount(page: Component, path: string) {
  setProvider("harbor");
  i18n.global.locale.value = SOURCE_LOCALE;
  mocks.token.mockResolvedValue("tok");
  mocks.confirm.mockResolvedValue(true);
  mocks.models.mockResolvedValue([]);
  const pinia = createPinia(); setActivePinia(pinia);
  const session = useSession();
  session.me = { accountNumId: 7, nickName: "Fixture", avatar: "" };
  session.profile = { identities: [{ provider: "harbor", externalId: 7 }] } as never;
  const stub = { template: "<div />" };
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/me/presets", component: PresetListPage },
    { path: "/me/presets/import", component: PresetImportPage }, { path: "/me/presets/:presetId", component: PresetEditorPage },
    { path: "/:p(.*)*", component: stub },
  ] });
  await router.push(path);
  root = document.createElement("div"); document.body.append(root);
  app = createApp({ template: "<RouterView />" }).use(pinia).use(router).use(i18n);
  app.mount(root);
  await flush();
}

const summary = (over: Partial<PresetSummary> = {}): PresetSummary => ({
  id: "p1", title: "細膩第三人稱", headRevisionId: "r2", version: 2, sourceKind: "imported", archived: false,
  recommendedModels: [], createdAt: "2026-10-29T00:00:00Z", updatedAt: "2026-10-29T00:00:00Z", allowedActions: ["delete"], bindingCount: 0, ...over,
});

function doc(): PresetDocument {
  return {
    schemaVersion: "hearthroom.st-preset.v1",
    st: {
      prompts: [
        { identifier: "clear", name: "清楚敘述", role: "system", content: "使用清楚的敘述。" },
        { identifier: "script", name: "腳本", role: "system", content: "{{getvar::x}}" },
        { identifier: "chatHistory", name: "Chat History", marker: true },
        { identifier: "turn", name: "回應玩家", role: "system", content: "{{lastUserMessage}}" },
      ],
      prompt_order: [{ character_id: 100001, order: [
        { identifier: "clear", enabled: true }, { identifier: "script", enabled: true },
        { identifier: "chatHistory", enabled: true }, { identifier: "turn", enabled: true },
      ] }],
      extensions: { fixtureOnly: true },
    },
    selection: { profileId: 100001, excludedEntryIds: [], acceptedAdaptationIds: [], excludedFields: [] },
  };
}
const compat = (): Compatibility => ({
  compilerVersion: "preset-p1.1", reviewRequired: true,
  entries: [
    { identifier: "clear", enabled: true, frameworkOwned: false, targetSlot: "P", reasonCodes: [], availableAdaptationIds: [], inertSettings: [] },
    { identifier: "script", enabled: true, frameworkOwned: false, uiStatus: "unsupported", reasonCodes: ["macro_not_supported"], availableAdaptationIds: [], inertSettings: [] },
    { identifier: "chatHistory", enabled: true, frameworkOwned: true, targetSlot: "F", reasonCodes: ["framework_owned"], availableAdaptationIds: [], inertSettings: [] },
    { identifier: "turn", enabled: true, frameworkOwned: false, targetSlot: "S", uiStatus: "needs_adjustment", reasonCodes: ["move_to_suffix"], availableAdaptationIds: ["turn:move_to_suffix"], inertSettings: ["injection_order"], adaptationId: "turn:move_to_suffix" },
  ],
  fields: [{ path: "extensions", uiStatus: "unsupported", reasonCodes: ["source_only"], inertSettings: ["extensions"] }],
});
const detail = (over: Partial<PresetDetail> = {}): PresetDetail => ({ ...summary(), revisions: [
  { revisionId: "r2", version: 2, title: "細膩第三人稱", createdAt: "2026-10-29T00:00:00Z", enabledEntryCount: 3 },
  { revisionId: "r1", version: 1, title: "細膩第三人稱", createdAt: "2026-10-28T00:00:00Z", enabledEntryCount: 2 },
], ...over });

describe("我的預設列表", () => {
  it("能刪的給刪除；上游實際只封存時照實說封存", async () => {
    mocks.list.mockResolvedValue({ items: [summary()], nextCursor: "", quota: { used: 1, limit: 50, archived: 0 } });
    mocks.remove.mockResolvedValue({ presetId: "p1", revisionId: "r2", version: 2, disposition: "archived" });
    await mount(PresetListPage, "/me/presets");
    expect($("[data-testid=preset-quota]").textContent).toContain(t("preset.quota", { used: "1", limit: "50" }));
    $("[data-testid=preset-more]").click();
    await flush();
    $("[data-testid=preset-remove]").click();
    await flush();
    expect(mocks.confirm.mock.calls[0]![0]).toMatchObject({ danger: true, focusCancel: true, cancelText: t("preset.delete.keep") });
    expect(mocks.remove).toHaveBeenCalledWith("tok", "p1", 2, expect.any(String));
    expect(root.textContent).toContain(t("preset.disposition.archivedInstead", { name: "細膩第三人稱" }));
    expect(root.textContent).not.toContain(t("preset.delete.done", { name: "細膩第三人稱" }));
  });

  it("有對話在用的只給封存，不給刪除", async () => {
    mocks.list.mockResolvedValue({ items: [summary({ allowedActions: ["archive"], bindingCount: 2 })], nextCursor: "", quota: { used: 1, limit: 50, archived: 0 } });
    mocks.archive.mockResolvedValue({ presetId: "p1", revisionId: "r2", version: 2 });
    await mount(PresetListPage, "/me/presets");
    $("[data-testid=preset-more]").click();
    await flush();
    expect($("[data-testid=preset-remove]").textContent?.trim()).toBe(t("preset.row.archive"));
    $("[data-testid=preset-remove]").click();
    await flush();
    expect(mocks.archive).toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("舊授權沒有預設權限時請他重新同意，不顯示成錯誤", async () => {
    mocks.list.mockRejectedValue(new ApiError(403, "x", "insufficient_scope"));
    await mount(PresetListPage, "/me/presets");
    $("[data-testid=preset-reauthorize]").click();
    expect(mocks.login).toHaveBeenCalledWith("/me/presets", { provider: "harbor" });
    expect($("[role=alert]")).toBeNull();
  });

  it("沒有預設時說明下一步，不出現全域套用之類的選項", async () => {
    mocks.list.mockResolvedValue({ items: [], nextCursor: "", quota: { used: 0, limit: 50, archived: 0 } });
    await mount(PresetListPage, "/me/presets");
    expect($("[data-testid=preset-empty]")).not.toBeNull();
    expect(root.textContent).not.toMatch(/全部的卡|所有卡|全域/);
  });
});

describe("預設編輯器", () => {
  async function open() {
    mocks.detail.mockResolvedValue(detail());
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r2", presetId: "p1", version: 2, document: doc(), sourceKind: "imported", compilerVersion: "preset-p1.1", contentHash: "h", recommendedModels: [], createdAt: "" }, compatibility: compat() });
    mocks.analyze.mockImplementation(async () => compat());
    await mount(PresetEditorPage, "/me/presets/p1");
  }
  const rowNamed = (name: string) => $$("[data-testid=entry-row]").find((b) => b.textContent?.includes(name))!;
  const toggleOf = (name: string) => rowNamed(name).parentElement!.querySelector("input[type=checkbox]") as HTMLInputElement;
  const waitAnalyze = async () => { await new Promise((r) => setTimeout(r, 600)); await flush(); };

  it("只標需調整與不支援；可以直接用的與框架條目不貼相容標籤", async () => {
    await open();
    expect(rowNamed("清楚敘述").textContent).not.toMatch(/需調整|不支援|相容/);
    expect(rowNamed("腳本").textContent).toContain(t("preset.report.status.unsupported"));
    expect(rowNamed("回應玩家").textContent).toContain(t("preset.report.status.adjust"));
    const provided = $$("[data-testid=provided-row]");
    expect(provided.map((b) => b.textContent?.trim().replace(t("preset.provided.label"), "").trim())).toEqual([t("preset.provided.chatHistory"), t("preset.provided.memory")]);
    expect(provided[0]!.parentElement!.querySelector("input[type=checkbox]")).toBeNull();
    expect(root.textContent).not.toContain("相容");
  });

  it("啟用中的不支援與未確認調整擋住存檔；處理完才存，帶著開始時的版本", async () => {
    await open();
    (toggleOf("清楚敘述")).click();
    await waitAnalyze();
    expect($("[data-testid=preset-blocked]").textContent).toBe(t("preset.editor.saveBlocked", { n: 2, names: "腳本、回應玩家" }));
    expect($<HTMLButtonElement>("[data-testid=preset-save]").disabled).toBe(true);
    toggleOf("腳本").click();
    rowNamed("回應玩家").click();
    await flush();
    $("[data-testid=entry-accept]").click();
    await waitAnalyze();
    expect($("[data-testid=preset-blocked]")).toBeNull();
    expect($("[data-testid=entry-inert]").textContent).toBe(t("preset.entry.inert", { settings: t("preset.setting.injection_order") }));
    mocks.revise.mockResolvedValue({ presetId: "p1", revisionId: "r3", version: 3 });
    $("[data-testid=preset-save]").click();
    await flush();
    const [, id, input, key] = mocks.revise.mock.calls[0]!;
    expect(id).toBe("p1");
    expect(input.expectedVersion).toBe(2);
    expect(input.document.selection.acceptedAdaptationIds).toEqual(["turn:move_to_suffix"]);
    expect(input.document.st.extensions).toEqual({ fixtureOnly: true });
    expect(typeof key).toBe("string");
  });

  it("別處先存了新版本：草稿留著，再按一次以最新版本為基準存", async () => {
    await open();
    $<HTMLInputElement>("[data-testid=preset-title]").value = "新名字";
    $("[data-testid=preset-title]").dispatchEvent(new Event("input"));
    toggleOf("腳本").click();
    toggleOf("回應玩家").click();
    await waitAnalyze();
    mocks.revise.mockRejectedValueOnce(new ApiError(409, "x", "preset_conflict", undefined, "preset_revision_conflict"));
    mocks.detail.mockResolvedValue(detail({ version: 4 }));
    $("[data-testid=preset-save]").click();
    await flush();
    expect($("[data-testid=preset-conflict]").textContent).toContain(t("preset.error.revisionConflict"));
    expect($<HTMLInputElement>("[data-testid=preset-title]").value).toBe("新名字");
    $("[data-testid=preset-conflict] button").click();
    await flush();
    mocks.revise.mockResolvedValue({ presetId: "p1", revisionId: "r5", version: 5 });
    $("[data-testid=preset-save]").click();
    await flush();
    expect(mocks.revise.mock.calls[1]![2].expectedVersion).toBe(4);
    expect(mocks.revise.mock.calls[1]![3]).not.toBe(mocks.revise.mock.calls[0]![3]);
  });
  it("送出後沒收到回應：顯示正在確認，用同一把鍵再送，拿回原本那一版", async () => {
    await open();
    toggleOf("腳本").click();
    toggleOf("回應玩家").click();
    await waitAnalyze();
    mocks.revise.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({ presetId: "p1", revisionId: "r3", version: 3 });
    $("[data-testid=preset-save]").click();
    await flush();
    expect(root.textContent).toContain(t("preset.editor.saveUnconfirmed"));
    await new Promise((r) => setTimeout(r, 2100));
    await flush();
    expect(mocks.revise).toHaveBeenCalledTimes(2);
    expect(mocks.revise.mock.calls[1]![3]).toBe(mocks.revise.mock.calls[0]![3]);
    expect(root.textContent).toContain(t("preset.editor.saved", { n: 3 }));
  });
});

describe("預設編輯器：版本紀錄", () => {
  it("存好新版本後，版本紀錄馬上列出新的一版並標成最新", async () => {
    const d = doc(); d.selection.excludedEntryIds = ["script"]; d.selection.acceptedAdaptationIds = ["turn:move_to_suffix"];
    mocks.detail.mockResolvedValueOnce(detail());
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r2", presetId: "p1", version: 2, document: d, sourceKind: "imported", compilerVersion: "", contentHash: "", recommendedModels: [], createdAt: "" }, compatibility: compat() });
    mocks.analyze.mockImplementation(async () => compat());
    await mount(PresetEditorPage, "/me/presets/p1");
    $<HTMLInputElement>("[data-testid=preset-title]").value = "改名";
    $("[data-testid=preset-title]").dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 600)); await flush();
    mocks.revise.mockResolvedValue({ presetId: "p1", revisionId: "r3", version: 3 });
    mocks.detail.mockResolvedValue(detail({ version: 3, headRevisionId: "r3", revisions: [{ revisionId: "r3", version: 3, title: "改名", createdAt: "2026-10-29T01:00:00Z", enabledEntryCount: 2 }, ...detail().revisions] }));
    $("[data-testid=preset-save]").click();
    await flush(); await flush();
    const items = $$("[data-testid=preset-versions] li").map((li) => li.textContent ?? "");
    expect(items[0]).toContain("v3");
    expect(items[0]).toContain(t("preset.versions.current"));
  });
});

describe("預設編輯器：英文版本紀錄", () => {
  it("單複數照條目數選，不照版本號（v1 啟用 6 條要寫 entries）", async () => {
    mocks.detail.mockResolvedValue(detail({ revisions: [{ revisionId: "r1", version: 1, title: "x", createdAt: "2026-10-28T00:00:00Z", enabledEntryCount: 6 }, { revisionId: "r2", version: 2, title: "x", createdAt: "2026-10-29T00:00:00Z", enabledEntryCount: 1 }] }));
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r2", presetId: "p1", version: 2, document: doc(), sourceKind: "imported", compilerVersion: "", contentHash: "", recommendedModels: [], createdAt: "" }, compatibility: compat() });
    await loadLocale("en");
    await mount(PresetEditorPage, "/me/presets/p1");
    i18n.global.locale.value = "en";
    await flush();
    const rows = $$("[data-testid=preset-versions] li").map((li) => li.textContent ?? "");
    expect(rows[0]).toContain("v1");
    expect(rows[0]).toContain("6 entries enabled");
    expect(rows[1]).toContain("1 entry enabled");
    i18n.global.locale.value = SOURCE_LOCALE;
  });
});

describe("預設編輯器：封存與匯入確認（QA N03／N04）", () => {
  it("封存的預設只能看：欄位、開關與存檔都停用，並說明已封存；列表不給編輯鈕", async () => {
    mocks.detail.mockResolvedValue(detail({ archived: true, allowedActions: ["archive"] }));
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r2", presetId: "p1", version: 2, document: doc(), sourceKind: "imported", compilerVersion: "", contentHash: "", recommendedModels: [], createdAt: "" }, compatibility: compat() });
    await mount(PresetEditorPage, "/me/presets/p1");
    expect(root.textContent).toContain(t("preset.error.archived"));
    // 欄位包在停用的 fieldset 裡（瀏覽器因此停用整組；測試環境不模擬這層，只驗結構）
    expect($("[data-testid=preset-title]").closest("fieldset")?.disabled).toBe(true);
    expect($<HTMLButtonElement>("[data-testid=preset-save]").disabled).toBe(true);
    expect($("[data-testid=entry-add]")).toBeNull();
    const row = $$("[data-testid=entry-row]")[0]!;
    expect((row.parentElement!.querySelector("input[type=checkbox]") as HTMLInputElement).disabled).toBe(true);
    row.click(); await flush();
    // 條目照樣能點開來看，內容不能改
    expect($("textarea").closest("fieldset")?.disabled).toBe(true);
  });

  it("封存的預設在列表裡沒有編輯鈕，點名稱打開是唯讀", async () => {
    mocks.list.mockResolvedValue({ items: [summary({ archived: true })], nextCursor: "", quota: { used: 1, limit: 50, archived: 1 } });
    await mount(PresetListPage, "/me/presets");
    $<HTMLInputElement>("[data-testid=preset-show-archived]").click(); await flush();
    const row = $("[data-testid=preset-row]");
    expect([...row.querySelectorAll("a.btn")].map((a) => a.textContent?.trim())).not.toContain(t("preset.row.edit"));
  });

  it("匯入後的確認只講一次：網址上的參數用完就拿掉", async () => {
    mocks.detail.mockResolvedValue(detail());
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r2", presetId: "p1", version: 2, document: doc(), sourceKind: "imported", compilerVersion: "", contentHash: "", recommendedModels: [], createdAt: "" }, compatibility: compat() });
    await mount(PresetEditorPage, "/me/presets/p1?imported=%E6%88%91%E7%9A%84");
    expect(root.textContent).toContain(t("preset.report.confirmed", { name: "我的" }));
    expect(router.currentRoute.value.fullPath).toBe("/me/presets/p1");
  });
});

describe("位置略有調整（上游自動調到最近的穩定位置，owner 2026-10-30）", () => {
  const relocatedCompat = (): Compatibility => ({ ...compat(), entries: [
    ...compat().entries.filter((e) => e.identifier !== "turn" && e.identifier !== "script"),
    { identifier: "turn", enabled: true, frameworkOwned: false, targetSlot: "S", uiStatus: "relocated", reasonCodes: ["dynamic_after_history"], availableAdaptationIds: [], inertSettings: [] },
    { identifier: "script", enabled: true, frameworkOwned: false, targetSlot: "P", uiStatus: "relocated", reasonCodes: ["relocated_before_history"], availableAdaptationIds: [], inertSettings: [] },
  ] });

  it("匯入報告分三類：可直接用、位置略有調整、不會執行；調整過的照常採用，不用玩家處理", async () => {
    await mount(PresetImportPage, "/me/presets/import");
    const d = doc();
    mocks.preview.mockResolvedValue({ previewId: "pv", version: 1, expiresAt: "", sourceHash: "s", selectionDigest: "dg1", document: d, report: relocatedCompat() });
    const input = $<HTMLInputElement>("[data-testid=import-file]");
    Object.defineProperty(input, "files", { value: [new File([JSON.stringify({ prompts: [{ identifier: "a" }], prompt_order: [{ character_id: 100001, order: [{ identifier: "a", enabled: true }] }] })], "p.json")], configurable: true });
    input.dispatchEvent(new Event("change")); await flush();
    const report = $("[data-testid=import-report]").textContent ?? "";
    expect(report).toContain(t("preset.report.summary.ok", { n: "1" }));
    expect(report).toContain(t("preset.report.summary.relocated", { n: "2" }));
    // 數量是 0 的類別整個不列
    expect(report).not.toContain(t("preset.report.summary.unsupported", { n: "0" }, 0));
    expect(report).toContain(t("preset.reason.entry.dynamic_after_history"));
    expect(report).toContain(t("preset.reason.entry.relocated_before_history"));
    // 沒有被排除、不用按確認調整：可以直接存
    expect(mocks.selection).not.toHaveBeenCalled();
    expect($("[data-testid=import-accept]")).toBeNull();
    expect($<HTMLButtonElement>("[data-testid=import-confirm]").disabled).toBe(false);
  });

  it("編輯器裡調整過的條目照調整後的位置列，標位置略有調整，不擋存檔", async () => {
    mocks.detail.mockResolvedValue(detail());
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r2", presetId: "p1", version: 2, document: doc(), sourceKind: "imported", compilerVersion: "preset-p1.2", contentHash: "h", recommendedModels: [], createdAt: "" }, compatibility: relocatedCompat() });
    mocks.analyze.mockImplementation(async () => relocatedCompat());
    await mount(PresetEditorPage, "/me/presets/p1");
    const groups = $$(".preset-editor__group");
    const before = groups.find((g) => g.textContent?.includes(t("preset.entries.group.before")))!;
    const after = groups.find((g) => g.textContent?.includes(t("preset.entries.group.after")))!;
    expect(before.textContent).toContain("腳本");
    expect(after.textContent).toContain("回應玩家");
    expect(after.textContent).toContain(t("preset.report.status.relocated"));
    $<HTMLInputElement>("[data-testid=preset-title]").value = "改名";
    $("[data-testid=preset-title]").dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 600)); await flush();
    expect($("[data-testid=preset-blocked]")).toBeNull();
    expect($<HTMLButtonElement>("[data-testid=preset-save]").disabled).toBe(false);
  });
});

describe("預設編輯器：匯入的不採用與新建", () => {
  it("匯入時列為不採用的條目算關著，不擋存檔；關掉匯入的條目只記不採用，來源不動", async () => {
    const d = doc(); d.selection.excludedEntryIds = ["script"];
    mocks.detail.mockResolvedValue(detail());
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r2", presetId: "p1", version: 2, document: d, sourceKind: "imported", compilerVersion: "", contentHash: "", recommendedModels: [], createdAt: "" }, compatibility: compat() });
    mocks.analyze.mockImplementation(async () => compat());
    await mount(PresetEditorPage, "/me/presets/p1");
    const row = $$("[data-testid=entry-row]").find((b) => b.textContent?.includes("回應玩家"))!;
    (row.parentElement!.querySelector("input[type=checkbox]") as HTMLInputElement).click();
    await new Promise((r) => setTimeout(r, 600)); await flush();
    expect($("[data-testid=preset-blocked]")).toBeNull();
    mocks.revise.mockResolvedValue({ presetId: "p1", revisionId: "r3", version: 3 });
    $("[data-testid=preset-save]").click();
    await flush();
    const sent = mocks.revise.mock.calls[0]![2].document;
    expect(sent.selection.excludedEntryIds).toEqual(["script", "turn"]);
    expect(sent.st.prompt_order[0].order.every((o: { enabled: boolean }) => o.enabled)).toBe(true);
  });

  it("新建存好之後換到預設的網址，之後有未存的修改離開時一樣會問", async () => {
    mocks.analyze.mockImplementation(async () => ({ ...compat(), entries: [] }));
    await mount(PresetEditorPage, "/me/presets/new");
    $<HTMLInputElement>("[data-testid=preset-title]").value = "新的";
    $("[data-testid=preset-title]").dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 600)); await flush();
    mocks.create.mockResolvedValue({ presetId: "p7", revisionId: "r1", version: 1 });
    mocks.detail.mockResolvedValue(detail({ id: "p7", version: 1 }));
    mocks.revision.mockImplementation(async () => ({ revision: { revisionId: "r1", presetId: "p7", version: 1, document: mocks.create.mock.calls[0]![1].document, sourceKind: "native", compilerVersion: "", contentHash: "", recommendedModels: [], createdAt: "" }, compatibility: { ...compat(), entries: [] } }));
    $("[data-testid=preset-save]").click();
    await flush(); await flush();
    expect(router.currentRoute.value.path).toBe("/me/presets/p7");
    $<HTMLInputElement>("[data-testid=preset-title]").value = "又改了";
    $("[data-testid=preset-title]").dispatchEvent(new Event("input"));
    await flush();
    mocks.confirm.mockClear();
    mocks.confirm.mockResolvedValue(false);
    await router.push("/me/presets");
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe("/me/presets/p7");
  });
});

describe("從 ST 匯入", () => {
  const file = (body: unknown) => new File([JSON.stringify(body)], "我的預設.json", { type: "application/json" });
  async function pick(body: unknown) {
    const input = $<HTMLInputElement>("[data-testid=import-file]");
    Object.defineProperty(input, "files", { value: [file(body)], configurable: true });
    input.dispatchEvent(new Event("change"));
    await flush();
  }
  const preview = (over: Partial<PresetDocument["selection"]> = {}, version = 1) => {
    const d = doc(); d.selection = { ...d.selection, ...over };
    return { previewId: "pv", version, expiresAt: "", sourceHash: "s", selectionDigest: `dg${version}`, document: d, report: importCompat() };
  };
  // 新匯入一律用新規則分析：插進對話記錄的條目自動調位置，不會再出現要玩家確認的狀態
  const importCompat = (): Compatibility => ({ ...compat(), compilerVersion: "preset-p1.2", reviewRequired: false, entries: compat().entries.map((e) => e.identifier === "turn"
    ? { ...e, uiStatus: "relocated", reasonCodes: ["dynamic_after_history"], availableAdaptationIds: [], adaptationId: undefined }
    : e) });

  // 酒館的預設常有一組空的排序（100000）和一組真正在用的（100001）：跟酒館一樣用有內容的那組（owner 2026-10-30）
  const fileOrder = (...ids: string[]) => ids.map((identifier) => ({ identifier, enabled: true }));
  const filePrompts = [{ identifier: "a", name: "甲", role: "system", content: "x" }, { identifier: "b", name: "乙", role: "system", content: "y" }, { identifier: "chatHistory", name: "Chat History", marker: true }];

  it("空的排序組不列；只有一組有內容就直接用那組讀檔，不讓玩家選", async () => {
    await mount(PresetImportPage, "/me/presets/import");
    mocks.preview.mockResolvedValue(preview());
    mocks.selection.mockImplementation(async (_t, _id, v, selection) => ({ ...preview(selection, v + 1) }));
    await pick({ prompts: filePrompts, prompt_order: [{ character_id: 100000, order: [] }, { character_id: 100001, order: fileOrder("a", "chatHistory", "b") }] });
    expect($("[data-testid=import-profile-step]")).toBeNull();
    expect(mocks.preview).toHaveBeenCalledWith("tok", expect.any(File), 100001);
    expect(mocks.selection.mock.calls[0]![3].excludedEntryIds).toEqual(["script"]);
    const report = $("[data-testid=import-report]").textContent ?? "";
    for (const key of ["preset.report.summary.ok", "preset.report.summary.relocated", "preset.report.summary.unsupported"]) expect(report).toContain(t(key, { n: "1" }));
    // 不生效的設定收成一行「n 項設定不生效」，點開才列原始鍵名
    const fieldsBox = $<HTMLDetailsElement>("[data-testid=import-fields]");
    expect(fieldsBox.tagName).toBe("DETAILS");
    expect(fieldsBox.open).toBe(false);
    expect(fieldsBox.querySelector("summary")!.textContent).toBe(t("preset.report.fields.summary", { n: "1" }, 1));
    expect(fieldsBox.textContent).toContain("extensions");
    expect($("[data-testid=import-accept]")).toBeNull();
    expect($<HTMLButtonElement>("[data-testid=import-confirm]").disabled).toBe(false);
  });

  it("多組都有內容時預選條目最多的那組，玩家可以換", async () => {
    await mount(PresetImportPage, "/me/presets/import");
    mocks.preview.mockResolvedValue(preview());
    await pick({ prompts: filePrompts, prompt_order: [{ character_id: 100000, order: fileOrder("a") }, { character_id: 100001, order: fileOrder("a", "chatHistory", "b") }] });
    const radios = $$("[data-testid=import-profile]") as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios.map((r) => r.checked)).toEqual([false, true]);
    expect($<HTMLButtonElement>("[data-testid=import-profile-confirm]").disabled).toBe(false);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("上線前建的預覽在上線後確認會被拒：請玩家重新選檔案，不叫他重新載入", async () => {
    await mount(PresetImportPage, "/me/presets/import");
    mocks.preview.mockResolvedValue(preview());
    mocks.confirmImport.mockRejectedValue(new ApiError(409, "x", "preset_conflict", undefined, "preset_revision_conflict"));
    await pick({ prompts: [], prompt_order: [{ character_id: 100001 }] });
    $("[data-testid=import-confirm]").click();
    await flush();
    expect(root.textContent).toContain(t("preset.import.expired"));
    expect(root.textContent).not.toContain(t("preset.error.revisionConflict"));
  });

  it("確認時帶最新的預覽版本與摘要，建好後打開編輯器", async () => {
    await mount(PresetImportPage, "/me/presets/import");
    mocks.preview.mockResolvedValue(preview({ excludedEntryIds: ["script"], acceptedAdaptationIds: ["turn:move_to_suffix"] }));
    mocks.confirmImport.mockResolvedValue({ presetId: "p9", revisionId: "r1", version: 1 });
    mocks.detail.mockResolvedValue(detail({ id: "p9" }));
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r1", presetId: "p9", version: 1, document: doc(), sourceKind: "imported", compilerVersion: "", contentHash: "", recommendedModels: [], createdAt: "" }, compatibility: compat() });
    await pick({ prompts: [], prompt_order: [{ character_id: 100001 }] });
    expect($<HTMLInputElement>("[data-testid=import-title]").value).toBe("我的預設");
    $("[data-testid=import-confirm]").click();
    await flush();
    expect(mocks.confirmImport).toHaveBeenCalledWith("tok", "pv", { expectedPreviewVersion: 1, selectionDigest: "dg1", title: "我的預設", recommendedModels: [] }, expect.any(String));
    expect(router.currentRoute.value.path).toBe("/me/presets/p9");
    await flush();
    expect(root.textContent).toContain(t("preset.report.confirmed", { name: "我的預設" }));
  });

  it("不是 ST 預設的檔案在本機就擋下，不上傳", async () => {
    await mount(PresetImportPage, "/me/presets/import");
    await pick({ spec: "chara_card_v2", data: { name: "x" } });
    expect($("[data-testid=import-file-error]").textContent).toBe(t("preset.error.format"));
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});

describe("重新授權", () => {
  it("剛同意完回來還是缺權限，就不再請他同意，照一般錯誤講", async () => {
    sessionStorage.setItem("hearthroom.presetConsentAskedAt", String(Date.now()));
    mocks.list.mockRejectedValue(new ApiError(403, t("preset.error.scope"), "insufficient_scope"));
    await mount(PresetListPage, "/me/presets");
    expect($("[data-testid=preset-reauth]")).toBeNull();
    expect(root.textContent).toContain(t("preset.list.loadFailed"));
    sessionStorage.removeItem("hearthroom.presetConsentAskedAt");
  });
});

describe("用工具回覆（預設關，匯入不自動打開；PM 2026-10-30）", () => {
  const toolCompat = (enabled: boolean): Compatibility => ({ ...compat(), compilerVersion: "preset-p1.3", reviewRequired: false,
    entries: compat().entries.filter((e) => e.identifier !== "turn" && e.identifier !== "script"),
    fields: [{ path: "extensions", uiStatus: "unsupported", reasonCodes: ["external_tools_not_executed", "external_scripts_not_executed"], inertSettings: ["extensions"] }],
    toolReply: { enabled, externalToolBindingsDetected: true } });

  it("匯入報告：來源用擴充功能的工具回覆時只提示、開關關著；玩家打開才帶 toolReply；擴充功能的工具與程式寫明不會執行", async () => {
    await mount(PresetImportPage, "/me/presets/import");
    const d = doc();
    mocks.preview.mockResolvedValue({ previewId: "pv", version: 1, expiresAt: "", sourceHash: "s", selectionDigest: "dg1", document: d, report: toolCompat(false) });
    mocks.selection.mockImplementation(async (_t, _id, v, selection) => ({ previewId: "pv", version: v + 1, expiresAt: "", sourceHash: "s", selectionDigest: `dg${v + 1}`, document: { ...d, selection }, report: toolCompat(!!selection.toolReply) }));
    const input = $<HTMLInputElement>("[data-testid=import-file]");
    Object.defineProperty(input, "files", { value: [new File([JSON.stringify({ prompts: [{ identifier: "a" }], prompt_order: [{ character_id: 100001, order: [{ identifier: "a", enabled: true }] }] })], "p.json")], configurable: true });
    input.dispatchEvent(new Event("change")); await flush();
    const toggle = $<HTMLInputElement>("[data-testid=preset-tool-reply-toggle]");
    expect(toggle.checked).toBe(false);
    expect($("[data-testid=preset-tool-reply-detected]").textContent).toBe(t("preset.toolReply.detected"));
    const fields = $("[data-testid=import-fields]").textContent ?? "";
    expect(fields).toContain(t("preset.reason.field.external_tools_not_executed", { name: "extensions" }));
    expect(fields).toContain(t("preset.reason.field.external_scripts_not_executed", { name: "extensions" }));
    // 偵測到擴充功能的工具：開關和提示排在摘要正下方、條目清單之前，玩家不用捲到底才看到
    const tool = $("[data-testid=preset-tool-reply]");
    const entries = $(".preset-import__entries");
    expect(tool.compareDocumentPosition(entries) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    toggle.click(); await flush();
    expect(mocks.selection.mock.calls.at(-1)![3].toolReply).toBe(true);
    expect($<HTMLInputElement>("[data-testid=preset-tool-reply-toggle]").checked).toBe(true);
    // 已經打開了，「想用的話打開」的提示就收起來
    expect($("[data-testid=preset-tool-reply-detected]")).toBeNull();
  });

  it("編輯頁：開關照文件的選擇；改了算未存，存檔帶 toolReply；沒偵測到外掛工具就不提示", async () => {
    const d = doc();
    mocks.detail.mockResolvedValue(detail());
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r2", presetId: "p1", version: 2, document: d, sourceKind: "imported", compilerVersion: "preset-p1.3", contentHash: "h", recommendedModels: [], createdAt: "" }, compatibility: { ...toolCompat(false), toolReply: { enabled: false, externalToolBindingsDetected: false } } });
    mocks.analyze.mockImplementation(async () => ({ ...toolCompat(false), toolReply: { enabled: false, externalToolBindingsDetected: false } }));
    await mount(PresetEditorPage, "/me/presets/p1");
    const toggle = $<HTMLInputElement>("[data-testid=preset-tool-reply-toggle]");
    expect(toggle.checked).toBe(false);
    expect($("[data-testid=preset-tool-reply-detected]")).toBeNull();
    toggle.click();
    // 改了就重新分析一次，分析完才能存
    await new Promise((r) => setTimeout(r, 600)); await flush();
    expect($<HTMLButtonElement>("[data-testid=preset-save]").disabled).toBe(false);
    mocks.revise.mockResolvedValue({ presetId: "p1", revisionId: "r3", version: 3 });
    $("[data-testid=preset-save]").click(); await flush();
    expect(mocks.revise.mock.calls[0]![2].document.selection.toolReply).toBe(true);
  });

  it("舊版本的報告沒有工具回覆資訊：開關照文件（缺省＝關），不提示", async () => {
    mocks.detail.mockResolvedValue(detail());
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r2", presetId: "p1", version: 2, document: doc(), sourceKind: "imported", compilerVersion: "preset-p1.1", contentHash: "h", recommendedModels: [], createdAt: "" }, compatibility: compat() });
    mocks.analyze.mockImplementation(async () => compat());
    await mount(PresetEditorPage, "/me/presets/p1");
    expect($<HTMLInputElement>("[data-testid=preset-tool-reply-toggle]").checked).toBe(false);
    expect($("[data-testid=preset-tool-reply-detected]")).toBeNull();
  });
});

describe("回覆工具格式（用工具回覆打開時顯示；PM 2026-10-30）", () => {
  const tool = { name: "submit_reply", description: "Submit the full reply.", parameters: { type: "object", properties: { body: { type: "string", description: "The complete reply text." } }, required: ["body"] }, example: { name: "submit_reply", arguments: { body: "Example reply." } } };
  const report = (enabled: boolean, withTool = true): Compatibility => ({ ...compat(), compilerVersion: "preset-p1.3", reviewRequired: false,
    entries: compat().entries.filter((e) => e.identifier !== "turn" && e.identifier !== "script"), fields: [],
    toolReply: { enabled, externalToolBindingsDetected: false, ...(withTool ? { tool } : {}) } });
  async function open(enabled: boolean, withTool = true) {
    const d = doc(); d.selection.toolReply = enabled;
    mocks.detail.mockResolvedValue(detail());
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r2", presetId: "p1", version: 2, document: d, sourceKind: "imported", compilerVersion: "preset-p1.3", contentHash: "h", recommendedModels: [], createdAt: "" }, compatibility: report(enabled, withTool) });
    mocks.analyze.mockImplementation(async () => report(enabled, withTool));
    await mount(PresetEditorPage, "/me/presets/p1");
  }

  it("打開時照上游給的原樣列出工具名、參數說明與呼叫示例，複製整塊", async () => {
    await open(true);
    const box = $("[data-testid=preset-tool-format]");
    expect(box.textContent).toContain(t("preset.toolReply.format.title"));
    expect(box.textContent).toContain("submit_reply");
    expect(box.textContent).toContain("body");
    expect(box.textContent).toContain("The complete reply text.");
    expect(box.querySelector("pre")!.textContent).toBe(JSON.stringify(tool.example, null, 2));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    box.querySelector<HTMLButtonElement>("[data-testid=preset-tool-format-copy]")!.click();
    await flush();
    const copied = JSON.parse(writeText.mock.calls[0]![0] as string);
    expect(copied).toEqual({ name: "submit_reply", description: "Submit the full reply.", parameters: tool.parameters, example: tool.example });
    expect(box.querySelector("[data-testid=preset-tool-format-copy]")!.textContent).toContain(t("me.copied"));
  });

  it("關著不顯示；上游沒給格式（舊版本）也不顯示", async () => {
    await open(false);
    expect($("[data-testid=preset-tool-format]")).toBeNull();
    app?.unmount(); root?.remove();
    await open(true, false);
    expect($("[data-testid=preset-tool-format]")).toBeNull();
  });
});

describe("溫度偏高提示（owner 2026-10-30：只提示，不擋、不改值）", () => {
  async function openWith(temperature: number) {
    const d = doc(); (d.st as Record<string, unknown>).temperature = temperature;
    const c = (): Compatibility => ({ ...compat(), entries: compat().entries.filter((e) => e.identifier !== "turn" && e.identifier !== "script"), fields: [] });
    mocks.detail.mockResolvedValue(detail());
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r2", presetId: "p1", version: 2, document: d, sourceKind: "imported", compilerVersion: "preset-p1.3", contentHash: "h", recommendedModels: [], createdAt: "" }, compatibility: c() });
    mocks.analyze.mockImplementation(async () => c());
    await mount(PresetEditorPage, "/me/presets/p1");
  }

  it("溫度大於 1.5 時欄位下面一行提示，數值不變", async () => {
    await openWith(1.8);
    const field = $("[data-testid=param-temperature]");
    expect(field.querySelector("[data-testid=param-temperature-high]")!.textContent).toBe(t("preset.params.temperature.high"));
    expect(field.querySelector<HTMLInputElement>("input[type=number]")!.value).toBe("1.8");
  });

  it("1.5 以下不提示", async () => {
    await openWith(1.5);
    expect($("[data-testid=param-temperature-high]")).toBeNull();
  });
});

describe("條目拖曳排序（owner 2026-10-30：桌機直接拖、手機長按把手拖）", () => {
  // jsdom 沒有版面：照 data 屬性給每一區、每一列一個位置
  const RECTS: Record<string, [number, number]> = { "side:before": [0, 100], "side:after": [100, 200], clear: [10, 50], script: [50, 90], turn: [110, 150] };
  function layout() {
    return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      const key = el.dataset?.dropSide ? `side:${el.dataset.dropSide}` : el.dataset?.dragId ?? "";
      const [top, bottom] = RECTS[key] ?? [0, 0];
      return { top, bottom, height: bottom - top, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  }
  const pointer = (type: string, y: number, pointerType = "mouse") => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: y, button: 0 });
    Object.defineProperty(e, "pointerType", { value: pointerType });
    return e;
  };
  const handleOf = (name: string) => $$("[data-testid=entry-row]").find((b) => b.textContent?.includes(name))!.parentElement!.querySelector("[data-testid=entry-drag]")!;
  const names = () => $$("[data-testid=entry-row]").map((b) => b.querySelector(".preset-editor__rowName")!.textContent);
  async function open() {
    const c = (): Compatibility => ({ ...compat(), entries: compat().entries.filter((e) => e.identifier !== "script" && e.identifier !== "turn"), fields: [] });
    mocks.detail.mockResolvedValue(detail());
    mocks.revision.mockResolvedValue({ revision: { revisionId: "r2", presetId: "p1", version: 2, document: doc(), sourceKind: "imported", compilerVersion: "preset-p1.3", contentHash: "h", recommendedModels: [], createdAt: "" }, compatibility: c() });
    mocks.analyze.mockImplementation(async () => c());
    await mount(PresetEditorPage, "/me/presets/p1");
  }

  it("桌機：按住把手拖到另一條前面就換位置，可以越過聊天歷史，照常存檔", async () => {
    await open();
    const spy = layout();
    expect(names()).toEqual(["清楚敘述", "腳本", "回應玩家"]);
    handleOf("回應玩家").dispatchEvent(pointer("pointerdown", 130));
    window.dispatchEvent(pointer("pointermove", 60));
    await flush();
    // 拖曳中在落點那一列上面畫一條線
    expect($$("[data-testid=entry-row]").find((b) => b.textContent?.includes("腳本"))!.parentElement!.classList.contains("is-drop-before")).toBe(true);
    window.dispatchEvent(pointer("pointerup", 60));
    await flush();
    expect(names()).toEqual(["清楚敘述", "回應玩家", "腳本"]);
    spy.mockRestore();
    await new Promise((r) => setTimeout(r, 600)); await flush();
    mocks.revise.mockResolvedValue({ presetId: "p1", revisionId: "r3", version: 3 });
    $("[data-testid=preset-save]").click(); await flush();
    const order = (mocks.revise.mock.calls[0]![2].document.st.prompt_order as { character_id: number; order: { identifier: string }[] }[]).find((g) => g.character_id === 100001)!.order.map((o) => o.identifier);
    expect(order.indexOf("turn")).toBeLessThan(order.indexOf("chatHistory"));
    expect(order.indexOf("turn")).toBeLessThan(order.indexOf("script"));
  });

  it("手機：長按把手才開始拖；長按前手指先動就是捲動，不拖", async () => {
    await open();
    const spy = layout();
    vi.useFakeTimers();
    try {
      handleOf("清楚敘述").dispatchEvent(pointer("pointerdown", 30, "touch"));
      window.dispatchEvent(pointer("pointermove", 60, "touch"));
      vi.advanceTimersByTime(400);
      window.dispatchEvent(pointer("pointerup", 180, "touch"));
      await flush();
      expect(names()).toEqual(["清楚敘述", "腳本", "回應玩家"]);

      handleOf("清楚敘述").dispatchEvent(pointer("pointerdown", 30, "touch"));
      vi.advanceTimersByTime(350);
      window.dispatchEvent(pointer("pointermove", 180, "touch"));
      window.dispatchEvent(pointer("pointerup", 180, "touch"));
      await flush();
      expect(names()).toEqual(["腳本", "回應玩家", "清楚敘述"]);
    } finally { vi.useRealTimers(); spy.mockRestore(); }
  });

  it("按 Esc 取消，不動順序；搜尋中沒有把手", async () => {
    await open();
    const spy = layout();
    handleOf("回應玩家").dispatchEvent(pointer("pointerdown", 130));
    window.dispatchEvent(pointer("pointermove", 20));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(pointer("pointerup", 20));
    await flush();
    expect(names()).toEqual(["清楚敘述", "腳本", "回應玩家"]);
    spy.mockRestore();
    const search = $<HTMLInputElement>("[data-testid=entry-search]");
    search.value = "清楚"; search.dispatchEvent(new Event("input")); await flush();
    expect($("[data-testid=entry-drag]")).toBeNull();
  });
});
