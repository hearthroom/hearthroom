/*
 * 開箱滾輪的編排，第 1 版（Harper 回應的 stripVersion = 1）。
 *
 * 結果由伺服器先抽好（tier），這裡只決定「滾輪上排哪些格、停在格內哪裡」：
 * 以伺服器給的 stripSeed 做亂數，同一個 (獎表, tier, stripSeed) 永遠排出同一條軌道，
 * 抽取紀錄因此能照當時的樣子重現。演算法改版要另開 v2.ts，這份不能再改行為，
 * 否則舊紀錄的滾輪會和當時看到的不一樣（AppRewards 技術設計 §5.4）。
 *
 * 移植自技術美術的原型 reel-core.js（任務 2026-10-19-checkin-hearthroom-experience/proto，美術總監 r4 簽核）。
 * 和原型的差別：金額、級名、期限不在這裡，全部來自獎表、領取結果與語系檔；
 * 造型道具格是獎表裡真的那一格，不另外隨機；獎表可以少於 6 格。
 * 位置以「格」計：pos = 目前在指針下的格序號，小數是格內位置。
 */

export interface ReelPrize {
  tier: number;
  credits?: number;
  item?: string;
  bps: number;
}

export interface ReelCell {
  tier: number;
  prize: ReelPrize;
}

export type GrazeSide = "L" | "R";
export interface Graze { side: GrazeSide; dist: number; tier: number }
export type GrazeOverride = { none: true } | { dist?: number; tier?: number; side?: GrazeSide };

export const DEFAULTS = {
  // 開蓋與加速重疊：滾輪在開蓋進行到 open - overlap 時起跑（art.md §14 #1）
  open: 600,
  overlap: 300,
  accel: 300,
  cruise: 1000,
  decel: 3000,
  // 減速冪次，越大尾巴越長
  decelPow: 3,
  // 停住到出結果
  hold: 400,
  // 減速段最後幾格，每過一格輕震（按格數，不按時間）
  hapticCells: 8,
  // 跳過後停到同一位置
  skipDur: 600,
  // 起點到停點的格數；指針左邊一開始就有的格數；停點右邊的格數
  cells: 42,
  lead: 4,
  tail: 6,
  // 停點離格中心最多幾格距；格身約 0.9 格距，離邊至少約 25%
  maxOff: 0.22,
  // 金色格（第 5、6 級）落在停點兩格內的機率，其中第 6 級的比例、緊鄰的比例、在右邊的比例
  goldNearP: 0.18,
  goldNear6: 0.6,
  goldNearAdj: 0.8,
  rightShare: 0.3,
  // 另外安排第 4 級擦過的機率；隔 3 格的金色格（手機上停住時已出畫面）
  fourP: 0.45,
  goldFarP: 0.1,
};
export type ReelParams = typeof DEFAULTS;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Kinematics { pos(tMs: number): number; v: number; xa: number; xc: number; total: number }

// 加速（二次）→ 巡航（等速）→ 減速（冪次 ease-out），速度在接點連續。
export function makeKinematics(p: ReelParams, distance: number): Kinematics {
  const ta = p.accel / 1000, tc = p.cruise / 1000, td = p.decel / 1000, n = p.decelPow;
  const v = distance / (ta / 2 + tc + td / n);
  const xa = (v * ta) / 2;
  const xc = xa + v * tc;
  const A = (v * td) / n;
  const total = ta + tc + td;
  function pos(tMs: number) {
    const t = Math.max(0, tMs) / 1000;
    if (t <= 0) return 0;
    if (t < ta) return (v / (2 * ta)) * t * t;
    if (t < ta + tc) return xa + v * (t - ta);
    if (t < total) {
      const s = (t - ta - tc) / td;
      return xc + A * (1 - Math.pow(1 - s, n));
    }
    return distance;
  }
  return { pos, v, xa, xc, total: total * 1000 };
}

// 跳過：從目前位置與速度出發，Hermite 三次曲線在 dur 內以速度 0 停到終點。只往前。
export function makeSkip(kin: Kinematics, tMs: number, dur: number, distance: number) {
  const x0 = kin.pos(tMs);
  const t1 = Math.max(0, tMs - 1), t2 = tMs + 1;
  const v0raw = ((kin.pos(t2) - kin.pos(t1)) / (t2 - t1)) * 1000;
  const d = distance - x0;
  const durS = dur / 1000;
  const v0 = Math.max(0, Math.min(v0raw, d <= 0 ? 0 : (3 * d) / durS));
  function pos(sinceSkipMs: number) {
    const u = Math.min(1, Math.max(0, sinceSkipMs / dur));
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2;
    return x0 * h00 + durS * v0 * h10 + distance * h01;
  }
  return { pos, x0, v0 };
}

export interface BuildOptions {
  prizes: ReelPrize[];
  // 伺服器抽中的級（1..prizes.length）
  tier: number;
  seed: number;
  params?: Partial<ReelParams>;
  graze?: GrazeOverride;
  off?: number;
}

export interface Track {
  cells: ReelCell[];
  s0: number;
  T: number;
  N: number;
  off: number;
  finalPos: number;
  nearMissBig: boolean;
  tier: number;
  params: ReelParams;
  kin: Kinematics;
  grazes: Graze[];
}

export function buildTrack(opts: BuildOptions): Track {
  const p: ReelParams = { ...DEFAULTS, ...opts.params };
  const prizes = [...opts.prizes].sort((a, b) => a.tier - b.tier);
  const top = prizes.length;
  const rnd = mulberry32(opts.seed);
  const k = Math.min(Math.max(1, opts.tier), top);
  const N = p.cells;
  const s0 = p.lead;
  const T = s0 + N;
  const total = T + p.tail + 1;
  const cells: (ReelCell | null)[] = new Array(total).fill(null);
  const kin = makeKinematics(p, N);

  const cell = (tier: number): ReelCell => ({ tier, prize: prizes[tier - 1] });
  const pick = <V>(arr: V[]) => arr[Math.floor(rnd() * arr.length)];
  const fillerTier = (max: number) => {
    const w = [30, 28, 25, 17].slice(0, Math.min(max, top));
    const sum = w.reduce((a, b) => a + b, 0);
    let r = rnd() * sum;
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i + 1; }
    return w.length;
  };

  // 1) 停點與停點後
  cells[T] = cell(k);
  for (let i = T + 1; i < total; i++) cells[i] = cell(fillerTier(4));

  // 2) 擦過：要少、要不起眼，左右都可能（右邊＝差一點就轉到）。
  //    金色格（第 5、6 級）落在停點兩格內壓在 15–20%，其中第 6 級緊鄰 8–10%；其餘多用第 4 級或不安排。
  const g = opts.graze ?? {};
  const goldEl = [5, 6].filter((t) => t > k && t <= top);
  const fourOk = k < 4 && top >= 4;
  const grazes: Graze[] = [];
  const taken = new Set<number>();
  const put = (side: GrazeSide, dist: number, tier: number) => {
    const off = side === "R" ? dist : -dist;
    if (taken.has(off)) return;
    taken.add(off);
    grazes.push({ side, dist, tier });
  };
  if (!("none" in g && g.none)) {
    const forced = g as { dist?: number; tier?: number; side?: GrazeSide };
    if (forced.dist != null || forced.tier != null) {
      const ok = goldEl.concat(fourOk ? [4] : []);
      const tier = forced.tier != null && ok.includes(forced.tier) ? forced.tier : ok[ok.length - 1];
      if (tier) put(forced.side ?? "L", forced.dist ?? 1, tier);
    } else {
      if (goldEl.length && rnd() < p.goldNearP) {
        const t6 = goldEl.includes(6) && (goldEl.length === 1 || rnd() < p.goldNear6);
        put(rnd() < p.rightShare ? "R" : "L", rnd() < p.goldNearAdj ? 1 : 2, t6 ? 6 : goldEl[0]);
      }
      if (fourOk && rnd() < p.fourP) put(rnd() < 0.3 ? "R" : "L", 1 + Math.floor(rnd() * 3), 4);
      if (goldEl.length && rnd() < p.goldFarP) put("L", 3, pick(goldEl));
    }
  }
  for (const gz of grazes) cells[gz.side === "R" ? T + gz.dist : T - gz.dist] = cell(gz.tier);
  // 停點前的填充上限：擦過的格在附近仍然讀得出來
  const cap = Math.min(4, k + 2);
  for (let i = T - 8; i < T; i++) if (i >= 0 && !cells[i]) cells[i] = cell(fillerTier(cap));

  // 3) 巡航區：第 6 級至少 2 次、第 5 級至少 1 次經過指針
  const lo = Math.ceil(s0 + kin.xa) + 1;
  const hi = Math.floor(s0 + kin.xc) - 1;
  const windowCells: number[] = [];
  for (let i = lo; i <= hi; i++) if (!cells[i]) windowCells.push(i);
  const want6 = hi - lo >= 18 ? 3 : 2;
  const want5 = hi - lo >= 18 ? 2 : 1;
  const used: number[] = [];
  const place = (tier: number, count: number) => {
    if (tier > top) return;
    for (let c = 0; c < count; c++) {
      const free = windowCells.filter((i) => !cells[i] && used.every((u) => Math.abs(u - i) >= 3));
      if (!free.length) break;
      const i = pick(free);
      cells[i] = cell(tier);
      used.push(i);
    }
  };
  place(6, want6);
  place(5, want5);

  // 4) 其餘填充（只用第 1..4 級；第 5、6 級只出現在上面規劃的位置）
  for (let i = 0; i < total; i++) if (!cells[i]) cells[i] = cell(fillerTier(4));

  // 5) 停點偏移（以格距計，固定上限內隨機，或指定）
  const off = opts.off ?? (rnd() * 2 - 1) * p.maxOff;

  const full = cells as ReelCell[];
  // 差一點中頭獎：停住後第 6 級緊鄰停點，左右都算；只有這時蘇綺懊惱
  const nearMissBig = top >= 6 && k < 6 && (full[T - 1].tier === 6 || full[T + 1].tier === 6);

  return { cells: full, s0, T, N, off, finalPos: T + off, nearMissBig, tier: k, params: p, kin, grazes };
}

// 指針位置（格）隨時間的函數；skipAtMs 之後換成跳過曲線。
export function positionAt(track: Track, tMs: number, skipAtMs: number | null = null) {
  const { kin, params: p, s0, N } = track;
  const scale = (track.finalPos - s0) / N;
  if (skipAtMs != null && tMs >= skipAtMs) {
    const skip = makeSkip(kin, skipAtMs, p.skipDur, N);
    return s0 + skip.pos(tMs - skipAtMs) * scale;
  }
  return s0 + kin.pos(tMs) * scale;
}

// 指針下的格序號隨時間的完整紀錄（驗證、音效與觸覺的節拍用）。倒退就丟錯。
export function crossings(track: Track, skipAtMs: number | null) {
  const { kin, params: p, s0, N } = track;
  const scale = (track.finalPos - s0) / N;
  const skip = skipAtMs != null ? makeSkip(kin, skipAtMs, p.skipDur, N) : null;
  const end = skip ? skipAtMs! + p.skipDur : kin.total;
  const out: { tMs: number; idx: number; tier: number }[] = [];
  let last = Math.round(s0);
  for (let t = 0; t <= end; t += 2) {
    const x = s0 + (skip && t >= skipAtMs! ? skip.pos(t - skipAtMs!) : kin.pos(t)) * scale;
    const idx = Math.round(x);
    while (last < idx) { last++; out.push({ tMs: t, idx: last, tier: track.cells[last].tier }); }
    if (idx < last) throw new Error(`reel moved backwards at t=${t}`);
  }
  return { out, end };
}
