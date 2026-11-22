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
 *
 * 自 quota_device_policy.effective_at（預設 2026-11-30 00:00 UTC）起，於發卡獎勵活動期間
 * （card_reward_campaigns，scope='campaign'）同一裝置（reward_devices）下的非白名單帳號共用一份
 * 每週免費額度；非活動期間維持每帳號各自計算；從未留過裝置紀錄且未帶裝置標頭者退回帳號計。
 */
export const WEEKLY_LIMIT = 3;
/** 預設同裝置合計生效時刻：2026-11-30 00:00:00 UTC（台北時間 11 月 30 日 08:00）。 */
export const DEFAULT_DEVICE_CAP_EFFECTIVE_AT = Date.UTC(2026, 10, 30, 0, 0, 0);

/**
 * 某一刻的每週上限：落在發卡獎勵活動（card_reward_campaigns）期間就用活動的設定，否則 WEEKLY_LIMIT。
 * 跟資料庫觸發器 community_weekly_limit（0070／0143 遷移）同一條規則；開始那一刻算期間內，結束那一刻不算。
 */
export async function weeklyLimitAt(db: D1Database, at: number): Promise<number> {
  const row = await db.prepare("SELECT MAX(weekly_limit) AS n FROM card_reward_campaigns WHERE status = 'active' AND starts_at <= ?1 AND ends_at > ?1").bind(at).first<{ n: number | null }>();
  return row?.n ?? WEEKLY_LIMIT;
}

export interface DeviceCapPolicy {
  effectiveAt: number | null;
  scope: "campaign" | "all";
}

export async function deviceCapPolicy(db: D1Database): Promise<DeviceCapPolicy> {
  const row = await db.prepare("SELECT effective_at, scope FROM quota_device_policy WHERE id = 1").first<{ effective_at: number | null; scope: "campaign" | "all" }>();
  return { effectiveAt: row?.effective_at ?? null, scope: row?.scope === "all" ? "all" : "campaign" };
}

/** 一包最多發幾次；跟 0043 遷移的 CHECK 一致。 */
export const PACK_MAX = 100;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Share identity is independent of publication usage. Existing approved legacy
 * rows retain their allowance without manufacturing historical usage records. */
export async function needsFirstRegistration(db: D1Database, provider: ProviderId, source: string): Promise<boolean> {
  const row = await db.prepare(`SELECT EXISTS(SELECT 1 FROM card_registrations WHERE provider=?1 AND source_role_id=?2)
 OR EXISTS(SELECT 1 FROM review_submissions s WHERE s.provider=?1 AND (s.source_role_id=?2 OR s.id IN(SELECT submission_id FROM hosting_versions WHERE provider=?1 AND source_role_id=?2)))
 OR EXISTS(SELECT 1 FROM cards WHERE provider=?1 AND source_role_id=?2 AND (approved_version_id IS NOT NULL OR (status='approved' AND registered_at>0))) AS known`)
    .bind(provider, source).first<{ known: number }>();
  return row?.known !== 1;
}

export function firstRegistrationStatement(
  db: D1Database,
  input: { provider: ProviderId; account: number; source: string; now: number; packId?: string | null; deviceHash?: string | null },
): D1PreparedStatement {
  return db.prepare(`INSERT INTO card_registrations(provider,author_num_id,source_role_id,registered_at,pack_id,device_hash)
 SELECT ?1,?2,?3,?4,?5,?6 WHERE NOT EXISTS(SELECT 1 FROM card_registrations WHERE provider=?1 AND source_role_id=?3)
 AND NOT EXISTS(SELECT 1 FROM review_submissions s WHERE s.provider=?1 AND (s.source_role_id=?3 OR s.id IN(SELECT submission_id FROM hosting_versions WHERE provider=?1 AND source_role_id=?3)))
 AND NOT EXISTS(SELECT 1 FROM cards WHERE provider=?1 AND source_role_id=?3 AND (approved_version_id IS NOT NULL OR (status='approved' AND registered_at>0)))`)
    .bind(input.provider, input.account, input.source, input.now, input.packId ?? null, input.deviceHash ?? null);
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
  /** 同裝置其他帳號本週也佔用了共用免費額度（僅為 true 時出現，不洩漏其他帳號資訊）。 */
  deviceShared?: boolean;
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

export interface WeeklyUsage {
  /** 本帳號本週全部已登記作品（含補充包），用於「同一張卡撤回重登不重複計」。 */
  allOwnWorks: Set<string>;
  /** 本帳號本週免費額度已登記作品（pack_id IS NULL）。 */
  ownFreeWorks: Set<string>;
  /** 生效規則下的免費額度已登記作品（含同裝置其他非白名單帳號）。 */
  effectiveFreeWorks: Set<string>;
  /** 同裝置其他非白名單帳號是否額外貢獻了免費額度用量。 */
  deviceShared: boolean;
  /** 此刻規則上同裝置合計是否啟用（已過 effective_at 且落在 scope 內）。 */
  deviceCapActive: boolean;
  /** 本帳號是否在有效共用電腦白名單內。 */
  exempt: boolean;
  /** 本帳號本次有裝置代碼或曾有 reward_devices 關聯。 */
  hasDeviceSignal: boolean;
}

/**
 * 計算成員本週的登記用量；邏輯與 D1 觸發器 community_weekly_limit（0143 遷移）保持兩層完全一致。
 */
export async function weeklyUsageForMember(
  db: D1Database,
  memberId: string,
  now: number,
  deviceHash?: string | null,
): Promise<WeeklyUsage> {
  const { start, end } = weekWindow(now);
  const hash = deviceHash ?? null;
  const [policyState, exemptRow, knownDeviceRow, ownRows] = await Promise.all([
    db.prepare(
      `SELECT EXISTS(
         SELECT 1 FROM quota_device_policy p
         WHERE p.id = 1 AND p.effective_at IS NOT NULL AND ?1 >= p.effective_at
           AND (p.scope = 'all' OR EXISTS(
             SELECT 1 FROM card_reward_campaigns k
             WHERE k.status = 'active' AND k.starts_at <= ?1 AND k.ends_at > ?1))
       ) AS active`,
    ).bind(now).first<{ active: number }>(),
    db.prepare("SELECT 1 FROM quota_device_exemptions WHERE member_id = ? AND revoked_at IS NULL").bind(memberId).first(),
    hash
      ? Promise.resolve({ has: 1 })
      : db.prepare("SELECT EXISTS(SELECT 1 FROM reward_devices WHERE member_id = ?) AS has").bind(memberId).first<{ has: number }>(),
    db.prepare("SELECT DISTINCT work_key, pack_id IS NULL AS is_free FROM community_registration_usage WHERE member_id = ? AND registered_at >= ? AND registered_at < ?")
      .bind(memberId, start, end).all<{ work_key: string; is_free: number }>(),
  ]);

  const deviceCapActive = policyState?.active === 1;
  const exempt = !!exemptRow;
  const hasDeviceSignal = !!hash || knownDeviceRow?.has === 1;
  const allOwnWorks = new Set<string>();
  const ownFreeWorks = new Set<string>();
  for (const r of ownRows.results) {
    allOwnWorks.add(r.work_key);
    if (r.is_free === 1) ownFreeWorks.add(r.work_key);
  }

  if (!deviceCapActive || exempt || !hasDeviceSignal) {
    return {
      allOwnWorks,
      ownFreeWorks,
      effectiveFreeWorks: new Set(ownFreeWorks),
      deviceShared: false,
      deviceCapActive,
      exempt,
      hasDeviceSignal,
    };
  }

  const sharedRows = await db.prepare(
    `SELECT DISTINCT u.work_key
     FROM community_registration_usage u
     WHERE u.pack_id IS NULL
       AND u.registered_at >= ?1 AND u.registered_at < ?2
       AND (
         u.member_id = ?3
         OR (
           NOT EXISTS (SELECT 1 FROM quota_device_exemptions ex2 WHERE ex2.member_id = u.member_id AND ex2.revoked_at IS NULL)
           AND (
             (?4 IS NOT NULL AND (
               u.device_hash = ?4
               OR EXISTS (SELECT 1 FROM reward_devices rd WHERE rd.device_hash = ?4 AND rd.member_id = u.member_id)
             ))
             OR (u.device_hash IS NOT NULL AND EXISTS (
               SELECT 1 FROM reward_devices myd WHERE myd.member_id = ?3 AND myd.device_hash = u.device_hash
             ))
             OR EXISTS (
               SELECT 1 FROM reward_devices myd
               JOIN reward_devices otd ON otd.device_hash = myd.device_hash
               WHERE myd.member_id = ?3 AND otd.member_id = u.member_id
             )
           )
         )
       )`,
  ).bind(start, end, memberId, hash).all<{ work_key: string }>();

  const effectiveFreeWorks = new Set(sharedRows.results.map((r) => r.work_key));
  return {
    allOwnWorks,
    ownFreeWorks,
    effectiveFreeWorks,
    deviceShared: effectiveFreeWorks.size > ownFreeWorks.size,
    deviceCapActive,
    exempt,
    hasDeviceSignal,
  };
}

/** 這週已經登記過的 role（去重）。 */
export async function registeredThisWeek(db: D1Database, authorNumId: number, now: number, provider: ProviderId = "harbor"): Promise<Set<string>> {
  const { start, end } = weekWindow(now);
  const memberId = await resolveMember(db, provider, authorNumId, now);
  const rows = await db.prepare("SELECT DISTINCT work_key FROM community_registration_usage WHERE member_id=? AND registered_at>=? AND registered_at<?")
    .bind(memberId, start, end).all<{ work_key: string }>();
  return new Set(rows.results.map((r) => r.work_key));
}

export async function quotaFor(db: D1Database, me: ProviderIdentity, now: number, provider: ProviderId = "harbor", deviceHash?: string | null): Promise<Quota> {
  return quotaForMember(db, await resolveMember(db, provider, me.accountNumId, now, me), now, deviceHash);
}

/** 同 quotaFor，但從社群成員出發（管理端看某個作者的額度用這個）。 */
export async function quotaForMember(db: D1Database, memberId: string, now: number, deviceHash?: string | null): Promise<Quota> {
  const { start, end } = weekWindow(now);
  const [usage, remaining, limit] = await Promise.all([
    weeklyUsageForMember(db, memberId, now, deviceHash),
    packRemaining(db, memberId),
    weeklyLimitAt(db, now),
  ]);
  const used = Math.min(usage.effectiveFreeWorks.size, limit);
  return {
    limit,
    used,
    weekStart: start,
    weekEnd: end,
    packRemaining: remaining,
    ...(usage.deviceShared ? { deviceShared: true } : {}),
  };
}

export async function recordRegistration(db: D1Database, authorNumId: number, roleId: string, now: number, provider: ProviderId = "harbor", deviceHash?: string | null): Promise<void> {
  await db
    .prepare("INSERT INTO card_registrations (provider, author_num_id, source_role_id, registered_at, device_hash) VALUES (?, ?, ?, ?, ?)")
    .bind(provider, authorNumId, roleId, now, deviceHash ?? null)
    .run();
}
