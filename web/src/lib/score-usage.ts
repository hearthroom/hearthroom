/**
 * 積分頁的統計：伺服器給每日收支（按使用者時區切好、最舊的在前、沒動靜的日子也有一格），
 * 這裡只做加總——最近幾天、本週、按週。週從星期一開始，跟日曆 App 的預設一致。
 */
import type { ScoreDay } from "./api";

export interface UsageBar { key: string; start: string; end: string; spent: number; earned: number; count: number }

/** 最後 n 天，一天一根。 */
export function lastDays(days: ScoreDay[], n: number): UsageBar[] {
  return days.slice(-n).map((d) => ({ key: d.date, start: d.date, end: d.date, spent: d.spent, earned: d.earned, count: d.count }));
}

/** YYYY-MM-DD 當成日曆日：是星期幾（一 = 0 … 日 = 6）。 */
function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/** 按日曆週加總（星期一開始）。資料開頭不滿一週的那段不算，免得第一根看起來特別矮；本週還沒過完照樣列出。 */
export function byWeek(days: ScoreDay[]): UsageBar[] {
  const out: UsageBar[] = [];
  const first = days.findIndex((d) => weekday(d.date) === 0);
  if (first < 0) return out;
  for (const d of days.slice(first)) {
    if (weekday(d.date) === 0 || !out.length) out.push({ key: d.date, start: d.date, end: d.date, spent: 0, earned: 0, count: 0 });
    const w = out[out.length - 1];
    w.end = d.date;
    w.spent += d.spent;
    w.earned += d.earned;
    w.count += d.count;
  }
  return out;
}

/** 今天、本週（從星期一到今天）、最近 30 天的消耗。 */
export function spentTotals(days: ScoreDay[]): { today: number; week: number; month: number } {
  const today = days[days.length - 1];
  if (!today) return { today: 0, week: 0, month: 0 };
  const sum = (list: ScoreDay[]) => list.reduce((s, d) => s + d.spent, 0);
  const weekStart = days.length - 1 - weekday(today.date);
  return { today: today.spent, week: sum(days.slice(Math.max(0, weekStart))), month: sum(days.slice(-30)) };
}

/** 軸上的上限：取一個好讀的整數（1、2、5 × 10ⁿ），圖不會頂到天花板。 */
export function niceMax(value: number): number {
  if (value <= 0) return 10;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 5, 10]) if (m * step >= value) return m * step;
  return 10 * step;
}
