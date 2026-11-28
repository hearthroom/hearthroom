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

/**
 * 主頁數據與作者列表的人數：未滿一萬寫全數（3,420）；一萬以上縮寫，一律一位小數、截位不進位
 * （19,999 寫 1.9萬，四捨五入會寫成 2萬、比實際多；999,999 寫 99.9萬，不會跳成 100.0萬）。
 * own：本人看自己的主頁，99,999 以內也寫全數。確切值另由點按（ProfileStats）或名單標題給。
 */
export function statCount(n: number, opts: { own?: boolean } = {}): string {
  const full = Math.abs(n) < (opts.own ? 100_000 : 10_000);
  if (full) return new Intl.NumberFormat(locale()).format(n);
  // roundingMode 是 ES2023；不支援的瀏覽器會忽略它改回四捨五入（19,999 寫成 2.0萬、999,999 跳成 100.0萬），顯示偏大但不會壞
  return new Intl.NumberFormat(locale(), { notation: "compact", minimumFractionDigits: 1, maximumFractionDigits: 1, roundingMode: "trunc" } as Intl.NumberFormatOptions).format(n);
}

/** statCount 有沒有縮寫：縮寫了才需要讓人點開看確切值 */
export const statAbbreviated = (n: number, opts: { own?: boolean } = {}): boolean => Math.abs(n) >= (opts.own ? 100_000 : 10_000);

/**
 * 卡片磚上的縮寫：跟 compact 一樣，但整數部分到三位數以上就不帶小數（1235萬、124万；1.2M 不變）。
 * 磚很窄，大數字多一位小數只會把作者名擠掉，卻不多帶資訊。
 */
export function compactTile(n: number): string {
  const nf = new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 });
  const whole = nf.formatToParts(n).find((p) => p.type === "integer")?.value ?? "";
  return whole.length >= 3 ? new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 0 }).format(n) : nf.format(n);
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

/**
 * relativeTime 的短寫法，給最窄的封面（約 135 寬）用：一年以上只寫年份（2025年、2025），
 * 一年內用 Intl 的 narrow 寫法（英文「11mo ago」）。完整說法仍由 relativeTime 給提示與讀屏。
 */
export function relativeTimeShort(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < HOUR) return i18n.global.t("time.justNow");
  if (diff >= 365 * DAY) return new Intl.DateTimeFormat(locale(), { year: "numeric" }).format(ms);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto", style: "narrow" });
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), "hour");
  if (diff < 30 * DAY) return rtf.format(-Math.floor(diff / DAY), "day");
  return rtf.format(-Math.floor(diff / (30 * DAY)), "month");
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

/**
 * 開場白這類文案原本是給對話用的：帶標記語法與 {{char}} / {{user}} 佔位符。
 * 主頁只展示，所以剝掉標記、把佔位符換成名字。
 */
export function plainText(raw: string, charName: string, userName: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/\{\{\s*char\s*\}\}/gi, charName)
    .replace(/\{\{\s*user\s*\}\}/gi, userName)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 流水按日分組用的標籤：今天、昨天，再之前就是日期。 */
export function dayLabel(input: string | number): string {
  const ms = typeof input === "number" ? (input > 1e12 ? input : input * 1000) : Date.parse(input);
  const d = new Date(ms); const now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / DAY);
  if (days === 0) return i18n.global.t("time.today");
  if (days === 1) return i18n.global.t("time.yesterday");
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(ms);
}

/** 只有時分，給已經按日分組的流水用。 */
export function clock(input: string): string {
  return new Intl.DateTimeFormat(locale(), { timeStyle: "short" }).format(Date.parse(input));
}

/** 日曆日（YYYY-MM-DD，已經是使用者那一天）的短標籤：9/27、9月27日，給圖表軸用。 */
export function monthDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale(), { month: "numeric", day: "numeric" }).format(new Date(y, m - 1, d));
}

/** 本地時區的日曆日（YYYY-MM-DD），用來跟伺服器按同一個時區切好的日子對上。 */
export function localDate(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(typeof input === "number" ? (input > 1e12 ? input : input * 1000) : Date.parse(input));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 月日加時分（10/22 04:00）：期限一律寫日期加時間，簽到與錢包的到期都用這個。 */
export function monthDayTime(input: string | number): string {
  const ms = typeof input === "number" ? (input > 1e12 ? input : input * 1000) : Date.parse(input);
  return new Intl.DateTimeFormat(locale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

/** 只有月日，給「哪天會收到」這種不需要時刻的日期。 */
export function monthDayOf(input: string | number): string {
  const ms = typeof input === "number" ? (input > 1e12 ? input : input * 1000) : Date.parse(input);
  return new Intl.DateTimeFormat(locale(), { month: "numeric", day: "numeric" }).format(ms);
}

/** 只有時分、一律 24 小時制（04:00，不是「凌晨4:00」）：到期條、錢包與結果卡寫法一致（ui.md §6.13）。 */
export function hourMinute(input: string | number): string {
  const ms = typeof input === "number" ? (input > 1e12 ? input : input * 1000) : Date.parse(input);
  return new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

/** 台北時間的整點時段（14:00–15:00）：每小時彙總的返點列固定按台北時間切整點。 */
export function taipeiHourSlot(input: string | number): string {
  const ms = typeof input === "number" ? (input > 1e12 ? input : input * 1000) : Date.parse(input);
  const start = Math.floor(ms / HOUR) * HOUR;
  const fmt = new Intl.DateTimeFormat(locale(), { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${fmt.format(start)}–${fmt.format(start + HOUR)}`;
}

/** 數字與後面的單位黏在一起不斷行（「5 回合」「3 days」）：把中間的空白換成不換行空白。 */
export const glueUnits = (text: string): string => text.replace(/(\d) (?=\S)/g, "$1\u00a0");
