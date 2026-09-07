/**
 * 每週登記額度。
 *
 * 榜單的品質靠「作者只把最好的那幾張放上來」，所以一個作者一週最多登記 WEEKLY_LIMIT 張。
 * 週的定義是 UTC 的週一 00:00 到下週一 00:00：全站一個時鐘，不隨作者所在時區飄；
 * 畫面上把兩個時間點換成作者本地的日期就好。
 *
 * 用量數的是這週有幾個**不同的** role 登記過（見 0003 遷移的說明）：
 * 同一張卡撤了再登不多算一次，登記三張撤掉再登三張則算六張。
 */
export const WEEKLY_LIMIT = 3;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface WeekWindow {
  /** 這週的起點（UTC 週一 00:00），毫秒 */
  start: number;
  /** 下週的起點，毫秒；額度在這一刻重置 */
  end: number;
}

export function weekWindow(now: number): WeekWindow {
  const d = new Date(now);
  // getUTCDay：週日是 0。往回退到週一。
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday);
  return { start, end: start + WEEK_MS };
}

export interface Quota {
  limit: number;
  used: number;
  weekStart: number;
  weekEnd: number;
}

/** 這週已經登記過的 role（去重）。 */
export async function registeredThisWeek(db: D1Database, authorNumId: number, now: number): Promise<Set<string>> {
  const { start, end } = weekWindow(now);
  const rows = await db
    .prepare(
      "SELECT DISTINCT source_role_id FROM card_registrations WHERE author_num_id = ? AND registered_at >= ? AND registered_at < ?",
    )
    .bind(authorNumId, start, end)
    .all<{ source_role_id: string }>();
  return new Set(rows.results.map((r) => r.source_role_id));
}

export async function quotaFor(db: D1Database, authorNumId: number, now: number): Promise<Quota> {
  const { start, end } = weekWindow(now);
  const used = (await registeredThisWeek(db, authorNumId, now)).size;
  return { limit: WEEKLY_LIMIT, used: Math.min(used, WEEKLY_LIMIT), weekStart: start, weekEnd: end };
}

export async function recordRegistration(db: D1Database, authorNumId: number, roleId: string, now: number): Promise<void> {
  await db
    .prepare("INSERT INTO card_registrations (author_num_id, source_role_id, registered_at) VALUES (?, ?, ?)")
    .bind(authorNumId, roleId, now)
    .run();
}
