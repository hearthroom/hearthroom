/**
 * 簽到頁的狀態推導：從 Harbor 面板算出畫面要畫什麼。純函式，不碰 DOM 與網路。
 * 規格：任務 2026-10-19-checkin-hearthroom-experience 的 ui.md §3–§7、§10；字的鍵照 copy.md。
 * 數字一律從面板與獎表來，這裡不寫死 7、14、28、04:00。
 */
import type { RewardPlan, RewardsPanel, RewardTask } from "./rewards";

export type HeroState = "first" | "normal" | "day3" | "day7" | "two" | "done" | "brokenCard" | "brokenNoCard";

/** 斷簽時補得回來嗎：看伺服器算好的 repairableDays，不是手上有沒有卡（漏了兩天以上就補不回來）。 */
export const canRepair = (p: RewardsPanel): boolean => p.checkin.makeup.left > 0 && p.checkin.makeup.repairableDays.length > 0;

export function heroState(p: RewardsPanel): HeroState {
  const c = p.checkin;
  if (c.todayClaimed) return "done";
  if (c.fallback) return canRepair(p) ? "brokenCard" : "brokenNoCard";
  if (c.streak === 0) return "first";
  if (c.todayChests.length >= 2) return "two";
  if (c.todayChests[0] === "day3") return "day3";
  if (c.todayChests[0] === "day7") return "day7";
  return "normal";
}

/** 連續天數 chip：補得回來時照原本的天數；補不回來時顯示退回的天數，旁邊寫原本。 */
export function streakChip(p: RewardsPanel): { first: boolean; n: number; was: number | null } {
  const s = heroState(p);
  const f = p.checkin.fallback;
  if (s === "first") return { first: true, n: 0, was: null };
  if (s === "brokenNoCard" && f) return { first: false, n: f.checkpoint, was: f.from };
  if (s === "brokenCard" && f) return { first: false, n: f.from, was: null };
  return { first: false, n: p.checkin.streak, was: null };
}

export type NodeState = "done" | "today" | "todayDone" | "future" | "makeup" | "repairable";
export interface TrackNode { n: number; chest: string; better: boolean; state: NodeState }

const isBetter = (chest: string) => chest !== "daily";

/**
 * 七日軌道。漏簽的格不畫叉：補得回來就畫「可補簽」；補不回來時結果已定，
 * 直接畫今天簽到之後的新一輪（今天是第 1 格），Harper V0.2 §10.2 Q18。
 */
export function trackNodes(p: RewardsPanel): TrackNode[] {
  const c = p.checkin;
  const s = heroState(p);
  if (s === "brokenNoCard") {
    return c.track.map((t, i) => ({ n: i + 1, chest: t.chest, better: isBetter(t.chest), state: i === 0 ? "today" : "future" }));
  }
  const todayIndex = c.todayClaimed && c.streak > 0 ? (c.streak - 1) % c.track.length : -1;
  return c.track.map((t, i) => {
    let state: NodeState;
    if (i === todayIndex) state = "todayDone";
    else if (t.status === "claimed") state = "done";
    else if (t.status === "made_up") state = "makeup";
    else if (t.status === "missed") state = s === "brokenCard" ? "repairable" : "future";
    else if (t.status === "today") state = "today";
    else state = "future";
    return { n: i + 1, chest: t.chest, better: isBetter(t.chest), state };
  });
}

type PlanLike = Pick<RewardPlan, "checkin"> | { checkin?: RewardPlan["checkin"] } | null | undefined;

const milestoneDays = (chest: string, plan: PlanLike): number | null => {
  const hit = plan?.checkin?.milestones?.find((m) => m.chest === chest);
  if (hit) return hit.at;
  const m = /^m(\d+)$/.exec(chest);
  return m ? Number(m[1]) : null;
};

export interface MilestoneView { today: boolean; day: number; cur: number; max: number; left: number; ratio: number }

/** 里程碑條：從上一個存檔點到下一個。當天的箱子含里程碑箱時一律寫「今天」，不看 inDays 的邊界值。 */
export function milestoneView(p: RewardsPanel, plan: PlanLike): MilestoneView | null {
  const next = p.checkin.nextMilestone;
  if (!next) return null;
  const todayMilestone = p.checkin.todayChests.map((ch) => milestoneDays(ch, plan)).find((d) => d != null);
  const cur = streakChip(p).n;
  const spacing = spacingOf(plan);
  const from = Math.max(0, next.day - spacing);
  const ratio = Math.min(1, Math.max(0, (cur - from) / (next.day - from || 1)));
  if (todayMilestone != null) return { today: true, day: todayMilestone, cur, max: todayMilestone, left: 0, ratio };
  return { today: false, day: next.day, cur, max: next.day, left: next.inDays, ratio };
}

function spacingOf(plan: PlanLike): number {
  const at = (plan?.checkin?.milestones ?? []).map((m) => m.at).sort((a, b) => a - b);
  if (at.length >= 2) return at[1] - at[0];
  return at[0] ?? 14;
}

export interface CopyRef { key: string; params?: Record<string, string | number> }

const CHEST_KEY: Record<string, string> = {
  daily: "checkin.box.normal",
  day3: "checkin.box.day3",
  day7: "checkin.box.day7",
  daily_all: "checkin.box.dailyChest",
  weekly_active: "checkin.box.weeklyChat",
  weekly_share: "checkin.box.weeklyShare",
  newcomer: "checkin.box.newcomerGrand",
};

export function chestTitle(chest: string, plan: PlanLike): CopyRef {
  if (CHEST_KEY[chest]) return { key: CHEST_KEY[chest] };
  const days = milestoneDays(chest, plan);
  if (days != null) return { key: "checkin.box.milestone", params: { days } };
  return { key: "checkin.box.normal" };
}

export const isMilestoneChest = (chest: string, plan: PlanLike): boolean => !CHEST_KEY[chest] && milestoneDays(chest, plan) != null;

export function pityView(n: number | undefined): { key: string; n: number } | null {
  if (n == null || n < 1) return null;
  return { key: n === 1 ? "checkin.pity.next" : "checkin.pity", n };
}

/** 倒數：以伺服器的現在為準，扣掉讀回面板之後在這台裝置上經過的時間。不靠裝置時鐘與時區。 */
export function countdown(serverNow: string, target: string, fetchedAt: number, now: number): { h: number; m: number; totalMs: number } {
  const ms = Math.max(0, new Date(target).getTime() - new Date(serverNow).getTime() - (now - fetchedAt));
  const totalMin = Math.ceil(ms / 60_000);
  return { h: Math.floor(totalMin / 60), m: totalMin % 60, totalMs: totalMin * 60_000 };
}

export interface NewcomerView { day: number; done: number; left: number; todayDone: boolean; grand: boolean; finished: boolean }

export function newcomerView(p: RewardsPanel): NewcomerView | null {
  const n = p.newcomer;
  if (!n || !n.active) return null;
  const done = n.stages.filter((s) => s.done).length;
  const left = Math.max(0, Math.ceil((new Date(n.deadline).getTime() - new Date(p.serverNow).getTime()) / 86_400_000));
  const todayDone = n.today.status === "claimed";
  const total = n.stages.length || 7;
  return { day: Math.min(total, todayDone ? done : done + 1), done, left, todayDone, grand: !todayDone && done === total - 1, finished: done >= total };
}

const dayKey = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

/** 限時積分到期條：最早一批在今天或明天（使用者本地日曆）到期才出現，只講最早那批。 */
export function expiryNotice(
  expiring: { amount: number; expiresAt: string }[],
  now: number,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): { key: "credits.expiry.today" | "credits.expiry.tomorrow"; n: number; at: string } | null {
  const first = [...expiring].filter((e) => e.amount > 0).sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())[0];
  if (!first) return null;
  const at = new Date(first.expiresAt).getTime();
  const day = dayKey(at, timeZone);
  if (day === dayKey(now, timeZone)) return { key: "credits.expiry.today", n: first.amount, at: first.expiresAt };
  if (day === dayKey(now + 86_400_000, timeZone)) return { key: "credits.expiry.tomorrow", n: first.amount, at: first.expiresAt };
  return null;
}

export type TaskCta = "chat" | "tryNew" | "comment" | "rate" | "copyLink" | "reply";
export interface TaskView { title: string; progress: string; cta: string; action: TaskCta; chest: boolean }

const TASKS: Record<string, { title: string; progress: string; action: TaskCta }> = {
  turns: { title: "task.chat5.title", progress: "task.progress.turns", action: "chat" },
  new_work_turns: { title: "task.tryNew.title", progress: "task.progress.turns", action: "tryNew" },
  comment: { title: "task.comment.title", progress: "task.progress.items", action: "comment" },
  rating: { title: "task.rate.title", progress: "task.progress.items", action: "rate" },
  share_open: { title: "task.shareOpen.title", progress: "task.progress.people", action: "copyLink" },
  active_days: { title: "task.weeklyChat.title", progress: "task.progress.days", action: "chat" },
  author_replies: { title: "task.authorReply.title", progress: "task.progress.items", action: "reply" },
  share_open_distinct: { title: "task.weeklyShare.title", progress: "task.progress.people", action: "copyLink" },
};

/** 任務列的字與去處。伺服器說不適用的（例如沒發布過卡的人看到作者回覆）整列不出現。 */
export function taskView(task: RewardTask): TaskView | null {
  if (task.status === "unavailable") return null;
  const def = TASKS[task.type] ?? TASKS.turns;
  return { title: def.title, progress: def.progress, cta: `task.cta.${def.action}`, action: def.action, chest: !!task.reward.chest };
}

const REQ_PREFIX = "hr.rewards.req.";

/**
 * 領取的冪等鍵：送出前產生並暫存在這個分頁，回應到達或確定失敗後才清掉。
 * 重新整理後還留著的鍵，再送一次會拿回原本的結果，不會重複發放。
 */
export function requestIdFor(scope: string): string {
  try {
    const hit = sessionStorage.getItem(REQ_PREFIX + scope);
    if (hit) return hit;
  } catch { /* 私密模式等，照樣產生 */ }
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try { sessionStorage.setItem(REQ_PREFIX + scope, id); } catch { /* ignore */ }
  return id;
}
export function clearRequestId(scope: string): void {
  try { sessionStorage.removeItem(REQ_PREFIX + scope); } catch { /* ignore */ }
}
