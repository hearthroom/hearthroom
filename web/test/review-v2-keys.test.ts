import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// 審卡 V2 的字串一定要五個語系檔都有。拿 t() 比對的測試在缺鍵時會空過（t 回傳鍵名本身），
// 所以直接掃元件原始碼裡寫死的鍵名，逐一確認存在（QA 2026-11-23：結果頁顯示了 reviewV2.author.suggestPoint 原文）。
// 動態組出來的鍵（含 ${…}）不在這裡檢查，由各自元件的測試管。
const root = join(__dirname, "..", "src");
const files = [
  "pages/AuthorReviewResultPage.vue", "pages/ReviewDetailPage.vue", "pages/ReviewQueuePage.vue", "pages/ReviewDroppedPage.vue", "pages/ReviewStatsPage.vue",
  "components/MyCardTile.vue", "components/ReviewReasonPicker.vue", "components/ReviewReasonOptions.vue", "components/ReviewAuthorProfile.vue",
  "components/ReviewBatchSheet.vue", "components/ReviewRowMenu.vue", "components/ReviewListTabs.vue", "components/ReviewTimeline.vue",
  "components/ReviewDiffView.vue", "components/ReviewDiffLines.vue", "lib/notifications.ts",
];
const locales = readdirSync(join(root, "locales")).filter((f) => f.endsWith(".json"));

it("every literal reviewV2.* / review.reasons.* key used by the review V2 screens exists in all five locales", () => {
  expect(locales.length).toBe(5);
  const keys = new Set<string>();
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    for (const m of src.matchAll(/["'`]((?:reviewV2|reviewStats|review\.reasons)\.[\w.]+)["'`]/g)) keys.add(m[1]);
  }
  expect(keys.size).toBeGreaterThan(50);
  const missing: string[] = [];
  for (const l of locales) {
    const dict = JSON.parse(readFileSync(join(root, "locales", l), "utf8")) as Record<string, string>;
    for (const k of keys) if (!(k in dict)) missing.push(`${l}: ${k}`);
  }
  expect(missing).toEqual([]);
});

import { REVIEW_DECISION_MARKS, REVIEW_REASONS, REVIEW_REASON_GROUPS } from "../../shared/review-reasons";

it("keys built from enumerations (events, flags, labels, reasons) exist in all five locales", () => {
  const keys = [
    ...["submit", "resubmit", "reject", "hold", "unhold", "drop", "restore", "superseded", "reopen", "approve", "approve_suggestions"].map((a) => `reviewV2.timeline.event.${a}`),
    ...REVIEW_DECISION_MARKS.map((m) => `reviewV2.marks.${m}`),
    ...["new", "stable", "top", "unknown"].map((x) => `reviewV2.mark.tier.${x}`),
    ...["new", "stable", "top", "unknown", "batch"].map((x) => `reviewV2.mark.use.${x}`),
    ...["decided", "firstPass", "memberSince", "deviceAccounts", "recentPending", "drops", "marks", "suggestions"].map((x) => `reviewV2.mark.basis.${x}`),
    ...["shared_device", "missing_data", "content_checked", "other"].map((x) => `reviewV2.mark.reason.${x}`),
    ...Object.keys(REVIEW_REASON_GROUPS).map((g) => `reviewV2.decide.group.${g}`),
    ...["single", "batch", "auto"].map((x) => `reviewV2.dropped.source.${x}`),
    ...["all", "single", "batch", "auto", "aged"].map((x) => `reviewV2.dropped.filter.${x}`),
    ...["new", "updates", "dropped"].flatMap((x) => [`reviewV2.tabs.${x}`, `reviewV2.tabs.${x}NoCount`]),
    ...REVIEW_REASONS.flatMap((c) => ["name", "summary", "fix"].map((f) => `review.reasons.${c}.${f}`)),
  ];
  const missing: string[] = [];
  for (const l of locales) {
    const dict = JSON.parse(readFileSync(join(root, "locales", l), "utf8")) as Record<string, string>;
    for (const k of keys) if (!(k in dict)) missing.push(`${l}: ${k}`);
  }
  expect(missing).toEqual([]);
});
