// 開箱滾輪第 1 版編排的不變量。移植自技術美術原型的 check.mjs（docs/studio/tasks/2026-10-19-checkin-hearthroom-experience/proto/），
// 硬規則來自 art.md §4、§8、§11、§14 與 art-review-r2 ①；比例目標是美術總監簽過的區間。
import { describe, expect, it } from "vitest";
import { buildTrack, crossings, mulberry32, type ReelPrize } from "../src/lib/reel/v1";

const box = (credits: number[], bps: number[]): ReelPrize[] => credits.map((c, i) => ({ tier: i + 1, credits: c, bps: bps[i] }));
const DAILY = box([60, 90, 150, 300, 900, 3000], [4000, 3000, 1800, 900, 250, 50]);
const DAY7 = box([150, 240, 450, 900, 2400, 6000], [3000, 3000, 2000, 1200, 600, 200]);
const WITH_ITEM: ReelPrize[] = [...DAILY.slice(0, 5), { tier: 6, item: "frame_moon", bps: 50 }];
const FOUR = box([30, 60, 90, 150], [5000, 3000, 1500, 500]);

function drawTier(prizes: ReelPrize[], rnd: () => number) {
  let r = rnd() * 10000;
  for (const p of prizes) { r -= p.bps; if (r < 0) return p.tier; }
  return prizes.length;
}

describe("滾輪編排 v1：不變量", () => {
  const SEEDS = 60;
  for (const [name, prizes] of [["daily", DAILY], ["day7", DAY7], ["item", WITH_ITEM]] as const) {
    it(`${name}：停點、巡航、擦過、只往前`, () => {
      for (let tier = 1; tier <= 6; tier++) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const tr = buildTrack({ prizes, tier, seed });
          const { cells, T, off, params: p, grazes } = tr;
          expect(cells[T].tier).toBe(tier);
          expect(cells[T].prize).toBe(prizes[tier - 1]);
          expect(Math.abs(off)).toBeLessThanOrEqual(p.maxOff + 1e-9);

          const { out } = crossings(tr, null);
          const cruise = out.filter((e) => e.tMs >= p.accel && e.tMs <= p.accel + p.cruise);
          expect(cruise.filter((e) => e.tier === 6).length).toBeGreaterThanOrEqual(2);
          expect(cruise.filter((e) => e.tier === 5).length).toBeGreaterThanOrEqual(1);

          const offs = grazes.map((g) => (g.side === "R" ? g.dist : -g.dist));
          expect(new Set(offs).size).toBe(offs.length);
          for (const g of grazes) {
            expect(g.dist).toBeGreaterThanOrEqual(1);
            expect(g.dist).toBeLessThanOrEqual(3);
            expect(g.tier).toBeGreaterThan(tier);
            expect(g.tier).toBeGreaterThanOrEqual(4);
            if (g.tier >= 5 && g.dist === 3) expect(g.side).toBe("L");
            expect(cells[g.side === "R" ? T + g.dist : T - g.dist].tier).toBe(g.tier);
          }
          if (tier === 6) expect(grazes).toHaveLength(0);
          for (let i = T - 8; i < T + 8 && i < cells.length; i++) {
            if (i !== T && cells[i].tier >= 5) expect(offs).toContain(i - T);
          }
          for (const skipAt of [null, 400, 1500, 2600, 4200]) {
            const r = crossings(tr, skipAt);
            expect(r.out[r.out.length - 1].idx).toBe(T);
            if (skipAt != null && skipAt < tr.kin.total) expect(r.end - skipAt).toBe(p.skipDur);
          }
          expect(tr.nearMissBig).toBe(tier < 6 && (cells[T - 1].tier === 6 || cells[T + 1].tier === 6));
        }
      }
    });
  }

  it("同一個種子排出同一條軌道（舊紀錄可以重現）", () => {
    const a = buildTrack({ prizes: DAILY, tier: 3, seed: 0xdeadbeef });
    const b = buildTrack({ prizes: DAILY, tier: 3, seed: 0xdeadbeef });
    expect(a.cells.map((c) => c.tier)).toEqual(b.cells.map((c) => c.tier));
    expect(a.off).toBe(b.off);
  });

  it("造型道具格就是獎表裡那一格，不另外隨機產生", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const tr = buildTrack({ prizes: WITH_ITEM, tier: 2, seed });
      for (const c of tr.cells) expect(c.prize).toBe(WITH_ITEM[c.tier - 1]);
    }
  });

  it("少於 6 格的箱子：只用存在的級數，停點正確，不會懊惱", () => {
    for (let tier = 1; tier <= 4; tier++) {
      for (let seed = 1; seed <= 40; seed++) {
        const tr = buildTrack({ prizes: FOUR, tier, seed });
        expect(tr.cells[tr.T].tier).toBe(tier);
        for (const c of tr.cells) {
          expect(c.tier).toBeGreaterThanOrEqual(1);
          expect(c.tier).toBeLessThanOrEqual(4);
          expect(c.prize).toBe(FOUR[c.tier - 1]);
        }
        expect(tr.nearMissBig).toBe(false);
        const r = crossings(tr, 1500);
        expect(r.out[r.out.length - 1].idx).toBe(tr.T);
      }
    }
  });

  it("強制擦過與不擦過（舞台夾具）", () => {
    const near = buildTrack({ prizes: DAILY, tier: 2, seed: 9, graze: { dist: 1, tier: 6, side: "R" } });
    expect(near.cells[near.T + 1].tier).toBe(6);
    expect(near.nearMissBig).toBe(true);
    const none = buildTrack({ prizes: DAILY, tier: 2, seed: 9, graze: { none: true } });
    expect(none.grazes).toHaveLength(0);
  });
});

describe("滾輪編排 v1：擦過的比例（真實機率，每日寶箱）", () => {
  it("金色格落在停點兩格內 15–20%、第 6 級緊鄰 8–10%", () => {
    const rnd = mulberry32(7);
    const N = 20000;
    let gold2 = 0, six1 = 0;
    for (let i = 0; i < N; i++) {
      const tier = drawTier(DAILY, rnd);
      const tr = buildTrack({ prizes: DAILY, tier, seed: i + 1000 });
      const c = tr.cells, T = tr.T;
      if ([T - 2, T - 1, T + 1, T + 2].some((j) => c[j].tier >= 5)) gold2++;
      if (tr.nearMissBig) six1++;
    }
    expect(gold2 / N).toBeGreaterThanOrEqual(0.15);
    expect(gold2 / N).toBeLessThanOrEqual(0.2);
    expect(six1 / N).toBeGreaterThanOrEqual(0.08);
    expect(six1 / N).toBeLessThanOrEqual(0.1);
  });
});
