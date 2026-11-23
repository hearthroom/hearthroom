import { CLAIM_TTL_MS, getSubmission } from './review';
import { reviewerRole } from './members';
import { queueContext, reviewEventStatement, type QueueContext } from './review-v2';
import { HttpError, pickLocale, type Localized } from './types';

/**
 * 不受理（owner 2026-11-23）：審核員零成本把一張卡移出待審佇列。不是判定：不寫理由、不通知作者、
 * 作者端照舊顯示「審核中」，送審單的狀態也一直是 pending。作者隨時能取消送審；改了再送就回到待審，
 * 原樣再送會自動回到不受理（同一個案件，見 review-v2.ts dropCaseForSubmission）。任何審核員都能復原。
 *
 * 規則（ui.md §2.1，PM 2026-11-23 裁定）：不必先領取；別人領著、冷凍中、重新審核單、同步中的定案不可；
 * 自己領著的可以，同時放回領取。批量限管理員，範圍只限同一位作者或同一個已知安裝的待審單。
 */
export type DropSource = 'single' | 'author_batch' | 'device_batch';
export const DROP_REVIEW_AGE_MS = 7 * 86_400_000;

const isManager = (role: Awaited<ReturnType<typeof reviewerRole>>) => role === 'manager' || role === 'owner';
const ACTIVE_DROP = (alias: string) => `EXISTS(SELECT 1 FROM review_drops d WHERE d.submission_id=${alias}.id AND d.restored_at IS NULL)`;
export const NOT_DROPPED = (alias: string) => `NOT ${ACTIVE_DROP(alias)}`;

/** 單子現在能不能被移出：能就回 null，不能回錯誤代碼。 */
async function dropBlocker(db: D1Database, id: string, memberId: string, now: number): Promise<string | null> {
  const row = await db.prepare(`SELECT s.status, s.reopen_of, s.claimed_by, s.claimed_at,
      EXISTS(SELECT 1 FROM review_holds h WHERE h.card_id=s.card_id) AS held,
      EXISTS(SELECT 1 FROM work_review_decisions w WHERE w.submission_id=s.id) AS deciding,
      ${ACTIVE_DROP('s')} AS dropped
    FROM review_submissions s WHERE s.id=?`).bind(id).first<{ status: string; reopen_of: string | null; claimed_by: string | null; claimed_at: number | null; held: number; deciding: number; dropped: number }>();
  if (!row) return 'review_not_found';
  if (row.status !== 'pending' || row.deciding) return 'review_decided';
  if (row.reopen_of) return 'review_drop_reopen';
  if (row.dropped) return 'review_dropped';
  if (row.held) return 'review_held';
  if (row.claimed_by && row.claimed_by !== memberId && row.claimed_at !== null && now - row.claimed_at < CLAIM_TTL_MS) return 'claimed_by_other';
  return null;
}

/** 移出一張。成功回案件編號；不能移出丟 409（代碼見 dropBlocker）。 */
export async function dropSubmission(db: D1Database, input: { submissionId: string; memberId: string; now: number; source?: DropSource; batchId?: string | null; ctx?: QueueContext }): Promise<{ caseId: string }> {
  const source = input.source ?? 'single';
  const blocker = await dropBlocker(db, input.submissionId, input.memberId, input.now);
  if (blocker === 'review_not_found') throw new HttpError(404, 'submission not found');
  if (blocker) throw new HttpError(409, blocker);
  const row = await getSubmission(db, input.submissionId);
  const ctx = input.ctx ?? await queueContext(db, row.id);
  const caseId = crypto.randomUUID(), dropId = crypto.randomUUID();
  // 寫入當下再確認一次全部條件：上面的檢查與這裡之間，別人可能剛領走、冷凍或蓋完章
  const eligible = `s.id=? AND s.status='pending' AND s.reopen_of IS NULL AND ${NOT_DROPPED('s')}
    AND NOT EXISTS(SELECT 1 FROM review_holds h WHERE h.card_id=s.card_id)
    AND NOT EXISTS(SELECT 1 FROM work_review_decisions w WHERE w.submission_id=s.id)
    AND (s.claimed_by IS NULL OR s.claimed_by=? OR s.claimed_at<=?)`;
  const result = await db.batch([
    db.prepare(`INSERT INTO review_drop_cases(id,card_id,author_member_id,fingerprint,source,opened_by,opened_at)
      SELECT ?,s.card_id,(SELECT member_id FROM hosting_versions WHERE submission_id=s.id),s.content_fingerprint,?,?,? FROM review_submissions s WHERE ${eligible}`)
      .bind(caseId, source, input.memberId, input.now, row.id, input.memberId, input.now - CLAIM_TTL_MS),
    db.prepare(`INSERT INTO review_drops(id,submission_id,case_id,source,actor_member_id,batch_id,created_at)
      SELECT ?,?,id,source,?,?,? FROM review_drop_cases WHERE id=?`)
      .bind(dropId, row.id, input.memberId, input.batchId ?? null, input.now, caseId),
    // 自己領著的同時放回領取
    db.prepare(`UPDATE review_submissions SET claimed_by=NULL,claimed_at=NULL,claim_generation='' WHERE id=? AND claimed_by=? AND EXISTS(SELECT 1 FROM review_drops WHERE id=?)`)
      .bind(row.id, input.memberId, dropId),
    reviewEventStatement(db, {
      key: 'drop:' + dropId, submissionId: row.id, cardId: row.card_id, at: input.now, action: 'drop', from: 'pending', to: 'dropped',
      actorKind: 'reviewer', actorMemberId: input.memberId, source, batchId: input.batchId ?? null, ctx,
      guard: { sql: 'EXISTS(SELECT 1 FROM review_drops WHERE id=?)', args: [dropId] },
    }),
  ]);
  if (!result[0]?.meta.changes) {
    const again = await dropBlocker(db, input.submissionId, input.memberId, input.now);
    throw new HttpError(409, again ?? 'review_drop_conflict');
  }
  return { caseId };
}

/** 復原：回到待審，保留原送審時間（排在原位）。任何審核員都能復原；沒在不受理就當成功（冪等）。 */
export async function restoreSubmission(db: D1Database, input: { submissionId: string; memberId: string; now: number; batchId?: string | null }): Promise<{ restored: boolean }> {
  const row = await getSubmission(db, input.submissionId);
  // 已經撤回、被取代的單留著的舊紀錄不算：它不在清單上，復原它不會讓任何卡回到待審
  if (row.status !== 'pending') return { restored: false };
  const drop = await db.prepare('SELECT id, case_id FROM review_drops WHERE submission_id=? AND restored_at IS NULL').bind(row.id).first<{ id: string; case_id: string }>();
  if (!drop) return { restored: false };
  const result = await db.batch([
    db.prepare('UPDATE review_drops SET restored_at=?, restored_by=? WHERE id=? AND restored_at IS NULL').bind(input.now, input.memberId, drop.id),
    db.prepare("UPDATE review_drop_cases SET closed_at=?, close_reason='restored' WHERE id=? AND closed_at IS NULL AND EXISTS(SELECT 1 FROM review_drops WHERE id=? AND restored_at=? AND restored_by=?)")
      .bind(input.now, drop.case_id, drop.id, input.now, input.memberId),
    reviewEventStatement(db, {
      key: 'restore:' + drop.id, submissionId: row.id, cardId: row.card_id, at: input.now, action: 'restore', from: 'dropped', to: row.status === 'pending' ? 'pending' : row.status,
      actorKind: 'reviewer', actorMemberId: input.memberId, batchId: input.batchId ?? null,
      guard: { sql: 'EXISTS(SELECT 1 FROM review_drops WHERE id=? AND restored_at=? AND restored_by=?)', args: [drop.id, input.now, input.memberId] },
    }),
  ]);
  return { restored: !!result[0]?.meta.changes };
}

export type GroupScope = 'author' | 'device';

/**
 * 同一位作者、或同一個已知安裝的待審單（含錨點那張；已在不受理清單的不算，提示列、sheet 標題與按鈕的張數同一個口徑）。同裝置不認識（沒有安裝紀錄）就回 null：
 * 不顯示這組。已核准的共用設備白名單成員排除（他們合法共用電腦，不該被一起圈進來）。
 */
export async function groupSubmissionIds(db: D1Database, anchorId: string, scope: GroupScope): Promise<string[] | null> {
  if (scope === 'author') {
    const author = await db.prepare('SELECT member_id FROM hosting_versions WHERE submission_id=?').bind(anchorId).first<{ member_id: string }>();
    if (!author) return null;
    const rows = await db.prepare(`SELECT s.id FROM review_submissions s JOIN hosting_versions v ON v.submission_id=s.id
      WHERE v.member_id=? AND s.status='pending' AND s.reopen_of IS NULL AND ${NOT_DROPPED('s')} ORDER BY s.submitted_at, s.rowid`).bind(author.member_id).all<{ id: string }>();
    return rows.results.map((r) => r.id);
  }
  const device = await db.prepare('SELECT device_hash FROM review_submission_devices WHERE submission_id=?').bind(anchorId).first<{ device_hash: string }>();
  if (!device) return null;
  const rows = await db.prepare(`SELECT s.id FROM review_submissions s JOIN review_submission_devices sd ON sd.submission_id=s.id
    JOIN hosting_versions v ON v.submission_id=s.id
    WHERE sd.device_hash=? AND s.status='pending' AND s.reopen_of IS NULL AND ${NOT_DROPPED('s')}
    AND NOT EXISTS(SELECT 1 FROM quota_device_exemptions e WHERE e.member_id=v.member_id AND e.revoked_at IS NULL)
    ORDER BY s.submitted_at, s.rowid`).bind(device.device_hash).all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

export interface GroupItem {
  id: string; cardId: string; name: string; coverUrl: string | null; openingLine: string;
  adultHidden: boolean; dropped: boolean; held: boolean; claimedByOther: boolean;
}

/** 批量 sheet 的列：卡名、封面、公開開場白的第一行（讓管理員確認不是誤判）。都是公開資料。 */
export async function groupItems(db: D1Database, ids: string[], viewer: { memberId: string; adultAllowed: boolean; now: number; lang: string }): Promise<GroupItem[]> {
  if (!ids.length) return [];
  // 一組可能上百張：名單綁成一個 JSON 陣列（D1 一個查詢最多 100 個綁定參數）
  const rows = await db.prepare(`SELECT s.id, s.card_id, s.rating, s.claimed_by, s.claimed_at, v.public_role,
      EXISTS(SELECT 1 FROM review_holds h WHERE h.card_id=s.card_id) AS held, ${ACTIVE_DROP('s')} AS dropped
    FROM review_submissions s JOIN hosting_versions v ON v.submission_id=s.id WHERE s.id IN (SELECT value FROM json_each(?)) ORDER BY s.submitted_at, s.rowid`)
    .bind(JSON.stringify(ids)).all<{ id: string; card_id: number; rating: string | null; claimed_by: string | null; claimed_at: number | null; public_role: string | null; held: number; dropped: number }>();
  return rows.results.map((r) => {
    const role = r.public_role ? (JSON.parse(r.public_role) as { names?: Localized; welcome?: string; backgroundUrl?: string | null; avatarUrl?: string | null }) : {};
    const hidden = r.rating === 'R' && !viewer.adultAllowed;
    const line = (role.welcome ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
    return {
      id: r.id, cardId: String(r.card_id),
      name: hidden ? '' : pickLocale(role.names ?? ({} as Localized), viewer.lang).slice(0, 120),
      coverUrl: hidden ? null : role.backgroundUrl || role.avatarUrl || null,
      openingLine: hidden ? '' : line.slice(0, 120),
      adultHidden: hidden, dropped: !!r.dropped, held: !!r.held,
      claimedByOther: !!r.claimed_by && r.claimed_by !== viewer.memberId && r.claimed_at !== null && viewer.now - r.claimed_at < CLAIM_TTL_MS,
    };
  });
}

/** 一次批次最多幾張：每張約四個查詢，D1 一次請求最多 1000 個 */
export const BATCH_MAX = 100;
export interface BatchResult { batchId: string; dropped: string[]; skipped: { id: string; reason: string }[] }

/**
 * 批量不受理（限管理員）。只動錨點那一組裡的單；每張各自寫入、各自記事件（同一個批次編號），
 * 剛被領走、冷凍、已定案的略過並寫原因：部分成功不說成全部成功。
 */
export async function dropBatch(db: D1Database, input: { anchorId: string; scope: GroupScope; ids: string[]; memberId: string; now: number; batchId?: string }): Promise<BatchResult> {
  if (!isManager(await reviewerRole(db, input.memberId))) throw new HttpError(403, 'review_batch_manager_required');
  const group = await groupSubmissionIds(db, input.anchorId, input.scope);
  if (!group) throw new HttpError(409, 'review_group_unknown');
  const inGroup = new Set(group);
  const batchId = input.batchId ?? crypto.randomUUID();
  const out: BatchResult = { batchId, dropped: [], skipped: [] };
  // 重送同一個批次（第一次的回應沒收到）：這一批已經移出的照樣算移出，不報成略過
  const done = new Set((await db.prepare('SELECT submission_id FROM review_drops WHERE batch_id=? AND restored_at IS NULL').bind(batchId).all<{ submission_id: string }>()).results.map((r) => r.submission_id));
  // 當下計數在變更前算一次，整批共用（da.md）；也讓一次請求的查詢數留在 D1 的上限內
  const ctx = await queueContext(db, input.anchorId);
  const unique = [...new Set(input.ids)];
  for (const id of unique.slice(BATCH_MAX)) out.skipped.push({ id, reason: 'batch_limit' });
  for (const id of unique.slice(0, BATCH_MAX)) {
    if (done.has(id)) { out.dropped.push(id); continue; }
    if (!inGroup.has(id)) { out.skipped.push({ id, reason: 'not_in_group' }); continue; }
    try {
      await dropSubmission(db, { submissionId: id, memberId: input.memberId, now: input.now, source: input.scope === 'author' ? 'author_batch' : 'device_batch', batchId, ctx });
      out.dropped.push(id);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      out.skipped.push({ id, reason: error.message });
    }
  }
  return out;
}

/** 批量復原（「復原這 N 張」）。只復原這個批次移出、還在不受理的單。 */
export async function restoreBatch(db: D1Database, input: { batchId: string; memberId: string; now: number }): Promise<{ restored: string[] }> {
  if (!isManager(await reviewerRole(db, input.memberId))) throw new HttpError(403, 'review_batch_manager_required');
  // 這一批開的案件裡現在還在清單上的單：作者撤回後原樣重送、自動回到清單的那張也一起復原
  const rows = await db.prepare(`SELECT d.submission_id FROM review_drops d JOIN review_submissions s ON s.id=d.submission_id
    WHERE d.restored_at IS NULL AND s.status='pending' AND d.case_id IN (SELECT case_id FROM review_drops WHERE batch_id=?)`).bind(input.batchId).all<{ submission_id: string }>();
  const restored: string[] = [];
  for (const r of rows.results) if ((await restoreSubmission(db, { submissionId: r.submission_id, memberId: input.memberId, now: input.now, batchId: input.batchId })).restored) restored.push(r.submission_id);
  return { restored };
}

export type DroppedFilter = 'all' | 'single' | 'batch' | 'auto' | 'aged';

export interface DroppedItem {
  id: string; cardId: string; name: string; avatarUrl: string | null; adultHidden: boolean;
  source: 'single' | 'author_batch' | 'device_batch' | 'auto_same_content';
  /** 案件起點：作者原樣重送沿用第一次不受理的時間 */
  droppedSince: number; submittedAt: number; actor: string | null; rating: string | null;
}

/** 不受理清單。aged＝已滿 7 天（管理員抽樣覆核的入口）。 */
export async function listDropped(db: D1Database, viewer: { memberId: string; adultAllowed: boolean; now: number; lang: string }, filter: DroppedFilter): Promise<{ items: DroppedItem[]; total: number }> {
  const where = filter === 'single' ? "d.source='single'" : filter === 'batch' ? "d.source IN ('author_batch','device_batch')"
    : filter === 'auto' ? "d.source='auto_same_content'" : filter === 'aged' ? 'k.opened_at<=?' : '1=1';
  // 審核員自己也寫卡：自己的卡不出現在清單（作者永遠不知道卡被不受理，包括身兼審核員的作者）
  const args = [viewer.memberId, ...(filter === 'aged' ? [viewer.now - DROP_REVIEW_AGE_MS] : [])];
  const base = `FROM review_drops d JOIN review_drop_cases k ON k.id=d.case_id JOIN review_submissions s ON s.id=d.submission_id
    JOIN cards c ON c.id=s.card_id LEFT JOIN hosting_versions v ON v.submission_id=s.id LEFT JOIN members m ON m.id=d.actor_member_id
    WHERE d.restored_at IS NULL AND s.status='pending' AND (v.member_id IS NULL OR v.member_id<>?) AND ${where}`;
  const total = await db.prepare(`SELECT COUNT(*) AS n ${base}`).bind(...args).first<{ n: number }>();
  const rows = await db.prepare(`SELECT s.id, s.card_id, s.rating, s.submitted_at, d.source, k.opened_at,
      COALESCE(json_extract(v.public_role,'$.names'),c.names) AS names,
      COALESCE(NULLIF(json_extract(v.public_role,'$.backgroundUrl'),''),json_extract(v.public_role,'$.avatarUrl'),c.background_url) AS avatar_url,
      COALESCE(NULLIF(m.display_name,''),m.handle) AS actor
    ${base} ORDER BY k.opened_at ASC LIMIT 200`).bind(...args)
    .all<{ id: string; card_id: number; rating: string | null; submitted_at: number; source: DroppedItem['source']; opened_at: number; names: string; avatar_url: string | null; actor: string | null }>();
  return {
    total: total?.n ?? 0,
    items: rows.results.map((r) => {
      const hidden = r.rating === 'R' && !viewer.adultAllowed;
      return {
        id: r.id, cardId: String(r.card_id), rating: r.rating, adultHidden: hidden,
        name: hidden ? '' : pickLocale(JSON.parse(r.names) as Localized, viewer.lang),
        avatarUrl: hidden ? null : r.avatar_url, source: r.source, droppedSince: r.opened_at, submittedAt: r.submitted_at,
        actor: r.source === 'auto_same_content' ? null : (r.actor ?? '').slice(0, 80),
      };
    }),
  };
}

/** 這張單現在在不受理中嗎（給審核頁唯讀與領取守門） */
export async function isDropped(db: D1Database, submissionId: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 FROM review_drops WHERE submission_id=? AND restored_at IS NULL').bind(submissionId).first());
}
