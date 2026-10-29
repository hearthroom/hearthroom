import { resolveMember } from "./members";
import type { ProviderIdentity } from "./upstream";
import type { ProviderId } from "./providers";
/**
 * 每週登記額度。
 *
 * 榜單的品質靠「作者只把最好的那幾張放上來」，所以一個社群帳號一週最多登記 WEEKLY_LIMIT 張。
 * 週的定義是 UTC 的週一 00:00 到下週一 00:00：全站一個時鐘，不隨作者所在時區飄；
 * 畫面上把兩個時間點換成作者本地的日期就好。
 *
 * 用量數的是這週有幾個**不同的** role 登記過（見 0003 遷移的說明）：
 * 同一張卡撤了再登不多算一次，登記三張撤掉再登三張則算六張。
 */
export const WEEKLY_LIMIT = 3;

/**
 * 某一刻的每週上限：落在發卡獎勵活動（card_reward_campaigns）期間就用活動的設定，否則 WEEKLY_LIMIT。
 * 跟資料庫觸發器 community_weekly_limit（0070 遷移）同一條規則；開始那一刻算期間內，結束那一刻不算。
 */
export async function weeklyLimitAt(db: D1Database, at: number): Promise<number> {
  const row = await db.prepare("SELECT MAX(weekly_limit) AS n FROM card_reward_campaigns WHERE status = 'active' AND starts_at <= ?1 AND ends_at > ?1").bind(at).first<{ n: number | null }>();
  return row?.n ?? WEEKLY_LIMIT;
}
/** 一包最多發幾次；跟 0043 遷移的 CHECK 一致。 */
export const PACK_MAX = 100;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Share identity is independent of publication usage. Existing approved legacy
 * rows retain their allowance without manufacturing historical usage records. */
export async function needsFirstRegistration(db:D1Database,provider:ProviderId,source:string):Promise<boolean>{
 const row=await db.prepare(`SELECT EXISTS(SELECT 1 FROM card_registrations WHERE provider=?1 AND source_role_id=?2)
 OR EXISTS(SELECT 1 FROM review_submissions s WHERE s.provider=?1 AND (s.source_role_id=?2 OR s.id IN(SELECT submission_id FROM hosting_versions WHERE provider=?1 AND source_role_id=?2)))
 OR EXISTS(SELECT 1 FROM cards WHERE provider=?1 AND source_role_id=?2 AND (approved_version_id IS NOT NULL OR (status='approved' AND registered_at>0))) AS known`)
 .bind(provider,source).first<{known:number}>();
 return row?.known!==1;
}
export function firstRegistrationStatement(db:D1Database,input:{provider:ProviderId;account:number;source:string;now:number;packId?:string|null}):D1PreparedStatement{
 return db.prepare(`INSERT INTO card_registrations(provider,author_num_id,source_role_id,registered_at,pack_id)
 SELECT ?1,?2,?3,?4,?5 WHERE NOT EXISTS(SELECT 1 FROM card_registrations WHERE provider=?1 AND source_role_id=?3)
 AND NOT EXISTS(SELECT 1 FROM review_submissions s WHERE s.provider=?1 AND (s.source_role_id=?3 OR s.id IN(SELECT submission_id FROM hosting_versions WHERE provider=?1 AND source_role_id=?3)))
 AND NOT EXISTS(SELECT 1 FROM cards WHERE provider=?1 AND source_role_id=?3 AND (approved_version_id IS NOT NULL OR (status='approved' AND registered_at>0)))`)
 .bind(input.provider,input.account,input.source,input.now,input.packId??null);
}

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
  /** 補充包還剩幾次（見 0043 遷移）。不隨週重置；免費額度用完才扣。 */
  packRemaining: number;
}

/**
 * 每個包剩幾次 = 發的次數 − 引用它的登記列數。登記列 append-only，撤卡不還次數——
 * 跟免費額度「撤掉再登同一張不多算」是同一條規則：算的是這週登記過幾張不同的卡。
 */
const PACK_REMAINING = "p.granted - (SELECT COUNT(*) FROM card_registrations r WHERE r.pack_id=p.id)";

export async function packRemaining(db: D1Database, memberId: string): Promise<number> {
  const row = await db.prepare(`SELECT COALESCE(SUM(${PACK_REMAINING}),0) AS n FROM registration_packs p WHERE p.member_id=?`).bind(memberId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** 下一張要扣的包：最早發的、還有剩的那一個。沒有就回 null。 */
export async function openPack(db: D1Database, memberId: string): Promise<string | null> {
  const row = await db.prepare(`SELECT p.id FROM registration_packs p WHERE p.member_id=? AND ${PACK_REMAINING} > 0 ORDER BY p.created_at, p.id LIMIT 1`).bind(memberId).first<{ id: string }>();
  return row?.id ?? null;
}

/** 這週已經登記過的 role（去重）。 */
export async function registeredThisWeek(db: D1Database, authorNumId: number, now: number, provider: ProviderId = "harbor"): Promise<Set<string>> {
  const { start, end } = weekWindow(now);
  const memberId = await resolveMember(db, provider, authorNumId, now);
  const rows = await db.prepare("SELECT DISTINCT work_key FROM community_registration_usage WHERE member_id=? AND registered_at>=? AND registered_at<?")
    .bind(memberId,start,end).all<{work_key:string}>();
  return new Set(rows.results.map(r=>r.work_key));
}

export async function quotaFor(db: D1Database, me: ProviderIdentity, now: number, provider: ProviderId = "harbor"): Promise<Quota> {
  return quotaForMember(db, await resolveMember(db, provider, me.accountNumId, now, me), now);
}

/** 同 quotaFor，但從社群成員出發（管理端看某個作者的額度用這個）。 */
export async function quotaForMember(db: D1Database, memberId: string, now: number): Promise<Quota> {
  const { start, end } = weekWindow(now);
  const [thisWeek, packed, remaining, limit] = await Promise.all([
    db.prepare("SELECT DISTINCT work_key FROM community_registration_usage WHERE member_id=? AND registered_at>=? AND registered_at<?").bind(memberId, start, end).all<{ work_key: string }>().then((r) => r.results),
    // 這週靠補充包登的張數：從「不同的卡」裡扣掉，剩下的才是免費額度用了幾張
    db.prepare("SELECT COUNT(*) AS n FROM card_registrations r JOIN registration_packs p ON p.id=r.pack_id WHERE p.member_id=? AND r.registered_at>=? AND r.registered_at<?").bind(memberId, start, end).first<{ n: number }>(),
    packRemaining(db, memberId),
    weeklyLimitAt(db, now),
  ]);
  const used = Math.max(0, thisWeek.length - (packed?.n ?? 0));
  return { limit, used: Math.min(used, limit), weekStart: start, weekEnd: end, packRemaining: remaining };
}

export async function recordRegistration(db: D1Database, authorNumId: number, roleId: string, now: number, provider: ProviderId = "harbor"): Promise<void> {
  await db
    .prepare("INSERT INTO card_registrations (provider, author_num_id, source_role_id, registered_at) VALUES (?, ?, ?, ?)")
    .bind(provider, authorNumId, roleId, now)
    .run();
}
