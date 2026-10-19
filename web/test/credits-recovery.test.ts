// 遊玩畫布「積分不夠」時，宿主給的說法與兩條路（ui.md §7.2、copy.md §8.2）。
import { describe, expect, it } from "vitest";
import { creditsRecovery } from "../src/lib/credits-recovery";
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
      { id: "tasks", label: 'credits.recovery.taskLeft{"n":"70"}', href: "https://sukisuki.ai/en/checkin#tasks" },
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
