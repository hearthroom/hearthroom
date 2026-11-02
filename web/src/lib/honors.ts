/**
 * 榜單榮譽：一張卡在某條榜（清水／綜合）、某個期別（日／週／月）結算出的名次段（1／3／10）。
 * 徽章 key 是 `rank_{zone}_{window}_{band}`（後端定義，綜合榜的 zone 是 `all`）。
 * 封面、卡片頁、作者名字旁、徽章頁畫的是同一枚徽章，所以名稱與順序都在這裡算，不在元件各自算。
 */
export const HONOR_ZONES = ['clean', 'all'] as const;
export const HONOR_WINDOWS = ['day', 'week', 'month'] as const;
export const HONOR_BANDS = [1, 3, 10] as const;
export type HonorZone = typeof HONOR_ZONES[number];
export type HonorWindow = typeof HONOR_WINDOWS[number];
export type HonorBand = typeof HONOR_BANDS[number];
export interface Honor { zone: HonorZone; window: HonorWindow; band: HonorBand }
/** 卡片頁「全部榮譽」的一筆：period＝這份榮譽所屬那一組的起始日（台北日曆 YYYY-MM-DD，週從週一、月從 1 日），at＝實際頒發時刻。 */
export interface CardHonor extends Honor { period: string; at: number; rank?: number }

const KEY = /^rank_(clean|all)_(day|week|month)_(1|3|10)$/;
export function parseHonorKey(key: string): Honor | null {
  const m = KEY.exec(key);
  return m ? { zone: m[1] as HonorZone, window: m[2] as HonorWindow, band: Number(m[3]) as HonorBand } : null;
}
export const honorKey = (h: Honor) => `rank_${h.zone}_${h.window}_${h.band}`;

const order = (h: Honor) => HONOR_ZONES.indexOf(h.zone) * 100 + HONOR_WINDOWS.indexOf(h.window) * 10 + HONOR_BANDS.indexOf(h.band);
/** 徽章頁的順序：清水在前、綜合在後；日、週、月；第一、前三、前十。 */
export const sortHonors = <T extends Honor>(list: readonly T[]) => [...list].sort((a, b) => order(a) - order(b));

/**
 * 封面上的那一列：每個期別只放最高名次那一枚，順序固定日→週→月，最多三枚。
 * 同名次時清水優先（不加權，只是兩枚長得一樣時固定挑一枚，免得同一張卡換頁就換徽章）。
 */
export function coverHonors(list: readonly Honor[]): Honor[] {
  const best = new Map<HonorWindow, Honor>();
  for (const h of list) {
    const now = best.get(h.window);
    if (!now || h.band < now.band || (h.band === now.band && h.zone === 'clean' && now.zone !== 'clean')) best.set(h.window, h);
  }
  return HONOR_WINDOWS.flatMap(w => { const h = best.get(w); return h ? [{ zone: h.zone, window: h.window, band: h.band }] : []; });
}

/** 標籤上的次數：拿過兩次以上才寫，三位數一律 99+（標籤寬度是照兩位數排的）。 */
export const timesLabel = (count: number | undefined) => !count || count < 2 ? '' : count >= 100 ? '×99+' : `×${count}`;

/**
 * 名字旁的展示列只排一行：從最後一枚往回藏，直到「顯示的標籤＋「+N」」放得下；至少留一枚。
 * `plus(n)` 是藏了 n 枚時「+N」標籤的寬度（位數不同寬度不同）。回傳要顯示幾枚。
 */
export function fitWorn(widths: readonly number[], available: number, gap: number, plus: (hidden: number) => number): number {
  const total = (k: number) => widths.slice(0, k).reduce((sum, w) => sum + w, 0) + Math.max(0, k - 1) * gap;
  if (total(widths.length) <= available) return widths.length;
  for (let k = widths.length - 1; k >= 1; k--) if (total(k) + gap + plus(widths.length - k) <= available) return k;
  return widths.length ? 1 : 0;
}

/** 榜單徽章的固定色（美工 rank-badges.mjs 定稿；不隨主題，避開 R 標與精選的紅）。 */
export const HONOR_COLORS: Record<HonorWindow, string> = { day: '#c25400', week: '#2f6fca', month: '#7a4bc4' };

type Translate = (key: string, values?: Record<string, unknown>) => string;
/** 完整名稱（清水日榜第一、SFW Daily #1…）：各語系的字序由語系檔的 honor.name 決定。 */
export const honorName = (t: Translate, h: Honor) =>
  t('honor.name', { zone: t(`honor.zone.${h.zone}`), window: t(`honor.window.${h.window}`), band: t(`honor.band.${h.band}`) });

/**
 * 榮譽所屬那一組的期間（文案：日 11/3、週 11/2–11/8、月 2026 年 11 月）。period 是台北日曆的日期字串，
 * 只拿來顯示，所以用 UTC 解析與格式化，不受看的人所在時區影響。
 */
export function periodLabel(window: HonorWindow, period: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (!m) return period;
  const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (window === 'month') return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(start);
  const day = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', day: 'numeric' });
  if (window === 'day') return day.format(start);
  return day.formatRange(start, new Date(start.getTime() + 6 * 86400000));
}
