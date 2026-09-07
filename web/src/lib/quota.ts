/**
 * 每週登記額度的顯示用計算。
 *
 * 服務端給的是 UTC 週一到下週一的兩個時間點；這裡只負責把它們變成作者看得懂的字：
 * 起訖日期用他的語言格式、還剩幾天用整天數往上取（剩 1 小時也是「明天重置」）。
 */
import type { ListingQuota } from "@/lib/api";

const DAY = 24 * 60 * 60 * 1000;

/** 這週的起訖日。end 是「下週一 00:00」這個不含的時間點，顯示時退一天成週日。 */
export function weekRange(q: Pick<ListingQuota, "weekStart" | "weekEnd">, locale: string): { start: string; end: string } {
  const fmt = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", timeZone: "UTC" });
  return { start: fmt.format(new Date(q.weekStart)), end: fmt.format(new Date(q.weekEnd - DAY)) };
}

/** 距離重置還有幾天（往上取整，最少 1）。 */
export function daysUntilReset(q: Pick<ListingQuota, "weekEnd">, now = Date.now()): number {
  return Math.max(1, Math.ceil((q.weekEnd - now) / DAY));
}

export function remaining(q: Pick<ListingQuota, "limit" | "used">): number {
  return Math.max(0, q.limit - q.used);
}
