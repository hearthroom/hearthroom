import { i18n } from "./i18n";

/**
 * 數字與時間一律交給 Intl，不要手寫。
 *
 * 手寫的版本只會對寫的人那個語言正確：中文把一萬寫成 10K 是錯的（該是 1万），
 * 日文的相對時間也不是「3 天前」的字面翻譯。這些規則每個語言都不一樣，
 * 而瀏覽器已經內建了全部。
 */

const locale = () => i18n.global.locale.value as string;

export function compact(n: number): string {
  return new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < HOUR) return i18n.global.t("time.justNow");

  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), "hour");
  if (diff < 30 * DAY) return rtf.format(-Math.floor(diff / DAY), "day");
  if (diff < 365 * DAY) return rtf.format(-Math.floor(diff / (30 * DAY)), "month");
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(ms);
}

/** 沒有封面時，用角色名產生一個穩定的色相，讓佔位卡彼此有區別。 */
export function hueFrom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/** 完整的整數（餘額這種要看準確值的地方），照語言加千分位。 */
export function whole(n: number): string {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(n);
}

/** 日期加時間，給流水用。 */
export function dateTime(input: string | number): string {
  const ms = typeof input === "number" ? (input > 1e12 ? input : input * 1000) : Date.parse(input);
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(ms);
}

/** 只有日期，給到期日用。 */
export function dateOnly(seconds: number): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(seconds * 1000);
}
