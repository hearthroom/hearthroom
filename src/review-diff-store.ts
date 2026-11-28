import { EARLIER_DECIDED } from './review';
import { diffSettings, summarizeOnly, type ReviewDiff } from './review-diff';
import { bumpOp } from './ops-metrics';
import type { ProviderId } from './providers';
import type { Env } from './types';
import { upstream } from './upstream';

/**
 * 更新差異的基準與摘要（審卡 V2 第二批，ui.md §4.1、da.md「前後差異」）。
 *
 * 基準在送審當下固定：駁回後重送比上次駁回版，其餘有過審版本的更新比上次過審版。兩邊的設定都是 Harbor 的
 * 封存版（Harbor 不刪封存版，審核讀取只認已封存的正式版，跟審核結果無關），本站只存基準的封存版號與純量摘要。
 * 摘要在送審後補算（不放進送審主流程：Harbor 讀失敗不該讓送審失敗），排程再補漏；三次讀不到記成 unreadable，
 * 審核頁顯示「無法比較」。統計把 no_base／unreadable／pending 另列，不混進「有改動」。
 */
const MAX_ATTEMPTS = 3;

/** 這張單的比對基準（只給作者自己送的單）。送審同一批寫入；排程也用它替舊單補。 */
const BASE_SELECT = (where: string) => `SELECT s.id,
    CASE WHEN p.status='rejected' THEN 'rejected' ELSE 'approved' END,
    CASE WHEN p.status='rejected' THEN pv.hosted_revision_id ELSE av.hosted_revision_id END,
    CASE WHEN (CASE WHEN p.status='rejected' THEN pv.hosted_revision_id ELSE av.hosted_revision_id END) IS NULL THEN 'no_base' ELSE 'pending' END,
    ?
  FROM review_submissions s JOIN cards c ON c.id=s.card_id
  LEFT JOIN review_submissions p ON p.id=(SELECT p.id FROM review_submissions p WHERE ${EARLIER_DECIDED('p', 's')} ORDER BY p.submitted_at DESC, p.rowid DESC LIMIT 1)
  LEFT JOIN hosting_versions pv ON pv.submission_id=p.id
  LEFT JOIN hosting_versions av ON av.version_id=c.approved_version_id
  WHERE ${where} AND s.reopen_of IS NULL AND (p.status='rejected' OR c.approved_version_id IS NOT NULL)`;

export function diffBaseStatement(db: D1Database, submissionId: string, now: number): D1PreparedStatement {
  return db.prepare(`INSERT OR IGNORE INTO review_submission_diffs(submission_id,base_kind,base_revision,state,created_at) ${BASE_SELECT('s.id=?')}`).bind(now, submissionId);
}

/** 0146 之前就在排隊的單：補上基準（用當下的歷史推導） */
export function backfillBaseStatement(db: D1Database, now: number): D1PreparedStatement {
  return db.prepare(`INSERT OR IGNORE INTO review_submission_diffs(submission_id,base_kind,base_revision,state,created_at)
    ${BASE_SELECT("s.status='pending' AND NOT EXISTS(SELECT 1 FROM review_submission_diffs d WHERE d.submission_id=s.id)")}`).bind(now);
}

interface DiffRow { submission_id: string; base_kind: 'approved' | 'rejected'; base_revision: string | null; state: string; attempts: number; source_role_id: string; provider: string; content_hash: string }

const rowOf = (db: D1Database, submissionId: string) => db.prepare(`SELECT d.*, s.source_role_id, s.provider, s.content_hash FROM review_submission_diffs d
  JOIN review_submissions s ON s.id=d.submission_id WHERE d.submission_id=?`).bind(submissionId).first<DiffRow>();

/** 兩邊的封存版設定。舊流程（沒有託管版本）的單沒有封存版可讀：null */
async function readPair(env: Env, row: DiffRow) {
  if (!row.base_revision || !row.content_hash.startsWith('version:')) return null;
  const provider = row.provider as ProviderId;
  const [base, current] = await Promise.all([
    upstream.readSealedForReview(env, row.base_revision, provider),
    upstream.readSealedForReview(env, row.source_role_id, provider),
  ]);
  return { base, current };
}

/** 補算一張單的摘要。失敗只加次數，三次後記成 unreadable。 */
export async function computeDiffSummary(env: Env, submissionId: string, now = Date.now()): Promise<string> {
  const row = await rowOf(env.DB, submissionId);
  if (!row || row.state !== 'pending') return row?.state ?? 'missing';
  try {
    const pair = await readPair(env, row);
    if (!pair) {
      await env.DB.prepare("UPDATE review_submission_diffs SET state='no_base',computed_at=? WHERE submission_id=? AND state='pending'").bind(now, submissionId).run();
      await bumpOp(env.DB, 'review_diff', 'summary', 'no_base');
      return 'no_base';
    }
    const summary = summarizeOnly(pair.base, pair.current);
    await env.DB.prepare("UPDATE review_submission_diffs SET state='done',summary=?,computed_at=? WHERE submission_id=? AND state='pending'").bind(JSON.stringify(summary), now, submissionId).run();
    await bumpOp(env.DB, 'review_diff', 'summary', 'success');
    return 'done';
  } catch {
    const giveUp = row.attempts + 1 >= MAX_ATTEMPTS;
    await env.DB.prepare(`UPDATE review_submission_diffs SET attempts=attempts+1, state=CASE WHEN ? THEN 'unreadable' ELSE state END, computed_at=CASE WHEN ? THEN ? ELSE computed_at END WHERE submission_id=? AND state='pending'`)
      .bind(giveUp ? 1 : 0, giveUp ? 1 : 0, now, submissionId).run();
    await bumpOp(env.DB, 'review_diff', 'summary', giveUp ? 'unreadable' : 'error');
    return giveUp ? 'unreadable' : 'pending';
  }
}

/** 排程補漏：替舊單補基準，再補算幾張還沒算的（每輪少量，Harbor 讀取有成本） */
export async function diffMaintenance(env: Env, now = Date.now(), limit = 3): Promise<number> {
  await backfillBaseStatement(env.DB, now).run();
  const rows = await env.DB.prepare(`SELECT d.submission_id FROM review_submission_diffs d JOIN review_submissions s ON s.id=d.submission_id
    WHERE d.state='pending' AND s.status='pending' ORDER BY d.created_at LIMIT ?`).bind(limit).all<{ submission_id: string }>();
  for (const r of rows.results) await computeDiffSummary(env, r.submission_id, now);
  return rows.results.length;
}

export type DiffView =
  | { state: 'no_base' | 'unreadable' | 'missing' }
  | { state: 'ready'; baseKind: 'approved' | 'rejected'; diff: ReviewDiff };

/** 審核頁的完整差異：即時讀兩邊的封存版，不落本站。讀不到就回 unreadable（畫面顯示無法比較）。 */
export async function diffView(env: Env, submissionId: string, { cacheSummary = true } = {}): Promise<DiffView> {
  const row = await rowOf(env.DB, submissionId);
  if (!row) return { state: 'missing' };
  if (!row.base_revision) return { state: 'no_base' };
  try {
    const pair = await readPair(env, row);
    if (!pair) return { state: 'no_base' };
    const diff = diffSettings(pair.base, pair.current);
    // 順手把摘要補上（審核員打開時就有了，不必等排程）
    if (cacheSummary && row.state === 'pending') await env.DB.prepare("UPDATE review_submission_diffs SET state='done',summary=?,computed_at=? WHERE submission_id=? AND state='pending'").bind(JSON.stringify(diff.summary), Date.now(), submissionId).run();
    await bumpOp(env.DB, 'review_diff', 'view', 'success');
    return { state: 'ready', baseKind: row.base_kind, diff };
  } catch {
    await bumpOp(env.DB, 'review_diff', 'view', 'unreadable');
    return { state: 'unreadable' };
  }
}
