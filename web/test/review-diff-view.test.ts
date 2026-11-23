import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { applyLocale, i18n } from "../src/lib/i18n";
import type { ReviewDiff, ReviewDiffSummary } from "../src/lib/api";

const mock = vi.hoisted(() => ({ result: null as unknown, fail: null as unknown, calls: 0 }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: async () => "fixture" }) }));
vi.mock("../src/lib/api", async (original) => ({
  ...(await original<object>()),
  fetchReviewDiff: async () => { mock.calls++; if (mock.fail) { const f = mock.fail; mock.fail = null; throw f; } return mock.result; },
}));
import ReviewDiffView from "../src/components/ReviewDiffView.vue";
import { ApiError } from "../src/lib/api";

// 審卡 V2 第二批：更新差異。改動標示不靠顏色（底線／刪除線＋讀屏字），沒改的段落收起，讀不到可以重試。
let app: App | null = null;
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = ""; mock.fail = null; mock.calls = 0; });
beforeEach(async () => { await applyLocale("zh-Hant"); });
const t = (k: string, n?: Record<string, unknown>, p?: number) => (p !== undefined ? i18n.global.t(k, n ?? {}, p) : n ? i18n.global.t(k, n) : i18n.global.t(k));
const flush = async () => { for (let i = 0; i < 4; i++) { await nextTick(); await new Promise((r) => setTimeout(r)); } };
async function mount(props: Record<string, unknown> = {}) {
  const el = document.createElement("div"); document.body.append(el);
  app = createApp(ReviewDiffView, { submissionId: "s2", ...props }).use(i18n); app.mount(el);
  await flush();
  return el;
}
const summary = (o: Partial<ReviewDiffSummary> = {}): ReviewDiffSummary => ({
  changedFields: ["setting", "opening"], setting: { charsAdded: 86, charsRemoved: 3 }, opening: { changed: true, charsBefore: 40, charsAfter: 120 },
  worldbook: { added: 2, removed: 0, modified: 1 }, rules: { added: 0, removed: 0, modified: 0 }, tags: { added: 1, removed: 0 }, totalChanged: 210, unchanged: false, ...o,
});
const unchangedLines = Array.from({ length: 14 }, (_, i) => `第${i + 1}段`).join("\n");
const diff = (o: Partial<ReviewDiff> = {}): ReviewDiff => ({
  summary: summary(),
  fields: [
    { key: "setting", before: `${unchangedLines}\n舊的結尾`, after: `${unchangedLines}\n新的結尾` },
    { key: "opening", before: "", after: "雨夜裡你推開門。" },
  ],
  worldbook: {
    added: [{ name: "港口", content: "港口終年起霧。", keywords: ["港"], isEnabled: true, isConstant: false }],
    removed: [],
    modified: [{ before: { name: "城門", content: "城門酉時關。", keywords: [], isEnabled: true, isConstant: false }, after: { name: "城門", content: "城門子時關。", keywords: [], isEnabled: true, isConstant: true } }],
  },
  rules: { added: 0, removed: 1, modified: 0, items: [{ change: "removed", label: "隱藏旁白" }] },
  ...o,
});

it("ready：基準、摘要 chip、整體字數；新增有底線、刪除有刪除線，讀屏也念得出來", async () => {
  mock.result = { state: "ready", baseKind: "approved", diff: diff() };
  const el = await mount();
  expect(el.querySelector("[data-diff-base]")!.textContent).toBe(t("reviewV2.diff.base.approved"));
  const chips = [...el.querySelectorAll("[data-diff-chips] li")].map((c) => c.textContent);
  expect(chips).toEqual([
    t("reviewV2.diff.chip.setting", { a: "86", d: "3" }),
    t("reviewV2.diff.chip.opening"),
    t("reviewV2.diff.chip.worldbook", { a: "2", m: "1", d: "0" }),
    t("reviewV2.diff.chip.tags", { a: "1" }),
  ]);
  // 規則沒改就不出 chip；封面不比，也不寫「沒改」
  expect(el.textContent).not.toContain(t("reviewV2.diff.chip.rules", { a: "0", m: "0", d: "0" }));
  expect(el.querySelector("[data-diff-total]")!.textContent).toBe(t("reviewV2.diff.total", { n: "210" }, 210));

  const setting = el.querySelector('[data-diff-field="setting"]')!;
  expect(setting.querySelector("h4")!.textContent).toBe(t("editor.detail"));
  const added = setting.querySelector('[data-diff-line="add"] ins')!;
  const removed = setting.querySelector('[data-diff-line="del"] del')!;
  expect(added.textContent).toBe(`${t("reviewV2.diff.added")}新的結尾`);
  expect(removed.textContent).toBe(`${t("reviewV2.diff.removed")}舊的結尾`);
  expect(added.querySelector(".sr-only")!.textContent).toBe(t("reviewV2.diff.added"));
  expect(removed.querySelector(".sr-only")!.textContent).toBe(t("reviewV2.diff.removed"));
  expect(el.querySelector('[data-diff-field="opening"] h4')!.textContent).toBe(t("editor.welcome"));

  // 世界書與規則：每一條都有文字標示
  const entries = [...el.querySelectorAll("[data-diff-entry]")];
  expect(entries.map((e) => e.getAttribute("data-diff-entry"))).toEqual(["modified", "added"]);
  expect(entries[0]!.querySelector(".rd__change")!.textContent).toBe(t("reviewV2.diff.edited"));
  expect(entries[0]!.querySelector('[data-diff-line="del"]')!.textContent).toContain("城門酉時關。");
  expect(entries[0]!.querySelector('[data-diff-line="add"]')!.textContent).toContain("城門子時關。");
  expect(entries[1]!.querySelector(".rd__change")!.textContent).toBe(t("reviewV2.diff.added"));
  const rule = el.querySelector('[data-diff-rule="removed"]')!;
  expect(rule.querySelector(".rd__change")!.textContent).toBe(t("reviewV2.diff.removed"));
  expect(rule.querySelector("del")!.textContent).toBe("隱藏旁白");
});

it("世界書條目只改了常駐或關鍵詞、內容一字未動：舊的劃掉、新的加底線，不會只剩一個「修改」", async () => {
  const entry = { name: "城門", content: "城門酉時關。", keywords: ["城門"], isEnabled: true, isConstant: false };
  mock.result = { state: "ready", baseKind: "approved", diff: diff({
    fields: [],
    worldbook: { added: [], removed: [], modified: [{ before: entry, after: { ...entry, keywords: ["城門", "宵禁"], isConstant: true, isEnabled: false } }] },
    rules: { added: 0, removed: 0, modified: 0, items: [] },
  }) };
  const el = await mount();
  const row = el.querySelector('[data-diff-entry="modified"]')!;
  const added = [...row.querySelectorAll('[data-diff-flag="add"] ins')].map((x) => x.textContent);
  expect(added).toEqual([`${t("reviewV2.diff.added")}${t("review.entry.constant")}`, `${t("reviewV2.diff.added")}${t("review.entry.disabled")}`]);
  const kw = row.querySelector("[data-diff-keywords]")!;
  expect(kw.querySelector("del")!.textContent).toBe(`${t("reviewV2.diff.removed")}城門`);
  expect(kw.querySelector("ins")!.textContent).toBe(`${t("reviewV2.diff.added")}城門、宵禁`);
  expect(row.querySelector('[data-diff-line="add"], [data-diff-line="del"]')).toBeNull();
});

it("只看改動：沒改的段落收成一行，點開才看；切到全文整段照列", async () => {
  mock.result = { state: "ready", baseKind: "approved", diff: diff() };
  const el = await mount();
  const setting = () => el.querySelector('[data-diff-field="setting"]')!;
  const fold = setting().querySelector<HTMLButtonElement>("[data-diff-fold]")!;
  expect(fold.textContent!.trim()).toBe(t("reviewV2.diff.collapsed", { n: 14 }, 14));
  expect(setting().textContent).not.toContain("第1段");
  fold.click();
  await flush();
  expect(setting().textContent).toContain("第1段");
  expect(setting().querySelector("[data-diff-fold]")).toBeNull();

  // 另一張全新的：直接切全文也全部看得到
  app!.unmount(); document.body.innerHTML = "";
  const el2 = await mount();
  expect(el2.querySelector('[data-diff-field="setting"]')!.textContent).not.toContain("第14段");
  const full = el2.querySelector<HTMLButtonElement>("[data-diff-mode-full]")!;
  full.click();
  await flush();
  expect(full.getAttribute("aria-pressed")).toBe("true");
  expect(el2.querySelector("[data-diff-mode-changes]")!.getAttribute("aria-pressed")).toBe("false");
  expect(el2.querySelector('[data-diff-field="setting"]')!.textContent).toContain("第14段");
  expect(el2.querySelector("[data-diff-fold]")).toBeNull();
});

it("駁回後重送：基準寫上次駁回版；伺服器帶了上次理由才逐項對照", async () => {
  mock.result = { state: "ready", baseKind: "rejected", diff: diff() };
  const el = await mount({ previousReasons: ["opening.no_reply_hook", "character.setting_thin", "rating.mismatch"] });
  expect(el.querySelector("[data-diff-base]")!.textContent).toBe(t("reviewV2.diff.base.rejected"));
  const rows = [...el.querySelectorAll("[data-diff-previous] li")].map((li) => li.textContent);
  expect(rows).toEqual([
    t("reviewV2.diff.previous.openingChanged", { reason: t("review.reasons.opening.no_reply_hook.name") }),
    t("reviewV2.diff.previous.settingAdded", { reason: t("review.reasons.character.setting_thin.name"), n: "86" }, 86),
    t("review.reasons.rating.mismatch.name"),
  ]);
  app!.unmount(); document.body.innerHTML = "";
  const el2 = await mount();
  expect(el2.querySelector("[data-diff-previous]")).toBeNull();
});

it("沒有任何欄位不同：只寫一句事實，依基準換字", async () => {
  const same = summary({ changedFields: [], setting: { charsAdded: 0, charsRemoved: 0 }, opening: { changed: false, charsBefore: 1, charsAfter: 1 }, worldbook: { added: 0, removed: 0, modified: 0 }, tags: { added: 0, removed: 0 }, totalChanged: 0, unchanged: true });
  mock.result = { state: "ready", baseKind: "approved", diff: diff({ summary: same, fields: [], worldbook: { added: [], removed: [], modified: [] }, rules: { added: 0, removed: 0, modified: 0, items: [] } }) };
  const el = await mount();
  expect(el.querySelector('[data-diff-state="unchanged"]')!.textContent!.trim()).toBe(t("reviewV2.diff.unchanged.approved"));
  expect(el.querySelector("[data-diff-chips]")).toBeNull();
  expect(el.querySelector("[data-diff-mode]")).toBeNull();
  app!.unmount(); document.body.innerHTML = "";
  mock.result = { state: "ready", baseKind: "rejected", diff: diff({ summary: same, fields: [] }) };
  const el2 = await mount();
  expect(el2.querySelector('[data-diff-state="unchanged"]')!.textContent!.trim()).toBe(t("reviewV2.diff.unchanged.rejected"));
});

it("沒有基準：說明完整內容在其他分頁；讀不到：說無法比較", async () => {
  mock.result = { state: "no_base" };
  const el = await mount();
  expect(el.querySelector('[data-diff-state="no_base"]')!.textContent).toBe(t("reviewV2.diff.noBase"));
  expect(el.querySelector("[data-diff-base]")).toBeNull();
  for (const state of ["unreadable", "missing"]) {
    app!.unmount(); document.body.innerHTML = "";
    mock.result = { state };
    const e = await mount();
    expect(e.querySelector('[data-diff-state="unreadable"]')!.textContent).toBe(t("reviewV2.diff.unreadable"));
  }
});

it("載入中是骨架；讀取失敗可以重試，重試成功就畫出來", async () => {
  let release!: () => void;
  mock.result = { state: "ready", baseKind: "approved", diff: diff() };
  mock.fail = new Error("network");
  const el = await mount();
  expect(el.querySelector("[data-diff-error]")!.textContent).toContain(t("state.loadFailed"));
  const retry = el.querySelector<HTMLButtonElement>("[data-diff-retry]")!;
  const gate = new Promise<void>((r) => { release = r; });
  const real = mock.result;
  mock.result = gate.then(() => real);
  retry.click();
  await nextTick();
  expect(el.querySelector("[data-diff-loading]")).toBeTruthy();
  expect(el.querySelector("[data-review-diff]")!.getAttribute("aria-busy")).toBe("true");
  release();
  await flush();
  expect(el.querySelector("[data-diff-loading]")).toBeNull();
  expect(el.querySelector("[data-diff-base]")).toBeTruthy();
  expect(mock.calls).toBe(2);
});

it("定案或未驗年齡：只說明，不給一個重試也不會變的按鈕", async () => {
  mock.fail = new ApiError(403, "x", "age_verification_required");
  const el = await mount();
  expect(el.querySelector("[data-diff-error]")!.textContent).toContain(t("error.ageVerificationRequired"));
  expect(el.querySelector("[data-diff-retry]")).toBeNull();
  app!.unmount(); document.body.innerHTML = "";
  mock.fail = new ApiError(410, "x", "review no longer active");
  const el2 = await mount();
  expect(el2.querySelector("[data-diff-error]")!.textContent).toContain(t("review.inactive"));
  expect(el2.querySelector("[data-diff-retry]")).toBeNull();
});
