import { HttpError } from './types';

/**
 * 作者側寫（owner 2026-11-23 追加，口徑 da.md「作者側寫」）：只給審核員看，作者與其他玩家看不到，
 * 公開 API 與 MCP 都沒有入口。標記只提示審核路徑，不自動通過、駁回或不受理，也不改任何硬性驗證。
 *
 *   - 新人：已知生命期送審的前 3 件不同作品（含本次）。有本站登記早於託管流程的舊卡時，歷史不齊，算「資料不足」。
 *   - 穩定：近 180 天至少 5 件作品有首次定案，其中至少 80% 首次通過。
 *   - 頭部：近 180 天至少 20 件作品有首次定案，首次通過比例的 95% Wilson 下限 × 100 ≥ 75。頭部優先於穩定。
 *   - 疑似批量（獨立旗標）：同一個已知安裝，過去 24 小時至少 3 位不同的非白名單帳號、至少 6 件不同作品登記。
 *
 * 首次定案以作品最早一張定案單的現行狀態計（V2 之前的改判會讓舊單顯示改判後的狀態，da.md「目前狀態回溯」）。
 * 門檻是提案，之後用覆寫率與分層抽樣校準；改門檻就加 RULE_VERSION，覆寫率按規則版本分開算。
 */
export const PROFILE_RULE_VERSION = 1;
const DAY = 86_400_000;
const WINDOW = 180 * DAY;
export const MARK_TTL_MS = { tier: 90 * DAY, batch: 30 * DAY } as const;

export type AuthorTier = 'new' | 'stable' | 'top' | 'general' | 'unknown';
export interface AuthorProfile {
  /** 顯示用的標記（人工覆寫優先） */
  tier: AuthorTier;
  autoTier: AuthorTier;
  batchSuspected: boolean;
  autoBatch: boolean;
  /** 人工覆寫：哪一類、到期時間 */
  manual: { tier?: { expiresAt: number }; batch?: { expiresAt: number } };
  /** 依據；null＝量不到（不是 0） */
  basis: {
    works: number | null; decidedWorks: number | null; firstPassRate: number | null; qualityScore: number | null;
    memberSince: number | null; deviceAccounts: number | null; deviceRecentWorks: number | null; dropCases90d: number | null;
    /** 最近 90 天審核員對這位作者的卡標過的審核標記次數（疑似 AI 原文、疑似搬運） */
    marks90d: Record<string, number>;
  };
}

/** 95% Wilson 信賴區間下限 */
export function wilsonLower(ok: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96, p = ok / n;
  return (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n);
}

export function autoTier(s: { works: number | null; decided: number; firstPass: number; legacy: boolean }): AuthorTier {
  if (s.works === null) return 'unknown';
  if (s.decided >= 20 && wilsonLower(s.firstPass, s.decided) * 100 >= 75) return 'top';
  if (s.decided >= 5 && s.firstPass / s.decided >= 0.8) return 'stable';
  if (s.works <= 3) return s.legacy ? 'unknown' : 'new';
  return 'general';
}

/** 名單一律綁成一個 JSON 陣列：D1 一個查詢最多 100 個綁定參數，佇列上的作者與裝置會超過 */
const LIST = 'SELECT value FROM json_each(?)';

/** 一次算一批作者（佇列上最多 200 張卡，作者去重後一次查完） */
export async function authorProfiles(db: D1Database, memberIds: string[], now: number): Promise<Map<string, AuthorProfile>> {
  const ids = [...new Set(memberIds.filter(Boolean))];
  const out = new Map<string, AuthorProfile>();
  if (!ids.length) return out;
  const list = JSON.stringify(ids);
  const [works, firsts, legacy, members, drops, marks, decisionMarks] = await db.batch([
    db.prepare(`SELECT member_id, COUNT(DISTINCT work_id) AS n FROM hosting_versions WHERE submission_id IS NOT NULL AND member_id IN (${LIST}) GROUP BY member_id`).bind(list),
    db.prepare(`WITH firsts AS (
        SELECT v.member_id, s.status, s.decided_at, ROW_NUMBER() OVER (PARTITION BY v.work_id ORDER BY s.submitted_at, s.rowid) AS rn
        FROM review_submissions s JOIN hosting_versions v ON v.submission_id=s.id
        WHERE s.reopen_of IS NULL AND s.status IN ('approved','rejected') AND v.member_id IN (${LIST}))
      SELECT member_id, COUNT(*) AS n, SUM(status='approved') AS ok FROM firsts WHERE rn=1 AND decided_at>=? GROUP BY member_id`).bind(list, now - WINDOW),
    // 託管流程之前登記的舊卡：送審歷史不齊，不能確定是不是新人
    db.prepare(`SELECT DISTINCT i.member_id FROM member_identities i JOIN cards c ON c.provider=i.provider AND c.author_num_id=CAST(i.external_id AS INTEGER)
      WHERE i.member_id IN (${LIST}) AND NOT EXISTS(SELECT 1 FROM works w WHERE w.source_provider=c.provider AND w.source_role_id=c.source_role_id)`).bind(list),
    db.prepare(`SELECT id, created_at FROM members WHERE id IN (${LIST})`).bind(list),
    // 復原的案件是審核員認定移錯了，不算作者的不受理次數
    db.prepare(`SELECT author_member_id AS member_id, COUNT(*) AS n FROM review_drop_cases WHERE author_member_id IN (${LIST}) AND opened_at>=? AND close_reason IS NOT 'restored' GROUP BY author_member_id`).bind(list, now - 90 * DAY),
    db.prepare(`SELECT author_member_id, kind, value, expires_at FROM review_author_marks m
      WHERE author_member_id IN (${LIST}) AND revoked_at IS NULL AND expires_at>?
      AND created_at=(SELECT MAX(created_at) FROM review_author_marks x WHERE x.author_member_id=m.author_member_id AND x.kind=m.kind AND x.revoked_at IS NULL)`).bind(list, now),
    db.prepare(`SELECT f.author_member_id AS member_id, j.value AS mark, COUNT(*) AS n FROM review_events e
      JOIN review_submission_features f ON f.submission_id=e.submission_id, json_each(e.marks) j
      WHERE e.marks IS NOT NULL AND e.at>=? AND f.author_member_id IN (${LIST}) GROUP BY f.author_member_id, j.value`).bind(now - 90 * DAY, list),
  ]);
  const by = <T extends Record<string, unknown>>(rows: D1Result<T>, key = 'member_id') => new Map(rows.results.map((r) => [String(r[key]), r]));
  const workMap = by(works as D1Result<{ member_id: string; n: number }>);
  const firstMap = by(firsts as D1Result<{ member_id: string; n: number; ok: number }>);
  const legacySet = new Set((legacy as D1Result<{ member_id: string }>).results.map((r) => r.member_id));
  const memberMap = by(members as D1Result<{ id: string; created_at: number }>, 'id');
  const dropMap = by(drops as D1Result<{ member_id: string; n: number }>);
  const markRows = (marks as D1Result<{ author_member_id: string; kind: 'tier' | 'batch'; value: string; expires_at: number }>).results;
  for (const id of ids) {
    const decided = firstMap.get(id)?.n ?? 0, firstPass = firstMap.get(id)?.ok ?? 0;
    const tier = autoTier({ works: workMap.get(id)?.n ?? 0, decided, firstPass, legacy: legacySet.has(id) });
    const profile: AuthorProfile = {
      tier, autoTier: tier, batchSuspected: false, autoBatch: false, manual: {},
      basis: {
        works: workMap.get(id)?.n ?? 0, decidedWorks: decided, firstPassRate: decided ? firstPass / decided : null,
        qualityScore: decided >= 20 ? Math.round(wilsonLower(firstPass, decided) * 100) : null,
        memberSince: memberMap.get(id)?.created_at ?? null, deviceAccounts: null, deviceRecentWorks: null, dropCases90d: dropMap.get(id)?.n ?? 0,
        marks90d: Object.fromEntries((decisionMarks as D1Result<{ member_id: string; mark: string; n: number }>).results.filter((r) => r.member_id === id).map((r) => [r.mark, r.n])),
      },
    };
    for (const m of markRows.filter((r) => r.author_member_id === id)) {
      if (m.kind === 'tier') { profile.manual.tier = { expiresAt: m.expires_at }; profile.tier = m.value === 'none' ? 'general' : (m.value as AuthorTier); }
    }
    out.set(id, profile);
  }
  return out;
}

export interface DeviceSignal { accounts: number; recentMembers: number; recentWorks: number; suspected: boolean }

/**
 * 同一個安裝：最近 90 天連過的帳號數（含本作者），以及過去 24 小時用它登記的不同帳號、不同作品數。
 * 白名單（合法共用電腦）成員不算。安裝雜湊只在這裡比對，回應只給計數。
 */
export async function deviceSignals(db: D1Database, hashes: string[], now: number): Promise<Map<string, DeviceSignal>> {
  const list = [...new Set(hashes.filter(Boolean))];
  const out = new Map<string, DeviceSignal>();
  if (!list.length) return out;
  const json = JSON.stringify(list);
  const [accounts, recent] = await db.batch([
    db.prepare(`SELECT device_hash, COUNT(DISTINCT member_id) AS n FROM reward_devices WHERE device_hash IN (${LIST}) GROUP BY device_hash`).bind(json),
    db.prepare(`SELECT r.device_hash, COUNT(DISTINCT r.author_num_id) AS members, COUNT(DISTINCT r.source_role_id) AS works
      FROM card_registrations r WHERE r.device_hash IN (${LIST}) AND r.registered_at>?
      AND NOT EXISTS(SELECT 1 FROM member_identities i JOIN quota_device_exemptions e ON e.member_id=i.member_id AND e.revoked_at IS NULL
        WHERE i.provider=r.provider AND i.external_id=CAST(r.author_num_id AS TEXT))
      GROUP BY r.device_hash`).bind(json, now - DAY),
  ]);
  const acc = new Map((accounts as D1Result<{ device_hash: string; n: number }>).results.map((r) => [r.device_hash, r.n]));
  const rec = new Map((recent as D1Result<{ device_hash: string; members: number; works: number }>).results.map((r) => [r.device_hash, r]));
  for (const hash of list) {
    const r = rec.get(hash);
    out.set(hash, { accounts: acc.get(hash) ?? 1, recentMembers: r?.members ?? 0, recentWorks: r?.works ?? 0, suspected: !!r && r.members >= 3 && r.works >= 6 });
  }
  return out;
}

/** 疑似批量的人工覆寫（取消或加上），在 authorProfiles 之後套用 */
export async function applyBatchMarks(db: D1Database, profiles: Map<string, AuthorProfile>, now: number): Promise<void> {
  const ids = [...profiles.keys()];
  if (!ids.length) return;
  const rows = await db.prepare(`SELECT author_member_id, value, expires_at FROM review_author_marks m
    WHERE author_member_id IN (${LIST}) AND kind='batch' AND revoked_at IS NULL AND expires_at>?
    AND created_at=(SELECT MAX(created_at) FROM review_author_marks x WHERE x.author_member_id=m.author_member_id AND x.kind='batch' AND x.revoked_at IS NULL)`)
    .bind(JSON.stringify(ids), now).all<{ author_member_id: string; value: string; expires_at: number }>();
  for (const r of rows.results) {
    const p = profiles.get(r.author_member_id);
    if (!p) continue;
    p.manual.batch = { expiresAt: r.expires_at };
    p.batchSuspected = r.value === 'suspected';
  }
}

/** 取消標記：撤銷這一類的人工覆寫，馬上恢復最新的自動標記（不是改標成「沒有」） */
export async function revokeAuthorMark(db: D1Database, input: { authorMemberId: string; kind: 'tier' | 'batch'; now: number }): Promise<number> {
  const r = await db.prepare('UPDATE review_author_marks SET revoked_at=? WHERE author_member_id=? AND kind=? AND revoked_at IS NULL').bind(input.now, input.authorMemberId, input.kind).run();
  return r.meta.changes ?? 0;
}

export const MARK_REASONS = ['shared_device', 'missing_data', 'content_checked', 'other'] as const;
const TIER_VALUES = ['new', 'stable', 'top', 'none'] as const;
const BATCH_VALUES = ['suspected', 'clear'] as const;

/**
 * 審核員改標記：結構化原因必選，「其他」要補一句。人工標記優先，到期（疑似批量 30 天、其他 90 天）恢復自動值。
 * 前後的自動值與顯示值分存，給覆寫率與改標方向。
 */
export async function markAuthor(db: D1Database, input: {
  authorMemberId: string; kind: 'tier' | 'batch'; value: string; reasonCode: string; note: string; autoValue: string; actorMemberId: string; now: number;
}): Promise<{ id: string; expiresAt: number }> {
  const values: readonly string[] = input.kind === 'tier' ? TIER_VALUES : BATCH_VALUES;
  if (!values.includes(input.value)) throw new HttpError(400, 'review_mark_invalid');
  if (!(MARK_REASONS as readonly string[]).includes(input.reasonCode)) throw new HttpError(400, 'review_mark_reason_required');
  const note = input.note.trim();
  if (input.reasonCode === 'other' && !note) throw new HttpError(400, 'review_mark_note_required');
  if (note.length > 500) throw new HttpError(400, 'note_too_long');
  const id = crypto.randomUUID(), expiresAt = input.now + MARK_TTL_MS[input.kind];
  await db.prepare(`INSERT INTO review_author_marks(id,author_member_id,kind,value,auto_value,reason_code,note,rule_version,actor_member_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, input.authorMemberId, input.kind, input.value, input.autoValue, input.reasonCode, note, PROFILE_RULE_VERSION, input.actorMemberId, input.now, expiresAt).run();
  return { id, expiresAt };
}
