/**
 * 年度榜單積分（年冠）。每年一屆：當年首次發布（台北時間）的作品拿到的每一枚榜單榮譽換成積分，作者全年累加。
 * 清水、綜合分開計分。規則見 HarperHarbor/docs product/Hearthroom_Achievements_ProductDesign_20261120_V1.0.md §7.1。
 */
import type { RankBand, RankWindow, RankZone } from './rank-honors';

export const ANNUAL_POINTS: Record<RankWindow, Record<RankBand, number>> = {
  day: { 1: 3, 3: 2, 10: 1 },
  week: { 1: 10, 3: 6, 10: 3 },
  month: { 1: 25, 3: 15, 10: 8 },
};
/** 第一屆是 2026（開元年冠）；更早沒有榜單。 */
export const ANNUAL_FIRST_YEAR = 2026;
/** 年冠的積分獎勵；發放走榜單獎池，池子的單筆上限要不小於這個數。 */
export const ANNUAL_CROWN_REWARD = 200_000;
/** 年度十傑：第 2–10 名。 */
export const ANNUAL_TOP = 10;

export interface AnnualStanding {
  rank: number;
  points: number;
  firsts: number;
  top3: number;
  author: { handle: string | null; name: string; avatar: string };
}
export interface AnnualBoard {
  year: number;
  zone: RankZone;
  /** 已結算：名次定案，不再變動 */
  settled: boolean;
  /** 預計結算時刻（毫秒）；最後一期月榜滿 30 天之後 */
  settlesAt: number;
  items: AnnualStanding[];
}

const TAIPEI = '+08:00';
export function annualYearRange(year: number): { start: number; end: number } {
  return { start: Date.parse(`${year}-01-01T00:00:00${TAIPEI}`), end: Date.parse(`${year + 1}-01-01T00:00:00${TAIPEI}`) };
}
/** 12 月月榜最晚約隔年 1 月 31 日結算，所以年冠在 2 月 1 日（台北）起才結算。 */
export function annualSettlesAt(year: number): number {
  return Date.parse(`${year + 1}-02-01T00:00:00${TAIPEI}`);
}
/** 這個時刻所屬的年度（台北時間）。 */
export function annualYearOf(at: number): number {
  return new Date(at + 8 * 3600000).getUTCFullYear();
}
export const annualBadgeKey = (zone: RankZone, year: number, band: 1 | 10) => `annual_${zone}_${year}_${band}`;
