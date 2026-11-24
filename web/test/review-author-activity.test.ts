import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import { applyLocale, i18n } from "../src/lib/i18n";

// 審核頁「作者行為」（只給審核員）：異常摘要與數字、預設展開與收合、量不到、沒權限就整區不顯示、不顯示識別碼
const api = vi.hoisted(() => ({ fetchReviewAuthorActivity: vi.fn() }));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<object>()), fetchReviewAuthorActivity: api.fetchReviewAuthorActivity }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: async () => "local-reviewer" }) }));
import { ApiError } from "../src/lib/api";
import ReviewAuthorActivity from "../src/components/ReviewAuthorActivity.vue";

const NOW = Date.UTC(2026, 10, 24, 12);
const activity = (over: Record<string, unknown> = {}) => ({
  anomalies: [],
  weekly: { used: 1, limit: 3, deviceShared: false },
  submissions7d: 2,
  submissions24h: 1,
  pendingNow: 1,
  avgGapHours: 50,
  minutesSincePrevious: 1500,
  recent: [
    { at: NOW, chars: 3380, status: "pending", kind: "first", current: true },
    { at: NOW - 86_400_000, chars: 4020, status: "approved", kind: "first", current: false },
  ],
  deviceAccounts: 1,
  priorApproved: 1,
  accountAgeDays: 40,
  ...over,
});
const busy = () => activity({
  anomalies: [{ code: "burst_long", value: 4 }, { code: "quota_full", value: 3 }, { code: "quick_gap", value: 12 }, { code: "device_heavy", value: 5 }],
  weekly: { used: 3, limit: 3, deviceShared: false },
  submissions7d: 9, submissions24h: 6, avgGapHours: 0.3, minutesSincePrevious: 12, deviceAccounts: 5,
  recent: [4210, 4180, 4205, 4190, 4200, 3999].map((chars, i) => ({ at: NOW - i * 720_000, chars, status: "pending", kind: "first", current: i === 0 })),
});

let app: App | null = null, el: HTMLElement;
const mount = async () => {
  el = document.createElement("div"); document.body.append(el);
  app = createApp({ render: () => h(ReviewAuthorActivity, { submissionId: "s1" }) }).use(i18n);
  app.mount(el);
  await vi.waitFor(() => expect(api.fetchReviewAuthorActivity).toHaveBeenCalled());
  await nextTick();
};
const details = () => el.querySelector<HTMLDetailsElement>("[data-activity-details]");
const row = (key: string) => el.querySelector(`[data-activity-row="${key}"] dd`)?.textContent?.trim();

beforeEach(async () => { await applyLocale("zh-Hant"); });
afterEach(() => { app?.unmount(); app = null; el?.remove(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("shows each anomaly with its number above the block, expanded by default", async () => {
  api.fetchReviewAuthorActivity.mockResolvedValue(busy());
  await mount();
  await vi.waitFor(() => expect(el.querySelector("[data-activity-anomalies]")).toBeTruthy());
  expect(el.querySelector("[data-activity-anomalies] [role=status]")?.textContent).toContain("有 4 項行為異常，含 1 項重度（只供參考，不會自動判定）");
  const item = (code: string) => el.querySelector(`[data-anomaly="${code}"]`)?.textContent ?? "";
  expect(item("burst_long")).toContain("一晚多張長卡");
  expect(item("burst_long")).toContain("12 小時內送了 4 張，每張都有 1,500 字以上");
  expect(item("quota_full")).toContain("本週 3 / 3，已用完");
  expect(item("quick_gap")).toContain("距上一張只隔 12 分鐘");
  expect(item("device_heavy")).toContain("同裝置 5 個帳號（重度）");
  expect(details()?.open).toBe(true);
  // 數字照伺服器回的寫；「已用滿」「極短」跟著異常代碼標在對應那一列
  expect(row("weekly")).toContain("3 / 3");
  expect(row("weekly")).toContain("已用滿");
  expect(row("sincePrevious")).toContain("12 分鐘");
  expect(row("sincePrevious")).toContain("極短");
  expect(row("day")).toBe("6 張");
  expect(row("week")).toBe("9 張");
  expect(row("deviceAccounts")).toBe("5 個（含此帳號）");
  // 最近 5 張，多的不列
  expect(row("recentChars")).toBe("4,210 · 4,180 · 4,205 · 4,190 · 4,200");
});

it("keeps the block collapsed without anomalies, and shows no warning", async () => {
  api.fetchReviewAuthorActivity.mockResolvedValue(activity());
  await mount();
  await vi.waitFor(() => expect(details()).toBeTruthy());
  expect(details()?.open).toBe(false);
  expect(el.querySelector("[data-activity-anomalies]")).toBeNull();
  expect(el.textContent).not.toContain("⚑");
  expect(row("weekly")).toBe("1 / 3");
  expect(row("avgGap")).toBe("2.1 天");
  expect(el.querySelector("[data-activity-insufficient]")).toBeNull();
});

it("starts collapsed on phone widths even with anomalies; the summary stays visible", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  api.fetchReviewAuthorActivity.mockResolvedValue(busy());
  await mount();
  await vi.waitFor(() => expect(el.querySelector("[data-activity-anomalies]")).toBeTruthy());
  expect(details()?.open).toBe(false);
});

it("writes 量不到 for values the server could not measure, never 0", async () => {
  api.fetchReviewAuthorActivity.mockResolvedValue(activity({
    submissions7d: 1, avgGapHours: null, minutesSincePrevious: null, deviceAccounts: null,
    recent: [{ at: NOW, chars: null, status: "pending", kind: "first", current: true }],
  }));
  await mount();
  await vi.waitFor(() => expect(details()).toBeTruthy());
  for (const key of ["avgGap", "sincePrevious", "recentChars", "deviceAccounts"]) expect(row(key)).toBe("量不到");
  expect(el.querySelector("[data-activity-insufficient]")?.textContent).toBe("這位作者的紀錄還不夠，無法判斷；照一般流程審。");
});

it.each([403, 404, 409, 410])("hides the whole section when the route answers %i", async (status) => {
  api.fetchReviewAuthorActivity.mockRejectedValue(new ApiError(status, "x"));
  await mount();
  await vi.waitFor(() => expect(el.querySelector("[data-author-activity]")).toBeNull());
  expect(el.querySelector("[data-activity-error]")).toBeNull();
});

it("shows a skeleton while loading, then a retryable error that does not block the decision", async () => {
  let fail!: (e: unknown) => void;
  api.fetchReviewAuthorActivity.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; })).mockResolvedValueOnce(activity());
  await mount();
  expect(el.querySelector("[data-author-activity] .ghost")).toBeTruthy();
  fail(new ApiError(500, "x"));
  await vi.waitFor(() => expect(el.querySelector("[data-activity-error]")?.textContent).toContain("作者行為暫時讀不到，不影響你的決定。"));
  el.querySelector<HTMLButtonElement>("[data-activity-retry]")!.click();
  await vi.waitFor(() => expect(details()).toBeTruthy());
  expect(api.fetchReviewAuthorActivity).toHaveBeenCalledTimes(2);
  expect(el.querySelector("[data-activity-error]")).toBeNull();
});

it("renders numbers only: no account, device or submission identifiers, no timestamps", async () => {
  api.fetchReviewAuthorActivity.mockResolvedValue({ ...busy(), memberId: "member-secret-77", deviceHash: "dev-hash-abc", recent: busy().recent.map((r, i) => ({ ...r, id: `sub-${i}` })) });
  await mount();
  await vi.waitFor(() => expect(details()).toBeTruthy());
  const text = el.textContent ?? "";
  for (const leak of ["member-secret", "dev-hash", "sub-0", "local-reviewer", String(NOW), "first", "pending", "approved"]) expect(text).not.toContain(leak);
});

it("reads in English with plural forms", async () => {
  await applyLocale("en");
  api.fetchReviewAuthorActivity.mockResolvedValue(busy());
  await mount();
  await vi.waitFor(() => expect(el.querySelector("[data-activity-anomalies]")).toBeTruthy());
  expect(el.textContent).toContain("4 unusual activity signs, 1 severe");
  expect(el.textContent).toContain("4 cards in 12 hours, each 1,500+ characters");
  expect(row("day")).toBe("6 cards");
});
