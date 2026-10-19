/**
 * 假的 Harbor 應用獎勵（簽到、開箱、任務、新手七日），給本機開發、ui-sim-test 與 QA 走查用。
 * 形狀照 AppRewards 技術設計 V0.2d §10.2；規則只做到畫面需要的程度，不是 Harbor 的實作。
 *
 * 切換情境：GET /__rewards?preset=<名稱>[&tier=1..6][&graze=near][&account=fresh]，或 POST /__rewards {preset, ...}。
 *   account=fresh 換一個新帳號（/open/v1/me 的帳號號碼加一）：Worker 端「今天彈過提示卡沒」這類記在
 *                 D1 的狀態跟著重來，不用動資料庫。不帶就沿用目前的帳號。
 *   first        從沒簽過（新帳號，含新手七日第 1 天）
 *   normal       連續 8 天，今天一般寶箱
 *   day3 / day7  今天是第 3、7 天
 *   two          連續 13 天，今天第 7 天寶箱＋連續 14 天寶箱
 *   done         今天簽過了
 *   brokenCard   連續 17 天，昨天漏簽，有補簽卡可用
 *   brokenNoCard 連續 17 天，漏了兩天，補不回來
 *   newcomer4    新手七日完成 3 天，今天第 4 天的目標
 *   newcomer7    新手七日完成 6 天，今天可以開新住民寶箱
 *   pending      點數池不足：領取回 pending（有 releaseAt，沒有抽獎欄位）
 *   slow         簽到要 2.5 秒才回（看等待句）
 *   fail         簽到回 503（看錯誤與重試）
 *   elsewhere    另一台裝置先簽了：簽到回 replayed
 *   expiring     有限時積分明天到期
 *   empty        沒有任何紀錄與限時積分
 * tier 強制下一次開箱的級數（1..6），方便拍各級；graze=near 再挑一個讓第 6 級緊鄰停點的 stripSeed（差一點中頭獎、蘇綺懊惱），
 * graze=none 挑一個完全不擦過的。滾輪用的是網站自己的編排（web/src/lib/reel/v1.ts），所以畫面一定對得上。
 */
let reel = null;
const reelReady = import("../web/src/lib/reel/v1.ts").then((m) => { reel = m; }).catch(() => { /* 舊版 Node 讀不了 .ts：graze 失效，其餘照常 */ });
const TZ_OFFSET_H = 8;
const DAY = 86_400_000;

export const PLAN = {
  version: 3, updatedAt: "2026-10-19T12:00:00+08:00", drawRetentionDays: 180, timezone: "Asia/Taipei", dayStartHour: 4,
  pity: { threshold: 900, every: 30, chests: ["daily", "day3", "day7", "m14", "m28"] },
  chests: Object.fromEntries(Object.entries({
    daily: [[60, 4000], [90, 3000], [150, 1800], [300, 900], [900, 250], [3000, 50]],
    day3: [[90, 3500], [150, 3000], [240, 2000], [450, 1000], [1200, 400], [3000, 100]],
    day7: [[150, 3000], [240, 3000], [450, 2000], [900, 1200], [2400, 600], [6000, 200]],
    m14: [[300, 4000], [450, 3000], [900, 1800], [1500, 900], [3000, 250], [6000, 50]],
    m28: [[750, 4000], [1200, 3000], [1800, 1800], [3000, 900], [6000, 250], [15000, 50]],
    daily_all: [[30, 4000], [60, 3000], [90, 1800], [150, 900], [450, 250], [1500, 50]],
    weekly_active: [[90, 4000], [150, 3000], [240, 1800], [450, 900], [{ item: "frame_moon", duplicateCredits: 300 }, 250], [3000, 50]],
    weekly_share: [[90, 4000], [150, 3000], [240, 1800], [450, 900], [1200, 250], [3000, 50]],
    newcomer: [[300, 4000], [450, 3000], [600, 1800], [900, 900], [1500, 250], [3000, 50]],
  }).map(([k, rows]) => {
    const prizes = rows.map(([v, bps], i) => (typeof v === "object" ? { tier: i + 1, item: v.item, bps } : { tier: i + 1, credits: v, bps }));
    const expectedValue = Math.round(prizes.reduce((s, p) => s + (p.credits ?? 0) * p.bps, 0) / 10000);
    return [k, { prizes, expectedValue }];
  })),
  checkin: { cycle: ["daily", "daily", "day3", "daily", "daily", "daily", "day7"], checkpointEvery: 7, milestoneCycle: 28, milestones: [{ at: 14, chest: "m14" }, { at: 28, chest: "m28" }], makeupPerMonth: 1, makeupWindowDays: 7 },
};

const EXPIRY = [[90, 2], [300, 3], [900, 5], [1200, 7], [3000, 10], [6000, 14], [Infinity, 20]];
const tpe = (ms) => new Date(ms + TZ_OFFSET_H * 3600e3);
const iso = (ms) => { const d = tpe(ms); return `${d.toISOString().slice(0, 19)}+08:00`; };
// 業務日：台北 04:00 換日
const businessDay = (ms) => tpe(ms - 4 * 3600e3).toISOString().slice(0, 10);
const boundary = (day) => Date.parse(`${day}T04:00:00+08:00`);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const expiresAt = (credits, now) => iso(boundary(addDays(businessDay(now), (EXPIRY.find(([max]) => credits <= max) ?? [0, 20])[1] + 1)));

let seed = 1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const u32 = () => Math.floor(rnd() * 0xffffffff) >>> 0;

function freshState(preset = "normal") {
  return { graze: null, preset, streak: 8, lastDay: null, missed: 0, makeupLeft: 1, pity: 4, history: [], todayClaims: [], forceTier: null, tasks: {}, newcomer: null, delay: 0, fail: false, pending: false, expiring: [], elsewhere: false, madeUp: [] };
}
let S = freshState();
let account = 424242;
/** 假的 /open/v1/me 用的帳號號碼 */
export const mockAccountNumId = () => account;

export function setPreset(preset, opts = {}) {
  const now = Date.now();
  const today = businessDay(now);
  S = freshState(preset);
  S.forceTier = opts.tier ? Number(opts.tier) : null;
  S.graze = opts.graze || null;
  if (opts.account === "fresh") account += 1;
  const yesterday = addDays(today, -1);
  const at = (streak, lastDay) => { S.streak = streak; S.lastDay = lastDay; };
  switch (preset) {
    case "first": at(0, null); S.newcomer = { done: 0, todayDone: false }; S.pity = 30; break;
    case "day3": at(2, yesterday); break;
    case "day7": at(6, yesterday); break;
    case "two": at(13, yesterday); break;
    case "done": at(8, yesterday); checkinNow(now); break;
    case "brokenCard": at(17, addDays(today, -2)); break;
    case "brokenNoCard": at(17, addDays(today, -3)); break;
    case "newcomer4": at(3, yesterday); S.newcomer = { done: 3, todayDone: false }; break;
    case "newcomer7": at(6, yesterday); S.newcomer = { done: 6, todayDone: false, grand: true }; break;
    case "pending": at(8, yesterday); S.pending = true; break;
    case "slow": at(8, yesterday); S.delay = 2500; break;
    case "fail": at(8, yesterday); S.fail = true; break;
    case "elsewhere": at(8, yesterday); S.elsewhere = true; break;
    case "expiring": at(8, yesterday); S.expiring = [{ amount: 300, expiresAt: iso(boundary(addDays(today, 1))) }, { amount: 150, expiresAt: iso(boundary(addDays(today, 3))) }]; break;
    case "empty": at(0, null); break;
    default: at(8, yesterday);
  }
  if (preset !== "empty" && preset !== "first") {
    for (let i = 1; i <= 7; i++) S.history.push(draw("daily", now - i * DAY, i === 3 ? 4 : 1 + (i % 3)));
  }
  return S;
}

function draw(chest, now = Date.now(), tier = null) {
  const box = PLAN.chests[chest];
  let t = tier ?? S.forceTier;
  if (!t) {
    const pityHit = PLAN.pity.chests.includes(chest) && S.pity >= PLAN.pity.every - 1;
    const pool = pityHit ? box.prizes.filter((p) => (p.credits ?? PLAN.pity.threshold) >= PLAN.pity.threshold) : box.prizes;
    const sum = pool.reduce((s, p) => s + p.bps, 0);
    let r = rnd() * sum;
    t = pool[pool.length - 1].tier;
    for (const p of pool) { r -= p.bps; if (r < 0) { t = p.tier; break; } }
  }
  const prize = box.prizes[t - 1];
  if (PLAN.pity.chests.includes(chest)) S.pity = (prize.credits ?? PLAN.pity.threshold) >= PLAN.pity.threshold ? 0 : S.pity + 1;
  const credits = prize.credits ?? (prize.item ? 300 : 0);
  let stripSeed = u32();
  if (S.graze && reel) {
    const want = (tr) => (S.graze === "near" ? tr.nearMissBig : tr.grazes.length === 0);
    for (let tries = 0; tries < 5000 && !want(reel.buildTrack({ prizes: box.prizes, tier: t, seed: stripSeed })); tries++) stripSeed = u32();
  }
  const out = {
    rewardKey: `${chest}:${businessDay(now)}:${u32()}`, status: "granted", chest, prizeIndex: t - 1, tier: t, planVersion: PLAN.version,
    stripSeed, stripVersion: 1, duplicate: false, pityRemaining: Math.max(PLAN.pity.every - S.pity, 1),
  };
  if (prize.item) Object.assign(out, { item: prize.item, duplicate: S.history.some((h) => h.item === prize.item) });
  if (!prize.item || out.duplicate) Object.assign(out, { credits, expiresAt: expiresAt(credits, now) });
  return { ...out, at: iso(now), rewardKind: chest.startsWith("weekly") || chest === "daily_all" ? "task" : chest === "newcomer" ? "newcomer" : "checkin" };
}

const cycleChest = (streak) => PLAN.checkin.cycle[(streak - 1) % 7];
const milestoneOf = (streak) => PLAN.checkin.milestones.find((m) => streak % 28 === m.at % 28)?.chest ?? null;

function checkinNow(now) {
  const today = businessDay(now);
  const gap = S.lastDay ? (Date.parse(today) - Date.parse(S.lastDay)) / DAY : Infinity;
  S.streak = gap === 1 ? S.streak + 1 : 7 * Math.floor(S.streak / 7) + 1;
  S.lastDay = today;
  const chests = [cycleChest(S.streak)];
  const ms = milestoneOf(S.streak);
  if (ms) chests.push(ms);
  const claims = chests.map((c) => {
    if (S.pending) return { rewardKey: `checkin:${today}:${c}`, status: "pending", releaseAt: iso(boundary(addDays(today, 7))) };
    const d = draw(c, now);
    S.history.unshift(d);
    return d;
  });
  S.todayClaims.push(...claims);
  return { claims: claims.map(({ at: _a, rewardKind: _k, ...c }) => c), streak: S.streak, replayed: false };
}

function panel(now) {
  const today = businessDay(now);
  const claimedToday = S.lastDay === today;
  const gap = S.lastDay ? (Date.parse(today) - Date.parse(S.lastDay)) / DAY : null;
  const broken = !claimedToday && gap != null && gap > 1;
  const repairable = broken && gap === 2 && S.makeupLeft > 0;
  const nextStreak = claimedToday ? S.streak : gap === 1 || S.lastDay == null ? S.streak + 1 : 7 * Math.floor(S.streak / 7) + 1;
  const pos = claimedToday ? (S.streak - 1) % 7 : broken ? (S.streak % 7) + gap - 1 : (nextStreak - 1) % 7;
  const base = claimedToday ? S.streak - pos : broken ? S.streak - (S.streak % 7 === 0 ? 7 : S.streak % 7) + 1 : nextStreak - pos;
  const track = PLAN.checkin.cycle.map((chest, i) => {
    let status = "future";
    if (claimedToday) status = i <= pos ? "claimed" : "future";
    else if (broken) { const filled = S.streak % 7 === 0 ? 7 : S.streak % 7; status = i < filled ? "claimed" : i < pos ? "missed" : i === pos ? "today" : "future"; }
    else status = i < pos ? "claimed" : i === pos ? "today" : "future";
    if (S.madeUp.includes(base + i)) status = "made_up";
    return { day: addDays(today, i - pos), chest, status };
  });
  const todayChests = claimedToday ? [] : broken && !repairable ? [cycleChest(7 * Math.floor(S.streak / 7) + 1)] : [cycleChest(nextStreak), milestoneOf(nextStreak)].filter(Boolean);
  const msTarget = (() => { const s = claimedToday ? S.streak : nextStreak - 1; let d = s + 1; while (!milestoneOf(d)) d++; return { day: d, chest: milestoneOf(d), inDays: d - s }; })();
  const tasks = taskList(today, now);
  const n = S.newcomer;
  return {
    serverNow: iso(now), businessDay: today, nextResetAt: iso(boundary(addDays(today, 1))),
    weekResetAt: iso(boundary(addDays(today, 7 - ((new Date(Date.parse(today)).getUTCDay() + 6) % 7)))), planVersion: PLAN.version,
    checkin: {
      streak: S.streak, todayClaimed: claimedToday, todayChests,
      fallback: broken ? { from: S.streak, checkpoint: 7 * Math.floor(S.streak / 7), to: 7 * Math.floor(S.streak / 7) + 1 } : null,
      track, nextMilestone: msTarget,
      makeup: { left: S.makeupLeft, repairableDays: repairable ? [{ day: addDays(today, -1), deadline: iso(boundary(addDays(today, 1))) }] : [] },
    },
    pityRemaining: Math.max(PLAN.pity.every - S.pity, 1),
    today: { claims: S.todayClaims },
    tasks,
    newcomer: n ? {
      active: true, stage: n.done, deadline: iso(boundary(addDays(today, 14 - n.done))),
      today: { stage: Math.min(7, n.done + 1), goal: `stage${Math.min(7, n.done + 1)}`, progress: n.grand ? 1 : n.todayDone ? 3 : 1, target: n.grand ? 1 : 3, status: n.todayDone ? "claimed" : n.grand ? "claimable" : "locked" },
      stages: [1, 2, 3, 4, 5, 6, 7].map((s) => ({ stage: s, credits: s <= 2 ? 300 : s < 7 ? 200 : undefined, chest: s === 7 ? "newcomer" : undefined, done: s <= n.done })),
    } : null,
    credits: { expiring: S.expiring },
    hints: [],
  };
}

function taskList(today, now) {
  const st = (id, progress, target) => S.tasks[id] ?? (progress >= target ? "claimable" : "locked");
  const d = (id, type, progress, target, reward) => ({ id, type, progress: Math.min(progress, target), target, reward, status: st(id, progress, target), period: today });
  // 新帳號（first、empty）今天什麼都還沒做：任務從 0 開始
  const fresh = S.preset === "first" || S.preset === "empty";
  const p = (n) => (fresh ? 0 : n);
  const daily = [d("chat5", "turns", p(5), 5, { credits: 30 }), d("chat15", "turns", p(12), 15, { credits: 40 }), d("try_new", "new_work_turns", 0, 3, { credits: 30 }), d("share_open", "share_open", p(1), 1, { credits: 30 })];
  const doneCount = daily.filter((t) => t.status === "claimed").length;
  const dailyAll = { id: "daily_all", type: "daily_all", progress: doneCount, target: daily.length, reward: { chest: "daily_all" }, status: S.tasks.daily_all ?? (doneCount === daily.length ? "claimable" : "locked"), period: today };
  const week = addDays(today, -((new Date(Date.parse(today)).getUTCDay() + 6) % 7));
  const w = (id, type, progress, target, reward) => ({ id, type, progress: Math.min(progress, target), target, reward, status: S.tasks[id] ?? (progress >= target ? "claimable" : "locked"), period: week });
  const weekly = [w("weekly_active", "active_days", p(3), 5, { chest: "weekly_active" }), w("author_reply", "author_replies", 0, 3, { credits: 150 }), w("weekly_share", "share_open_distinct", p(5), 5, { chest: "weekly_share" })];
  if (S.preset === "first") weekly[1].status = "unavailable";
  return { daily, weekly, dailyAll };
}

/** 回傳 true 表示這支處理了請求。 */
export async function handleRewards({ m, path, url, body, json, res }) {
  const now = Date.now();
  if (path === "/__rewards") { await reelReady; setPreset(url.searchParams.get("preset") || body.preset || "normal", { tier: url.searchParams.get("tier") || body.tier, graze: url.searchParams.get("graze") || body.graze, account: url.searchParams.get("account") || body.account }); json(res, 200, { preset: S.preset, accountNumId: account }); return true; }
  let mm;
  if ((mm = path.match(/^\/open\/v1\/apps\/([^/]+)\/rewards\/plan$/))) { json(res, 200, PLAN); return true; }
  if (!path.startsWith("/open/v1/me/rewards")) return false;
  if (m === "GET" && path === "/open/v1/me/rewards") { json(res, 200, panel(now)); return true; }
  if (m === "POST" && path === "/open/v1/me/rewards/checkin") {
    if (S.delay) await new Promise((r) => setTimeout(r, S.delay));
    if (S.fail) { json(res, 503, { error: "service_unavailable" }); return true; }
    // 今天已經用別的 requestId 簽過（另一台裝置）：409 already_claimed 附原結果（契約）；同一個 requestId 重送才是 replayed
    if (S.elsewhere) { S.elsewhere = false; const r = checkinNow(now); json(res, 409, { error: "already_claimed", claims: r.claims }); return true; }
    if (S.lastDay === businessDay(now)) {
      const claims = S.todayClaims.map(({ at: _a, rewardKind: _k, ...c }) => c);
      if (body.requestId && body.requestId === S.lastRequestId) json(res, 200, { claims, streak: S.streak, replayed: true });
      else json(res, 409, { error: "already_claimed", claims });
      return true;
    }
    S.lastRequestId = body.requestId;
    json(res, 200, checkinNow(now)); return true;
  }
  if (m === "POST" && path === "/open/v1/me/rewards/makeup") {
    if (S.makeupLeft < 1) { json(res, 422, { error: "not_eligible", reason: "no_makeup_left" }); return true; }
    S.makeupLeft -= 1; S.madeUp.push(S.streak + 1); S.streak += 1; S.lastDay = addDays(businessDay(now), -1);
    const d = draw(cycleChest(S.streak), now); S.history.unshift(d);
    json(res, 200, { claims: [d], streak: S.streak, replayed: false }); return true;
  }
  if (m === "POST" && (mm = path.match(/^\/open\/v1\/me\/rewards\/tasks\/([^/]+)\/claim$/))) {
    const id = decodeURIComponent(mm[1]);
    const all = [...taskList(businessDay(now), now).daily, ...taskList(businessDay(now), now).weekly, taskList(businessDay(now), now).dailyAll];
    const t = all.find((x) => x.id === id);
    if (!t || t.status !== "claimable") { json(res, 422, { error: "not_eligible", reason: "progress" }); return true; }
    S.tasks[id] = "claimed";
    if (t.reward.chest) { const d = draw(t.reward.chest, now); S.history.unshift(d); S.todayClaims.push(d); json(res, 200, { claim: d }); return true; }
    json(res, 200, { claim: { rewardKey: `task:${id}`, status: "granted", credits: t.reward.credits, expiresAt: expiresAt(t.reward.credits, now), duplicate: false } }); return true;
  }
  if (m === "POST" && path === "/open/v1/me/rewards/newcomer/claim") {
    const n = S.newcomer;
    if (!n) { json(res, 422, { error: "not_eligible", reason: "progress" }); return true; }
    if (n.grand) { n.done = 7; n.todayDone = true; const d = { ...draw("newcomer", now), item: "hearth_newcomer" }; S.history.unshift(d); json(res, 200, { claim: d }); return true; }
    n.done += 1; n.todayDone = true;
    json(res, 200, { claim: { rewardKey: `newcomer:${n.done}`, status: "granted", credits: 200, expiresAt: expiresAt(200, now), duplicate: false } }); return true;
  }
  if (path === "/open/v1/me/rewards/draws") {
    const page = Number(url.searchParams.get("cursor") || 0);
    const list = S.history.slice(page, page + 30).map((d) => ({ ...d, pity: false }));
    json(res, 200, { list, nextCursor: page + 30 < S.history.length ? String(page + 30) : null }); return true;
  }
  if (path === "/open/v1/me/rewards/items") { json(res, 200, { items: S.history.filter((h) => h.item).map((h) => ({ key: h.item, grantedAt: h.at })) }); return true; }
  return false;
}

/** 錢包：限時積分的總額與逐筆明細（契約形狀 score／tempScore／expiries），跟著情境走。 */
export function walletExtras() {
  const expiries = S.expiring.map((e) => ({ ...e, kind: "checkin" }));
  return { tempScore: expiries.reduce((s, e) => s + e.amount, 0), expiries };
}

setPreset("normal");
