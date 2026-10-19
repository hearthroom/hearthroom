// 開箱時間軸：階段順序、跳過停到同一格、減少動態不滾動但結果一樣（ui.md §6.3、§6.4；art.md §4）。
import { describe, expect, it } from "vitest";
import { buildTrack, type ReelPrize } from "../src/lib/reel/v1";
import { newRound, phaseAt, posAt, reactionOf, skipAt, stopSoundOf, times } from "../src/lib/reel/timeline";

const prizes: ReelPrize[] = [60, 90, 150, 300, 900, 3000].map((c, i) => ({ tier: i + 1, credits: c, bps: 1 }));

describe("開箱時間軸", () => {
  it("開蓋 → 滾動 → 停住 → 結果，按下到停住約 4.5 秒", () => {
    const r = newRound(buildTrack({ prizes, tier: 3, seed: 11 }), false);
    const tm = times(r);
    expect(phaseAt(r, 0)).toBe("open");
    expect(phaseAt(r, tm.spinStart + 10)).toBe("spin");
    expect(phaseAt(r, tm.spinEnd + 10)).toBe("hold");
    expect(phaseAt(r, tm.resultAt)).toBe("result");
    expect(tm.spinEnd).toBeGreaterThan(4200);
    expect(tm.spinEnd).toBeLessThan(4900);
  });

  it("位置只往前，最後停在停點格內", () => {
    const r = newRound(buildTrack({ prizes, tier: 2, seed: 5 }), false);
    let last = -Infinity;
    for (let t = 0; t <= times(r).resultAt; t += 8) { const x = posAt(r, t); expect(x).toBeGreaterThanOrEqual(last - 1e-9); last = x; }
    expect(Math.round(last)).toBe(r.track.T);
    expect(last).toBeCloseTo(r.track.finalPos, 6);
  });

  it("跳過：0.6 秒內停到同一個位置，不倒退；只能跳一次", () => {
    const r = newRound(buildTrack({ prizes, tier: 4, seed: 21 }), false);
    const at = 1500;
    const before = posAt(r, at);
    expect(skipAt(r, at)).toBe(true);
    expect(skipAt(r, at + 100)).toBe(false);
    expect(posAt(r, at)).toBeCloseTo(before, 6);
    const tm = times(r);
    expect(tm.spinEnd - at).toBeCloseTo(r.track.params.skipDur, 0);
    let last = before;
    for (let t = at; t <= tm.spinEnd; t += 4) { const x = posAt(r, t); expect(x).toBeGreaterThanOrEqual(last - 1e-9); last = x; }
    expect(posAt(r, tm.spinEnd)).toBeCloseTo(r.track.finalPos, 6);
  });

  it("減少動態：不滾動，停住的樣子直接出現，結果與有動畫時同一格", () => {
    const tr = buildTrack({ prizes, tier: 5, seed: 3 });
    const r = newRound(tr, true);
    expect(phaseAt(r, 0)).toBe("hold");
    expect(posAt(r, 0)).toBe(tr.finalPos);
    expect(phaseAt(r, times(r).resultAt)).toBe("result");
    expect(skipAt(r, 10)).toBe(false);
  });

  it("反應與停住的聲音跟著結果走", () => {
    expect(reactionOf(newRound(buildTrack({ prizes, tier: 6, seed: 1 }), false))).toBe("cheer");
    const near = newRound(buildTrack({ prizes, tier: 2, seed: 1, graze: { dist: 1, tier: 6, side: "L" } }), false);
    expect(reactionOf(near)).toBe("miss");
    // owner 2026-10-19：差一點也照開到的級別播正常的獲獎音，可惜只交給閃光音與蘇綺的懊惱
    expect(stopSoundOf(near)).toBe("neutral");
    const nearRose = newRound(buildTrack({ prizes, tier: 4, seed: 1, graze: { dist: 1, tier: 6, side: "R" } }), false);
    expect(nearRose.track.nearMissBig).toBe(true);
    expect(stopSoundOf(nearRose)).toBe("rose");
    expect(stopSoundOf(newRound(buildTrack({ prizes, tier: 5, seed: 1 }), false))).toBe("gold");
    expect(reactionOf(newRound(buildTrack({ prizes, tier: 2, seed: 1, graze: { none: true } }), false))).toBe("ok");
    expect(stopSoundOf(newRound(buildTrack({ prizes, tier: 3, seed: 1, graze: { none: true } }), false))).toBe("rose");
  });
});
