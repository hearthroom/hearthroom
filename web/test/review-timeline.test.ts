import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { applyLocale, i18n } from "../src/lib/i18n";
import type { ReviewTimelineItem } from "../src/lib/api";

const mock = vi.hoisted(() => ({ result: null as unknown, fail: false }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: async () => "fixture" }) }));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<object>()), fetchReviewTimeline: async () => { if (mock.fail) throw new Error("x"); return mock.result; } }));
import ReviewTimeline from "../src/components/ReviewTimeline.vue";

// 審卡 V2 第二批：單卡審核紀錄依輪次排，事件名都是字；重送標「作者改版再送」；讀不到可以重試。
let app: App | null = null;
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = ""; mock.fail = false; });
beforeEach(async () => { await applyLocale("zh-Hant"); });
const t = (k: string, n?: Record<string, unknown>) => (n ? i18n.global.t(k, n) : i18n.global.t(k));
async function mount() {
  const el = document.createElement("div"); document.body.append(el);
  app = createApp(ReviewTimeline, { submissionId: "s2" }).use(i18n); app.mount(el);
  for (let i = 0; i < 4; i++) { await nextTick(); await new Promise((r) => setTimeout(r)); }
  return el;
}
const item = (o: Partial<ReviewTimelineItem>): ReviewTimelineItem => ({ at: 1_800_000_000_000, action: "submit", round: 1, actor: null, mine: false, current: false, ...o });

it("輪次新的在上、事件都有文字；駁回帶理由名稱與補充；重送叫作者改版再送", async () => {
  mock.result = { coverageFrom: 1_795_415_223_000, items: [
    item({ action: "submit", at: 1 }), item({ action: "reject", at: 2, actor: "審核員甲", reasons: ["opening.no_reply_hook"], note: "開場沒有接話點" }),
    item({ action: "submit", at: 3, round: 2, current: true }), item({ action: "drop", at: 4, round: 2, current: true, mine: true, source: "single" }),
  ] };
  const el = await mount();
  const titles = [...el.querySelectorAll(".round__title")].map((h) => h.textContent);
  expect(titles).toEqual([t("review.attempt", { n: 2 }), t("review.attempt", { n: 1 })]);
  const events = [...el.querySelectorAll("[data-timeline-event]")].map((e) => e.querySelector(".chip")!.textContent);
  expect(events).toEqual([t("reviewV2.timeline.event.drop"), t("reviewV2.timeline.event.resubmit"), t("reviewV2.timeline.event.reject"), t("reviewV2.timeline.event.submit")]);
  expect(el.textContent).toContain(t("review.reasons.opening.no_reply_hook.name"));
  expect(el.textContent).toContain("開場沒有接話點");
  expect(el.textContent).toContain(t("reviewV2.dropped.source.single"));
  expect(el.textContent).toContain(t("reviewV2.timeline.you"));
  expect(el.querySelector("[data-timeline-latest]")!.textContent).toContain(t("reviewV2.timeline.event.drop"));
});

it("只有送審一筆時照實說；讀不到可以重新載入", async () => {
  mock.result = { coverageFrom: null, items: [item({ current: true })] };
  let el = await mount();
  expect(el.querySelector("[data-timeline-only]")!.textContent).toBe(t("reviewV2.timeline.onlySubmit"));
  app!.unmount(); document.body.innerHTML = "";
  mock.fail = true;
  el = await mount();
  expect(el.querySelector('[role="alert"]')!.textContent).toContain(t("state.loadFailed"));
  mock.fail = false;
  (el.querySelector('[role="alert"] button') as HTMLButtonElement).click();
  for (let i = 0; i < 4; i++) { await nextTick(); await new Promise((r) => setTimeout(r)); }
  expect(el.querySelector("[data-timeline-only]")).toBeTruthy();
});
