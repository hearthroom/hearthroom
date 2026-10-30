import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n, loadLocale, SOURCE_LOCALE } from "../src/lib/i18n";
import { setProvider } from "../src/lib/provider";
import {
  InstructionSetError, charCount, checkInstructionSet, deleteConsequence, deleteInstructionSet, listInstructionSets, saveInstructionSet,
  type InstructionSet,
} from "../src/lib/instruction-sets";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), token: vi.fn() }));
// 真的 session 會牽到舞台的原始碼（這個 worktree 的 stage/ 是空的）；這一頁只用到它的 accessToken
vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: mocks.token }) }));
vi.mock("../src/lib/confirm", async (original) => ({ ...(await original<typeof import("../src/lib/confirm")>()), confirmDialog: mocks.confirm }));

const calls: { url: string; init: RequestInit }[] = [];
let reply: (url: string) => Response;
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return reply(url); }));
});
afterEach(() => vi.unstubAllGlobals());

const set = (over: Partial<InstructionSet> = {}): InstructionSet => ({
  presetId: "p1", title: "睡前輕鬆", items: ["回覆短一點", "不要替我決定"], cardCount: 2, lastUpdateTime: "2026-10-31T00:00:00Z", ...over,
});
const LIMITS = { maxCount: 20, maxItems: 10, maxLength: 200, maxTitle: 40 };

describe("長期指令組 API", () => {
  it("列表帶 token、照回傳的上限，不用寫死的數字", async () => {
    reply = () => ok({ list: [set()], maxCount: 5, maxItems: 3, maxLength: 50, maxTitle: 12 });
    const got = await listInstructionSets("tok");
    expect(calls[0]!.url).toMatch(/\/open\/v1\/player\/directive-presets$/);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(got).toMatchObject({ maxCount: 5, maxItems: 3, maxLength: 50, maxTitle: 12, list: [{ presetId: "p1", cardCount: 2, items: ["回覆短一點", "不要替我決定"] }] });
  });

  it("新增不帶 presetId、修改帶；名稱與條目去掉前後空白再送", async () => {
    reply = () => ok({ success: "ok", preset: set({ cardCount: 0 }) });
    await saveInstructionSet("tok", { title: " 睡前 ", items: [" a ", "b"] });
    await saveInstructionSet("tok", { presetId: "p1", title: "睡前", items: ["a"] });
    expect(calls[0]!.url).toMatch(/\/open\/v1\/player\/directive-preset\/save$/);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ title: "睡前", items: ["a", "b"] });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ presetId: "p1", title: "睡前", items: ["a"] });
  });

  it("刪除送 presetId", async () => {
    reply = () => ok({ success: "ok" });
    await deleteInstructionSet("tok", "p9");
    expect(calls[0]!.url).toMatch(/\/open\/v1\/player\/directive-preset\/delete$/);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ presetId: "p9" });
  });

  it("單條錯誤帶回碼與第幾條；其他錯誤照共用的錯誤處理", async () => {
    reply = () => ok({ error: "DIRECTIVE_INVALID_CHARS", detail: { index: 1 } }, 400);
    const err = await saveInstructionSet("tok", { title: "x", items: ["a", "<b>"] }).catch((e) => e);
    expect(err).toBeInstanceOf(InstructionSetError);
    expect(err).toMatchObject({ code: "DIRECTIVE_INVALID_CHARS", index: 1, status: 400 });

    reply = () => ok({ error: "DIRECTIVE_PRESET_LIMIT_REACHED" }, 400);
    expect(await saveInstructionSet("tok", { title: "x", items: ["a"] }).catch((e) => e)).toMatchObject({ code: "DIRECTIVE_PRESET_LIMIT_REACHED", index: undefined });

    reply = () => ok({ error: "unauthorized" }, 401);
    const other = await listInstructionSets("tok").catch((e) => e);
    expect(other).not.toBeInstanceOf(InstructionSetError);
    expect(other).toMatchObject({ status: 401, code: "unauthorized" });
  });
});

describe("長期指令組的輸入檢查", () => {
  it("與伺服器同一套：去空白後 1–上限字、不含 < >、1–上限條、名稱 1–上限字", () => {
    expect(checkInstructionSet("睡前", ["a", "b"], LIMITS).ok).toBe(true);
    expect(checkInstructionSet("  ", ["a"], LIMITS).title).toBe("empty");
    expect(checkInstructionSet("名".repeat(41), ["a"], LIMITS).title).toBe("tooLong");
    expect(checkInstructionSet("名".repeat(40), ["a"], LIMITS).ok).toBe(true);
    expect(checkInstructionSet("x", [" ", "字".repeat(201), "a<b", "a>b", "字".repeat(200)], LIMITS).items).toEqual(["empty", "tooLong", "chars", "chars", null]);
    expect(checkInstructionSet("x", [], LIMITS)).toMatchObject({ count: "none", ok: false });
    expect(checkInstructionSet("x", Array(11).fill("a"), LIMITS)).toMatchObject({ count: "tooMany", ok: false });
  });

  it("字數照字元算：emoji 算一個字，跟伺服器一樣", () => {
    expect(charCount("😀😀")).toBe(2);
    expect(checkInstructionSet("x", ["😀".repeat(200)], LIMITS).ok).toBe(true);
    expect(checkInstructionSet("x", ["😀".repeat(201)], LIMITS).items).toEqual(["tooLong"]);
  });

  it("刪除確認的後果句：有卡在用講張數，沒有就只講既有存檔不受影響", async () => {
    expect(deleteConsequence(2)).toEqual({ key: "instructions.delete.body.used", n: 2 });
    expect(deleteConsequence(0)).toEqual({ key: "instructions.delete.body.unused", n: 0 });
    await loadLocale("en");
    i18n.global.locale.value = "en";
    const one = deleteConsequence(1);
    expect(i18n.global.t(one.key, { n: one.n }, one.n)).toMatch(/^1 card adds it/);
    i18n.global.locale.value = SOURCE_LOCALE;
  });
});

describe("長期指令頁", () => {
  let app: ReturnType<typeof createApp> | undefined;
  let root: HTMLElement;
  afterEach(() => { app?.unmount(); root?.remove(); document.body.innerHTML = ""; vi.clearAllMocks(); });
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); await nextTick(); };
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
  const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
  const t = (key: string, values: Record<string, unknown> = {}, n?: number) => (n === undefined ? i18n.global.t(key, values) : i18n.global.t(key, values, n));

  async function mount(list: InstructionSet[], extra: Partial<typeof LIMITS> = {}) {
    setProvider("harbor");
    i18n.global.locale.value = SOURCE_LOCALE;
    mocks.confirm.mockResolvedValue(true);
    reply = (url) => url.endsWith("/directive-presets") ? ok({ list, ...LIMITS, ...extra }) : ok({ success: "ok", preset: list[0] });
    mocks.token.mockResolvedValue("tok");
    const { default: Page } = await import("../src/pages/InstructionSetsPage.vue");
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: Page }] });
    await router.push("/me/instructions");
    root = document.createElement("div"); document.body.append(root);
    app = createApp({ template: "<RouterView />" }).use(router).use(i18n);
    app.mount(root);
    await flush();
  }

  it("列表：meta 行、前三條預覽與「還有 N 條」、沒卡在用時寫出口", async () => {
    await mount([set({ items: ["a", "b", "c", "d", "e"] }), set({ presetId: "p2", title: "慢熱", items: ["x"], cardCount: 0 })]);
    const rows = $$("[data-testid=instructions-row]");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector("[data-testid=instructions-meta]")!.textContent).toBe(`${t("instructions.meta.items", { n: "5" }, 5)} · ${t("instructions.meta.used", { m: "2" }, 2)}`);
    expect(rows[0]!.querySelectorAll("ol li")).toHaveLength(3);
    expect(rows[0]!.querySelector("[data-testid=instructions-more]")!.textContent!.trim()).toBe(t("instructions.preview.more", { n: "2" }, 2));
    expect(rows[1]!.querySelector("[data-testid=instructions-meta]")!.textContent).toBe(`${t("instructions.meta.items", { n: "1" }, 1)} · ${t("instructions.meta.unused")}`);
    expect(rows[1]!.textContent).toContain(t("instructions.unusedHint"));
    expect(rows[0]!.textContent).not.toContain(t("instructions.unusedHint"));
  });

  it("空態有蘇綺與新增鈕；到上限時新增停用並寫出上限", async () => {
    await mount([]);
    expect($("[data-testid=instructions-empty]")).toBeTruthy();
    expect($("[data-testid=instructions-empty] img")).toBeTruthy();
    app!.unmount(); root.remove();
    await mount([set(), set({ presetId: "p2" })], { maxCount: 2 });
    expect($<HTMLButtonElement>("[data-testid=instructions-new]").disabled).toBe(true);
    expect($("[data-testid=instructions-limit]").textContent).toBe(t("instructions.limit", { max: "2" }));
  });

  it("刪除確認依 cardCount 選後果句，取消是預設焦點", async () => {
    await mount([set({ cardCount: 3 }), set({ presetId: "p2", title: "慢熱", cardCount: 0 })]);
    $$("[data-testid=instructions-edit]")[0]!.click(); await flush();
    $("[data-testid=instruction-delete]").click(); await flush();
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({
      title: t("instructions.delete.title", { name: "睡前輕鬆" }), message: t("instructions.delete.body.used", { n: "3" }, 3), danger: true, focusCancel: true,
    }));
    expect(calls.at(-1)!.url).toMatch(/directive-preset\/delete$/);
    expect($$("[data-testid=instructions-row]")).toHaveLength(1);

    $$("[data-testid=instructions-edit]")[0]!.click(); await flush();
    mocks.confirm.mockResolvedValueOnce(false);
    $("[data-testid=instruction-delete]").click(); await flush();
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ message: t("instructions.delete.body.unused") }));
    expect($("[data-testid=instruction-editor]")).toBeTruthy();
  });

  it("伺服器退回某一條：原因放在那一條底下，輸入保留", async () => {
    await mount([set()]);
    $("[data-testid=instructions-edit]").click(); await flush();
    const area = $$("[data-testid=instruction-item] textarea")[1] as HTMLTextAreaElement;
    area.value = "改過"; area.dispatchEvent(new Event("input")); await flush();
    reply = () => ok({ error: "DIRECTIVE_TOO_LONG", detail: { index: 1 } }, 400);
    $("[data-testid=instruction-save]").click(); await flush();
    const errors = $$("[data-testid=instruction-item-error]").map((e) => e.textContent);
    expect(errors).toEqual(["", t("instructions.item.tooLong", { max: "200" })]);
    expect(($$("[data-testid=instruction-item] textarea")[1] as HTMLTextAreaElement).value).toBe("改過");
  });

  it("前端檢查擋住 < >，沒改過不能存；未存就關要確認放棄", async () => {
    await mount([set()]);
    $("[data-testid=instructions-edit]").click(); await flush();
    expect($<HTMLButtonElement>("[data-testid=instruction-save]").disabled).toBe(true);
    const area = $$("[data-testid=instruction-item] textarea")[0] as HTMLTextAreaElement;
    area.value = "<b>"; area.dispatchEvent(new Event("input")); await flush();
    expect($$("[data-testid=instruction-item-error]")[0]!.textContent).toBe(t("instructions.item.chars"));
    expect($<HTMLButtonElement>("[data-testid=instruction-save]").disabled).toBe(true);
    mocks.confirm.mockResolvedValueOnce(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await flush();
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: t("instructions.discard.title"), focusCancel: true }));
    expect($("[data-testid=instruction-editor]")).toBeTruthy();
  });
});
