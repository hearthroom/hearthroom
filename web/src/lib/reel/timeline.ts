/**
 * 開箱一輪的時間軸：按下後的毫秒 t → 階段與滾輪位置。全部是 t 的函數，畫面每一幀照它畫，
 * 跳過只是換一條曲線，終點不變（art.md §4：只往前、不瞬移、停到同一個位置）。
 */
import { makeSkip, type Track } from "./v1";

export type Phase = "open" | "spin" | "hold" | "result";

export interface Round {
  track: Track;
  reduced: boolean;
  skip: { t0: number; pos: (sinceSkipMs: number) => number } | null;
}

export function newRound(track: Track, reduced: boolean): Round {
  return { track, reduced, skip: null };
}

const p = (r: Round) => r.track.params;
export const spinStart = (r: Round) => (r.reduced ? 0 : Math.max(0, p(r).open - p(r).overlap));

export function times(r: Round) {
  const s = spinStart(r);
  const spin = r.reduced ? 0 : r.skip ? r.skip.t0 + p(r).skipDur : r.track.kin.total;
  const spinEnd = s + spin;
  // 減少動態：不滾動，滾輪以停住的樣子淡入，0.4 秒後出結果（ui.md §6.4）
  const resultAt = spinEnd + (r.reduced ? 600 : p(r).hold);
  return { open: r.reduced ? 0 : p(r).open, spinStart: s, spinEnd, resultAt };
}

export function phaseAt(r: Round, t: number): Phase {
  const tm = times(r);
  if (r.reduced) return t < tm.resultAt ? "hold" : "result";
  if (t < tm.spinStart) return "open";
  if (t < tm.spinEnd) return "spin";
  if (t < tm.resultAt) return "hold";
  return "result";
}

/** 按下跳過：剩下的路在 skipDur 內減速停到同一格。開蓋中按也算（從起跑那一刻接手）。 */
export function skipAt(r: Round, t: number): boolean {
  if (r.skip || r.reduced) return false;
  const t0 = Math.max(0, t - spinStart(r));
  if (t0 >= r.track.kin.total) return false;
  const curve = makeSkip(r.track.kin, t0, p(r).skipDur, r.track.N);
  r.skip = { t0, pos: curve.pos };
  return true;
}

/** 指針下的位置（格）。 */
export function posAt(r: Round, t: number): number {
  const tr = r.track;
  if (r.reduced) return tr.finalPos;
  const spinT = t - spinStart(r);
  if (spinT <= 0) return tr.s0;
  const scale = (tr.finalPos - tr.s0) / tr.N;
  if (r.skip && spinT >= r.skip.t0) return tr.s0 + scale * r.skip.pos(spinT - r.skip.t0);
  return tr.s0 + scale * tr.kin.pos(spinT);
}

/** 停住後蘇綺的反應：第 5、6 級歡呼；第 6 級緊鄰停點懊惱；其餘開心。 */
export const reactionOf = (r: Round): "cheer" | "miss" | "ok" => (r.track.tier >= 5 ? "cheer" : r.track.nearMissBig ? "miss" : "ok");
/**
 * 停住那一聲只看開到的級別：第 5、6 級短號角、第 3、4 級三音和弦、第 1、2 級單音。
 * 差一點中頭獎也照級別播正常的獲獎音（owner 2026-10-19）：可惜只交給經過大獎時的閃光音與蘇綺的懊惱。
 */
export const stopSoundOf = (r: Round): "gold" | "rose" | "neutral" =>
  r.track.tier >= 5 ? "gold" : r.track.tier >= 3 ? "rose" : "neutral";
