// 遊玩畫布「積分不夠」時，宿主給的說法與兩條路（ui.md §7.2、copy.md §8.2）。
import { beforeEach, describe, expect, it, vi } from "vitest";

const tracked: { event: string; data: unknown }[] = [];
vi.mock("../src/lib/track", () => ({ track: (event: string, data?: unknown) => tracked.push({ event, data }) }));
import { creditsRecovery, noteShortfallLanding, noteShortfallShown, SHORTFALL_FROM } from "../src/lib/credits-recovery";
import type { RewardsPanel, RewardTask } from "../src/lib/rewards";

const t = (key: string, p: Record<string, unknown> = {}) => `${key}${JSON.stringify(p)}`;
const task = (id: string, credits: number, status: RewardTask["status"]): RewardTask => ({ id, type: "turns", progress: 0, target: 5, reward: { credits }, status, period: "d" });
const panel = (daily: RewardTask[]) => ({ tasks: { daily, weekly: [] } }) as unknown as RewardsPanel;
const opts = { origin: "https://sukisuki.ai", lp: (p: string) => `/en${p}`, t, whole: (n: number) => String(n), topUp: "https://console.example/billing" };

describe("積分不夠的兩條路", () => {
  it("今日任務還沒領的積分加總；有數字就講這一輪要多少、目前有多少", () => {
    const r = creditsRecovery(panel([task("a", 30, "claimed"), task("b", 40, "locked"), task("c", 30, "claimable"), task("d", 50, "unavailable")]), { needed: 300, available: 120 }, opts)!;
    expect(r.title).toBe("credits.recovery.title{}");
    expect(r.body).toBe('credits.recovery.body{"need":"300","have":"120"}');
    expect(r.links).toEqual([
      { id: "tasks", label: 'credits.recovery.taskLeft{"n":"70"}', href: "https://sukisuki.ai/en/checkin?from=canvas_shortfall#tasks" },
      { id: "topup", label: "credits.recovery.topup{}", href: "https://console.example/billing" },
    ]);
  });
  it("任務都領完了：只剩儲值；沒有數字：標題與內文交回畫布原本的字", () => {
    const r = creditsRecovery(panel([task("a", 30, "claimed")]), null, opts)!;
    expect(r.title).toBeUndefined();
    expect(r.body).toBeUndefined();
    expect(r.links.map((l) => l.id)).toEqual(["topup"]);
  });
  it("面板還沒讀到：也給儲值，不猜任務", () => {
    expect(creditsRecovery(null, null, opts)!.links.map((l) => l.id)).toEqual(["topup"]);
  });
});

// B7 讀回（PM 2026-10-20）：卡片每顯示一次記一次；兩條路由落地頁看 from 記點擊。不帶任何 ID 或內容
describe("積分不夠的計數", () => {
  beforeEach(() => { tracked.length = 0; });
  it("同一張卡重畫不重複記；換一張卡再記", () => {
    const a = { needed: 6, available: 5 }, b = { needed: 6, available: 5 };
    noteShortfallShown(a); noteShortfallShown(a); noteShortfallShown(b);
    expect(tracked).toEqual([{ event: "credits_shortfall_shown", data: undefined }, { event: "credits_shortfall_shown", data: undefined }]);
  });
  it("落地頁：從那張卡來的才記，記完把 from 拿掉，不留在網址上", () => {
    const replaced: unknown[] = [];
    const router = { replace: (to: unknown) => { replaced.push(to); return Promise.resolve(); } } as unknown as Parameters<typeof noteShortfallLanding>[1];
    noteShortfallLanding({ query: { from: SHORTFALL_FROM, x: "1" }, hash: "#tasks" }, router, "checkin");
    expect(tracked).toEqual([{ event: "credits_shortfall_click", data: { detail: "checkin" } }]);
    expect(replaced).toEqual([{ query: { x: "1" }, hash: "#tasks" }]);
    noteShortfallLanding({ query: {}, hash: "" }, router, "checkin");
    expect(tracked).toHaveLength(1);
  });
});

