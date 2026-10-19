// 簽到頁的狀態推導：Hero 狀態（ui.md §3.6）、連續天數 chip、七日軌道（§3.4、§10 Q18）、
// 里程碑（§3.5）、保底、倒數、新手七日、限時積分到期條（§7.1）、領取的冪等鍵。
import { beforeEach, describe, expect, it } from "vitest";
import {
  chestTitle, expiryNotice, heroState, milestoneView, newcomerView, pityView, requestIdFor, clearRequestId,
  countdown, streakChip, taskView, trackNodes,
} from "../src/lib/checkin";
import type { RewardsPanel, TrackCell } from "../src/lib/rewards";

const cycle = ["daily", "daily", "day3", "daily", "daily", "daily", "day7"];
const track = (statuses: TrackCell["status"][]): TrackCell[] => statuses.map((status, i) => ({ day: i + 1, chest: cycle[i], status }));

function panel(over: Partial<RewardsPanel["checkin"]> = {}, rest: Partial<RewardsPanel> = {}): RewardsPanel {
  return {
    serverNow: "2026-10-20T10:00:00+08:00", businessDay: "2026-10-20", nextResetAt: "2026-10-21T04:00:00+08:00",
    weekResetAt: "2026-10-26T04:00:00+08:00", planVersion: 1,
    checkin: {
      streak: 8, todayClaimed: false, todayChests: ["daily"], fallback: null,
      track: track(["claimed", "today", "future", "future", "future", "future", "future"]),
      nextMilestone: { day: 14, chest: "m14", inDays: 6 }, makeup: { left: 1, repairableDays: [] }, ...over,
    },
    pityRemaining: 4, today: { claims: [] }, tasks: { daily: [], weekly: [] }, newcomer: null, hints: [], ...rest,
  };
}
const plan = { checkin: { cycle, milestones: [{ at: 14, chest: "m14" }, { at: 28, chest: "m28" }] } };

describe("Hero 狀態", () => {
  it("第一次：從沒簽過", () => {
    expect(heroState(panel({ streak: 0, track: track(["today", "future", "future", "future", "future", "future", "future"]) }))).toBe("first");
  });
  it("一般日、第 3 天、第 7 天、兩箱", () => {
    expect(heroState(panel())).toBe("normal");
    expect(heroState(panel({ todayChests: ["day3"] }))).toBe("day3");
    expect(heroState(panel({ todayChests: ["day7"] }))).toBe("day7");
    expect(heroState(panel({ streak: 13, todayChests: ["day7", "m14"] }))).toBe("two");
  });
  it("今天已簽", () => {
    expect(heroState(panel({ todayClaimed: true, todayChests: [] }))).toBe("done");
  });
  it("斷簽：看 repairableDays，不是手上有沒有卡", () => {
    const fallback = { from: 17, checkpoint: 14, to: 15 };
    expect(heroState(panel({ fallback, makeup: { left: 1, repairableDays: [{ day: "2026-10-19", deadline: "2026-10-21T04:00:00+08:00" }] } }))).toBe("brokenCard");
    expect(heroState(panel({ fallback, makeup: { left: 1, repairableDays: [] } }))).toBe("brokenNoCard");
    expect(heroState(panel({ fallback, makeup: { left: 0, repairableDays: [{ day: "2026-10-19", deadline: "x" }] } }))).toBe("brokenNoCard");
  });
});

describe("連續天數 chip", () => {
  it("第一次寫第 1 天", () => {
    expect(streakChip(panel({ streak: 0, track: track(["today", "future", "future", "future", "future", "future", "future"]) }))).toEqual({ first: true, n: 0, was: null });
  });
  it("有補簽可用：照原本的天數，不寫原本", () => {
    const p = panel({ streak: 17, fallback: { from: 17, checkpoint: 14, to: 15 }, makeup: { left: 1, repairableDays: [{ day: "d", deadline: "x" }] } });
    expect(streakChip(p)).toEqual({ first: false, n: 17, was: null });
  });
  it("補不回來：顯示退回的天數（checkpoint），旁邊寫原本", () => {
    const p = panel({ streak: 17, fallback: { from: 17, checkpoint: 14, to: 15 }, makeup: { left: 0, repairableDays: [] } });
    expect(streakChip(p)).toEqual({ first: false, n: 14, was: 17 });
  });
});

describe("七日軌道", () => {
  it("一般：已簽、今天、未來；第 3、7 天比較好", () => {
    const nodes = trackNodes(panel());
    expect(nodes.map((n) => n.state)).toEqual(["done", "today", "future", "future", "future", "future", "future"]);
    expect(nodes.map((n) => n.better)).toEqual([false, false, true, false, false, false, true]);
  });
  it("今天已簽：今天那格是 todayDone（位置由連續天數算）", () => {
    const p = panel({ streak: 2, todayClaimed: true, track: track(["claimed", "claimed", "future", "future", "future", "future", "future"]) });
    expect(trackNodes(p).map((n) => n.state)).toEqual(["done", "todayDone", "future", "future", "future", "future", "future"]);
  });
  it("有補簽可用：漏簽的格畫成可補簽，不畫叉", () => {
    const p = panel({
      streak: 17, fallback: { from: 17, checkpoint: 14, to: 15 },
      track: track(["claimed", "claimed", "claimed", "missed", "today", "future", "future"]),
      makeup: { left: 1, repairableDays: [{ day: "2026-10-19", deadline: "x" }] },
    });
    expect(trackNodes(p).map((n) => n.state)).toEqual(["done", "done", "done", "repairable", "today", "future", "future"]);
  });
  it("補不回來：畫新一輪的預覽，今天是第 1 格", () => {
    const p = panel({
      streak: 17, fallback: { from: 17, checkpoint: 14, to: 15 },
      track: track(["claimed", "claimed", "missed", "missed", "today", "future", "future"]),
      makeup: { left: 1, repairableDays: [] },
    });
    expect(trackNodes(p).map((n) => n.state)).toEqual(["today", "future", "future", "future", "future", "future", "future"]);
  });
  it("補簽過的格是虛線勾", () => {
    const p = panel({ track: track(["claimed", "made_up", "today", "future", "future", "future", "future"]) });
    expect(trackNodes(p)[1].state).toBe("makeup");
  });
});

describe("里程碑", () => {
  it("一般：{cur}/{max} 與再幾天", () => {
    expect(milestoneView(panel({ streak: 8 }), plan)).toEqual({ today: false, day: 14, cur: 8, max: 14, left: 6, ratio: 8 / 14 });
  });
  it("今天的箱子含里程碑箱：一律寫今天，不看 inDays", () => {
    const v = milestoneView(panel({ streak: 13, todayChests: ["day7", "m14"], nextMilestone: { day: 14, chest: "m14", inDays: 1 } }), plan);
    expect(v?.today).toBe(true);
    expect(v?.day).toBe(14);
  });
  // 契約：todayChests 是「今天簽到開的箱子」，簽完還留著（QA ⚠️18，接本機 Harbor）
  it("里程碑那天簽完：指向下一個里程碑，不再寫「今天多開一個」", () => {
    const done = { streak: 14, todayClaimed: true, todayChests: ["day7", "m14"] };
    expect(milestoneView(panel({ ...done, nextMilestone: { day: 28, chest: "m28", inDays: 14 } }), plan)).toMatchObject({ today: false, day: 28, max: 28, left: 14 });
    // 伺服器還指著今天那個（還有 0 天）：照方案往後推到下一個
    expect(milestoneView(panel({ ...done, nextMilestone: { day: 14, chest: "m14", inDays: 0 } }), plan)).toMatchObject({ today: false, day: 28, max: 28, left: 14 });
  });
  it("28 天後：條從上一個存檔點算起", () => {
    const v = milestoneView(panel({ streak: 30, nextMilestone: { day: 42, chest: "m14", inDays: 12 } }), plan);
    expect(v).toMatchObject({ cur: 30, max: 42, left: 12 });
    expect(v!.ratio).toBeCloseTo(2 / 14);
  });
  it("漏簽、補得回來：還沒選之前，天數照原本的算（17/28 → 再簽 11 天），不用退回後的", () => {
    const p = panel({
      streak: 17, fallback: { from: 17, checkpoint: 14, to: 15 }, nextMilestone: { day: 28, chest: "m28", inDays: 14 },
      makeup: { left: 1, repairableDays: [{ day: "2026-10-19", deadline: "x" }] },
    });
    expect(milestoneView(p, plan)).toMatchObject({ cur: 17, max: 28, left: 11 });
  });

  it("沒有下一個里程碑就不出現", () => {
    expect(milestoneView(panel({ nextMilestone: null }), plan)).toBeNull();
  });
});

describe("寶箱名稱", () => {
  it("每種箱子對到一個語系鍵；里程碑帶天數", () => {
    expect(chestTitle("daily", plan)).toEqual({ key: "checkin.box.normal" });
    expect(chestTitle("day3", plan)).toEqual({ key: "checkin.box.day3" });
    expect(chestTitle("m28", plan)).toEqual({ key: "checkin.box.milestone", params: { days: 28 } });
    expect(chestTitle("daily_all", plan)).toEqual({ key: "checkin.box.dailyChest" });
    expect(chestTitle("weekly_active", plan)).toEqual({ key: "checkin.box.weeklyChat" });
    expect(chestTitle("weekly_share", plan)).toEqual({ key: "checkin.box.weeklyShare" });
    expect(chestTitle("newcomer", plan)).toEqual({ key: "checkin.box.newcomerGrand" });
  });
});

describe("保底與倒數", () => {
  it("n=1 換成下一箱；沒有資料不出現", () => {
    expect(pityView(4)).toEqual({ key: "checkin.pity", n: 4 });
    expect(pityView(1)).toEqual({ key: "checkin.pity.next", n: 1 });
    expect(pityView(undefined)).toBeNull();
  });
  it("倒數用伺服器時間，扣掉讀取後經過的時間", () => {
    const fetchedAt = 1_000_000;
    // 伺服器 10:00、換日 04:00 隔天 → 18 小時；讀回來後過了 30 分鐘
    expect(countdown("2026-10-20T10:00:00+08:00", "2026-10-21T04:00:00+08:00", fetchedAt, fetchedAt + 30 * 60_000)).toEqual({ h: 17, m: 30, totalMs: (17 * 60 + 30) * 60_000 });
  });
});

describe("新手七日", () => {
  const newcomer = {
    active: true, stage: 3, deadline: "2026-10-30T04:00:00+08:00",
    today: { stage: 4, goal: "comment_or_rating", progress: 0, target: 1, status: "locked" as const },
    // 契約 53298e1：每一階 {stage, goal, target, reward, status}
    stages: [1, 2, 3, 4, 5, 6, 7].map((s) => ({ stage: s, goal: "turns" as const, target: 3, reward: s < 7 ? { credits: 200 } : { chest: "newcomer" }, status: (s <= 3 ? "claimed" : "locked") as "claimed" | "locked" | "pending" })),
  };
  it("第幾天、完成幾天、還剩幾天", () => {
    expect(newcomerView(panel({}, { newcomer }))).toMatchObject({ day: 4, done: 3, left: 10, todayDone: false, grand: false });
  });
  it("不在進行中就不出現", () => {
    expect(newcomerView(panel({}, { newcomer: { ...newcomer, active: false } }))).toBeNull();
    expect(newcomerView(panel())).toBeNull();
  });
  it("完成六天、今天可以開大箱", () => {
    const n = { ...newcomer, stage: 6, today: { ...newcomer.today, stage: 7, status: "claimable" as const }, stages: newcomer.stages.map((s) => ({ ...s, status: (s.stage <= 6 ? "claimed" : "locked") as "claimed" | "locked" })) };
    expect(newcomerView(panel({}, { newcomer: n }))).toMatchObject({ day: 7, done: 6, grand: true });
  });
  it("今天的目標達成、還沒領（Harbor 要領取才入帳）：可領取，不是已完成，也不是大箱", () => {
    const n = { ...newcomer, today: { ...newcomer.today, progress: 1, status: "claimable" as const } };
    expect(newcomerView(panel({}, { newcomer: n }))).toMatchObject({ day: 4, claimable: true, todayDone: false, grand: false });
    expect(newcomerView(panel({}, { newcomer }))).toMatchObject({ claimable: false });
  });
  it("領了還在發放中的那一階也算完成", () => {
    const n = { ...newcomer, stages: newcomer.stages.map((s) => ({ ...s, status: (s.stage <= 2 ? "claimed" : s.stage === 3 ? "pending" : "locked") as "claimed" | "locked" | "pending" })) };
    expect(newcomerView(panel({}, { newcomer: n }))).toMatchObject({ day: 4, done: 3 });
  });
});

describe("限時積分到期條", () => {
  const now = new Date("2026-10-20T10:00:00+08:00").getTime();
  it("最早一批今天或明天到期才出現，只講最早那批", () => {
    expect(expiryNotice([{ amount: 300, expiresAt: "2026-10-21T04:00:00+08:00" }, { amount: 90, expiresAt: "2026-10-25T04:00:00+08:00" }], now, "Asia/Taipei"))
      .toEqual({ key: "credits.expiry.tomorrow", n: 300, at: "2026-10-21T04:00:00+08:00" });
    expect(expiryNotice([{ amount: 60, expiresAt: "2026-10-20T23:00:00+08:00" }], now, "Asia/Taipei")).toMatchObject({ key: "credits.expiry.today" });
    expect(expiryNotice([{ amount: 60, expiresAt: "2026-10-23T04:00:00+08:00" }], now, "Asia/Taipei")).toBeNull();
    expect(expiryNotice([], now, "Asia/Taipei")).toBeNull();
  });
});

describe("任務列", () => {
  const base = { progress: 2, target: 5, reward: { credits: 30 }, status: "locked" as const, period: "2026-10-20" };
  it("每種任務的標題、進度與按鈕", () => {
    expect(taskView({ ...base, id: "chat5", type: "turns" })).toMatchObject({ title: "task.chat5.title", progress: "task.progress.turns", cta: "task.cta.chat" });
    expect(taskView({ ...base, id: "try", type: "new_work_turns" })).toMatchObject({ title: "task.tryNew.title", cta: "task.cta.tryNew" });
    expect(taskView({ ...base, id: "share", type: "share_open" })).toMatchObject({ title: "task.shareOpen.title", cta: "task.cta.copyLink" });
    expect(taskView({ ...base, id: "w1", type: "active_days" })).toMatchObject({ title: "task.weeklyChat.title", progress: "task.progress.days" });
    expect(taskView({ ...base, id: "w2", type: "share_open_distinct" })).toMatchObject({ title: "task.weeklyShare.title", progress: "task.progress.people" });
    expect(taskView({ ...base, id: "w3", type: "author_replies" })).toMatchObject({ title: "task.authorReply.title", progress: "task.progress.items", cta: "task.cta.reply" });
  });
  it("不適用的不出現", () => {
    expect(taskView({ ...base, id: "w3", type: "author_replies", status: "unavailable" })).toBeNull();
  });
});

describe("領取的冪等鍵", () => {
  beforeEach(() => sessionStorage.clear());
  it("同一件事在確認之前一直用同一個鍵，確認後換新的", () => {
    const a = requestIdFor("checkin:2026-10-20");
    expect(requestIdFor("checkin:2026-10-20")).toBe(a);
    clearRequestId("checkin:2026-10-20");
    expect(requestIdFor("checkin:2026-10-20")).not.toBe(a);
  });
});

// 簽到頁（含機率公告）自己一個來源標記，事件不再被算成 404（B7 讀回）
import { surfaceOf } from "../src/router";
it("簽到頁的來源標記是 checkin", () => {
  expect(surfaceOf("/checkin")).toBe("checkin");
  expect(surfaceOf("/en/checkin/odds")).toBe("checkin");
});


// 月卡轉址頁（/go/plan）也有自己的來源標記，點擊事件不會被算成 404
it("月卡轉址頁的來源標記是 plan", () => {
  expect(surfaceOf("/go/plan")).toBe("plan");
  expect(surfaceOf("/ja/go/plan")).toBe("plan");
});
