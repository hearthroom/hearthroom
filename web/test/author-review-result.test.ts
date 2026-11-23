import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { applyLocale, i18n } from "../src/lib/i18n";
import type { AuthorReviewResult } from "../src/lib/api";

const mock = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: async () => "fixture" }) }));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<object>()), fetchAuthorReviewResult: async () => mock.result }));
import AuthorReviewResultPage from "../src/pages/AuthorReviewResultPage.vue";

// 審卡 V2：結果頁是駁回的持久落點。每個理由一張卡（問題／怎麼改／範例，輔導版多改前改後）、
// 審核員補充、好開場的三個要素（有開場白理由時展開）、額度說明；舊的駁回照舊顯示審核說明。
let app: App | null = null;
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = ""; });
beforeEach(async () => { await applyLocale("zh-Hant"); });
const t = (key: string, named?: Record<string, unknown>) => (named ? i18n.global.t(key, named) : i18n.global.t(key));
const result = (over: Partial<AuthorReviewResult> = {}): AuthorReviewResult => ({ name: "雨夜書店", status: "rejected", note: "", submittedAt: 1_700_000_000_000, decidedAt: 1_700_000_100_000, versionId: "v1", corrected: false, correctedAt: null, reasons: [], coaching: false, kind: "first", ...over });
async function mount(data: AuthorReviewResult) {
  mock.result = data;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/mine/reviews/:id", component: AuthorReviewResultPage }, { path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push("/mine/reviews/s1");
  const el = document.createElement("div");
  document.body.append(el);
  app = createApp(RouterView).use(router).use(i18n);
  app.mount(el);
  for (let i = 0; i < 4; i++) { await nextTick(); await new Promise((r) => setTimeout(r)); }
  return el;
}
const card = (el: HTMLElement, code: string) => el.querySelector<HTMLElement>(`[data-reason="${code}"]`);

it("shows one card per reason with problem, fix and example, the result chip and the quota line", async () => {
  const el = await mount(result({ reasons: ["opening.too_short", "rating.mismatch"] }));
  expect(el.querySelector("h1")?.textContent).toBe(t("reviewV2.author.pageTitle"));
  expect(el.querySelector(".result__chip")?.textContent).toBe(t("reviewV2.author.chip"));
  const opening = card(el, "opening.too_short")!;
  expect(opening.querySelector("h3")?.textContent).toBe(t("review.reasons.opening.too_short.name"));
  expect(opening.textContent).toContain(t("review.reasons.opening.too_short.summary"));
  expect(opening.querySelector("[data-fix]")?.textContent).toBe(t("review.reasons.opening.too_short.fix"));
  expect(opening.textContent).toContain(t("review.reasons.opening.too_short.example"));
  expect(opening.querySelector("[data-before]")).toBeNull();
  // 分級不符沒有範例：不畫空的「範例」
  const rating = card(el, "rating.mismatch")!;
  expect(rating.textContent).not.toContain(t("reviewV2.author.example"));
  expect(el.textContent).toContain(t("reviewV2.author.quota"));
  expect(el.querySelector("[data-reviewer-note]")).toBeNull();
});

it("opens the three elements of a good opening only when an opening reason is present", async () => {
  const withOpening = await mount(result({ reasons: ["opening.no_reply_hook"] }));
  expect(withOpening.querySelector<HTMLDetailsElement>("[data-elements]")?.open).toBe(true);
  expect(withOpening.querySelector("[data-elements] summary")?.textContent).toBe(t("reviewV2.elements.title"));
  app?.unmount(); app = null; document.body.innerHTML = "";
  const settingOnly = await mount(result({ reasons: ["character.setting_thin"] }));
  expect(settingOnly.querySelector<HTMLDetailsElement>("[data-elements]")?.open).toBe(false);
});

it("coaching uses the fuller fix and adds before and after where the reason has them", async () => {
  const el = await mount(result({ coaching: true, reasons: ["character.setting_thin", "content.min_length"], note: "角色背景再補一點" }));
  const setting = card(el, "character.setting_thin")!;
  expect(setting.querySelector("[data-fix]")?.textContent).toBe(t("review.reasons.character.setting_thin.coachFix"));
  expect(setting.querySelector("[data-before]")?.textContent).toContain(t("review.reasons.character.setting_thin.before"));
  expect(setting.querySelector("[data-after]")?.textContent).toContain(t("review.reasons.character.setting_thin.after"));
  // 有效字數不足沒有輔導版：照一般改法，門檻字數填進去
  const length = card(el, "content.min_length")!;
  expect(length.querySelector("[data-fix]")?.textContent).toBe(t("review.reasons.content.min_length.fix", { required: 3001 }));
  expect(length.querySelector("[data-fix]")?.textContent).toContain("3001");
  expect(length.querySelector("[data-before]")).toBeNull();
  expect(el.querySelector("[data-reviewer-note]")?.textContent).toContain("角色背景再補一點");
});

it("no reply hook adds the three ways to offer choices after its example; other reasons do not", async () => {
  const el = await mount(result({ reasons: ["opening.no_reply_hook", "opening.too_short"] }));
  const hook = card(el, "opening.no_reply_hook")!;
  expect(hook.querySelector("[data-fix]")?.textContent).toBe(t("review.reasons.opening.no_reply_hook.fix"));
  const options = hook.querySelector("[data-reason-options]")!;
  expect(options.querySelector("dt")?.textContent).toBe(t("review.reasons.opening.no_reply_hook.options.title"));
  // 範例之後：dl 裡的順序是 問題、怎麼改、範例、三種做法
  const parts = [...hook.querySelectorAll(".reason-card__parts > div")];
  expect(parts.indexOf(options)).toBe(3);
  expect([...options.querySelectorAll("[data-option]")].map((n) => n.getAttribute("data-option"))).toEqual(["field", "text", "tag"]);
  for (const way of ["field", "text", "tag"]) {
    const item = options.querySelector(`[data-option="${way}"]`)!;
    expect(item.textContent).toContain(t(`review.reasons.opening.no_reply_hook.options.${way}.name`));
    expect(item.textContent).toContain(t(`review.reasons.opening.no_reply_hook.options.${way}.desc`));
  }
  // [choices] 的範例：等寬區塊，標記照原樣、兩行選項夾在中間
  const code = options.querySelector("[data-choices-example]")!;
  expect(code.tagName).toBe("PRE");
  expect(code.textContent).toBe("[choices]\n一樓靠窗\n頂樓\n[/choices]");
  expect(options.querySelectorAll("pre")).toHaveLength(1);
  expect(options.querySelector('[data-option="text"]')?.textContent).toContain(t("review.reasons.opening.no_reply_hook.options.text.example"));
  // 一般版沒有改前改後
  expect(hook.querySelector("[data-after]")).toBeNull();
  expect(hook.querySelector("[data-after-choices]")).toBeNull();
  expect(card(el, "opening.too_short")!.querySelector("[data-reason-options]")).toBeNull();
});

it("coaching on no reply hook shows before, after with a question and after with choices, each with its own label", async () => {
  const el = await mount(result({ coaching: true, reasons: ["opening.no_reply_hook", "character.setting_thin"] }));
  const hook = card(el, "opening.no_reply_hook")!;
  expect(hook.querySelector("[data-fix]")?.textContent).toBe(t("review.reasons.opening.no_reply_hook.coachFix"));
  expect(hook.querySelector("[data-before] dt")?.textContent).toBe(t("reviewV2.author.before"));
  expect(hook.querySelector("[data-after] dt")?.textContent).toBe("改後（問題）");
  expect(hook.querySelector("[data-after] dd")?.textContent).toBe(t("review.reasons.opening.no_reply_hook.after"));
  expect(hook.querySelector("[data-after-choices] dt")?.textContent).toBe("改後（選項）");
  expect(hook.querySelector("[data-after-choices] dd")?.textContent).toBe(t("review.reasons.opening.no_reply_hook.afterChoices"));
  // 輔導版也有三種做法
  expect(hook.querySelector("[data-reason-options] [data-choices-example]")?.tagName).toBe("PRE");
  // 其他代碼的小標不變，也沒有第二個改後
  const setting = card(el, "character.setting_thin")!;
  expect(setting.querySelector("[data-after] dt")?.textContent).toBe(t("reviewV2.author.after"));
  expect(setting.querySelector("[data-after-choices]")).toBeNull();
  expect(setting.querySelector("[data-reason-options]")).toBeNull();
});

it("an old rejection without reason codes keeps the reviewer note layout", async () => {
  const el = await mount(result({ note: "開場太短，請補一段。" }));
  expect(el.querySelector("[data-guided]")).toBeNull();
  expect(el.querySelector("h1")?.textContent).toBe(t("review.correction.authorOpen"));
  expect(el.textContent).toContain(t("review.done.rejected"));
  expect(el.querySelector(".reason")?.textContent).toBe("開場太短，請補一段。");
});

it("a corrected result stays on the correction layout even with stored reasons", async () => {
  const el = await mount(result({ corrected: true, correctedAt: 1_700_000_200_000, note: "誤判", reasons: ["other"] }));
  expect(el.querySelector("[data-guided]")).toBeNull();
  expect(el.querySelector("h1")?.textContent).toBe(t("review.correction.authorTitle"));
});
