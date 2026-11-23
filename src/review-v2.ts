import { effectiveCharacters, reviewLength } from './review-length';
import { reviewCounts } from './review';
import type { UpstreamRole } from './upstream';
import { HttpError } from './types';
import { isReviewReason, REVIEW_REASONS } from '../shared/review-reasons';

/**
 * 審卡 V2 第一批（任務 2026-11-23-review-system-v2，規格 da.md）：送審特徵、內容指紋、審核事件。
 *
 * 每一次審核都是對審核系統的回饋（owner 2026-11-23）：送審當下記下卡片的形狀（各欄字數、世界書條目數…），
 * 每次人工作業記一筆事件（誰、什麼動作、理由代碼、領取後經過多久、當時佇列裡同作者／同裝置還有幾張），
 * 統計與之後的標籤迭代都從這兩張表讀。只存數字、代碼與內部參照：不存內容原文、備註、裝置雜湊。
 */
export const REVIEW_SPEC_VERSION = 1;
export const FINGERPRINT_PREFIX = 'fp1:';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** 物件鍵排序、陣列順序與文字原樣保留：同一份內容在任何一次封存都算出同一串 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonical(v);
    }
    return out;
  }
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 封存時每張上傳的圖都會複製成新的版本路徑、世界書會換新編號：這些欄位每次封存都不同，不能進指紋。
// 圖片改用作者草稿上的網址（同一張圖不重傳就不變，換了圖就變）。
const SEALED_MEDIA_FIELDS = ['roleAvatar', 'roleBackground', 'roleBackgroundLandscape', 'roleShareImage'];

/**
 * 內容指紋：判斷「不受理後原樣重送」。白名單＝封存版的設定、開場與序章、世界卡成員、世界書（含停用條目）、
 * 正規表示式與樣式，加上草稿的圖片網址、分級問卷答案與原作。版本號、狀態、封存產生的編號都不進。
 * 算不出來（讀不到設定）回 null：交人工，一律回待審。誤判「不同」只是回到佇列，誤判「相同」會讓改過的卡卡住。
 */
export async function contentFingerprint(
  settings: Record<string, unknown>,
  draft: Pick<UpstreamRole, 'avatarUrl' | 'backgroundUrl' | 'backgroundLandscapeUrl' | 'shareImageUrl'>,
  extra: { ratingAnswers: string; fandomKey: string },
): Promise<string | null> {
  const document = record(settings.document);
  if (!('roleDetailDesc' in document)) return null;
  const doc: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(document)) if (!SEALED_MEDIA_FIELDS.includes(k)) doc[k] = v;
  const books = (Array.isArray(settings.worldbooks) ? settings.worldbooks : settings.worldbook ? [settings.worldbook] : []).map((b) => {
    const { worldbookId: _id, ...rest } = record(b);
    return rest;
  });
  const { status: _status, version: _version, ...asset } = record(settings.authorAsset);
  const payload = {
    document: doc,
    greetings: record(settings.greetings),
    worldbooks: books,
    authorAsset: asset,
    media: {
      avatar: draft.avatarUrl ?? '', background: draft.backgroundUrl ?? '',
      landscape: draft.backgroundLandscapeUrl ?? '', share: draft.shareImageUrl ?? '',
    },
    ratingAnswers: extra.ratingAnswers,
    fandom: extra.fandomKey,
  };
  return FINGERPRINT_PREFIX + (await sha256Hex(JSON.stringify(canonical(payload))));
}

export interface SubmissionFeatures {
  nameChars: number; summaryChars: number; settingChars: number;
  openingChars: number; alternateCount: number; alternateChars: number; prologueChars: number;
  totalChars: number; worldbookEntries: number; regexRules: number;
  hasFandom: boolean; lengthExempt: boolean;
}

/** 送審當下封存版的形狀：只有數字與布林。字數口徑跟送審門檻同一套（effectiveCharacters）。 */
export function submissionFeatures(settings: Record<string, unknown>, extra: { hasFandom: boolean; lengthExempt: boolean }): SubmissionFeatures {
  const doc = record(settings.document);
  const greetings = record(settings.greetings);
  const alternates = Array.isArray(greetings.alternates) ? greetings.alternates.map(text) : [];
  const prologue = Array.isArray(greetings.prologue) ? greetings.prologue.map(text) : [];
  const counts = reviewCounts(settings);
  return {
    nameChars: effectiveCharacters(doc.roleName), summaryChars: effectiveCharacters(doc.roleDesc),
    settingChars: effectiveCharacters(doc.roleDetailDesc), openingChars: effectiveCharacters(greetings.welcome),
    alternateCount: alternates.length, alternateChars: alternates.reduce((n, a) => n + effectiveCharacters(a), 0),
    prologueChars: prologue.reduce((n, a) => n + effectiveCharacters(a), 0),
    totalChars: reviewLength(settings).total,
    worldbookEntries: counts.worldbookEntries, regexRules: counts.regexRules,
    hasFandom: extra.hasFandom, lengthExempt: extra.lengthExempt,
  };
}

/**
 * 送審單建立時一起寫的 V2 紀錄（跟審核單同一批，單子沒寫成就什麼都不留）：送審特徵、這張單的安裝雜湊
 * （作業用，離開待審就刪）、以及不受理後原樣重送的自動移出。
 */
export function submissionRecordStatements(db: D1Database, input: {
  submissionId: string; cardId: string; memberId: string; now: number;
  features: SubmissionFeatures; deviceHash: string | null; fingerprint: string | null;
  autoDrop: { caseId: string } | null; closeCaseId: string | null;
}): D1PreparedStatement[] {
  const exists = 'EXISTS(SELECT 1 FROM review_submissions WHERE id=?)';
  const out: D1PreparedStatement[] = [
    db.prepare(`UPDATE review_submissions SET content_fingerprint=? WHERE id=?`).bind(input.fingerprint, input.submissionId),
    db.prepare(`INSERT OR IGNORE INTO review_submission_features(submission_id,spec_version,author_member_id,author_seq,has_prior,prior_result,has_approved_base,after_drop,features,created_at)
      SELECT ?1,?2,?3,(SELECT COUNT(*)+1 FROM review_submission_features WHERE author_member_id=?3),
       EXISTS(SELECT 1 FROM review_submissions p WHERE p.card_id=?4 AND p.reopen_of IS NULL AND p.id<>?1),
       (SELECT p.status FROM review_submissions p WHERE p.card_id=?4 AND p.reopen_of IS NULL AND p.id<>?1 AND p.status IN ('approved','rejected') ORDER BY p.submitted_at DESC,p.rowid DESC LIMIT 1),
       EXISTS(SELECT 1 FROM cards c WHERE c.id=?4 AND c.approved_version_id IS NOT NULL),?5,?6,?7
      WHERE ${exists.replace('?', '?1')}`)
      .bind(input.submissionId, REVIEW_SPEC_VERSION, input.memberId, input.cardId, input.closeCaseId ? 1 : 0, JSON.stringify(input.features), input.now),
    reviewEventStatement(db, { key: 'submit:' + input.submissionId, submissionId: input.submissionId, cardId: input.cardId, at: input.now, action: 'submit', to: 'pending', actorKind: 'author', actorMemberId: input.memberId, requireSubmission: true }),
  ];
  if (input.deviceHash) {
    out.push(db.prepare(`INSERT OR IGNORE INTO review_submission_devices(submission_id,device_hash,created_at) SELECT ?,?,? WHERE ${exists}`)
      .bind(input.submissionId, input.deviceHash, input.now, input.submissionId));
  }
  if (input.closeCaseId) {
    // 改版重送：案件結束，這張單回到一般佇列（列上標「不受理後改版重送」）
    out.push(db.prepare(`UPDATE review_drop_cases SET closed_at=?,close_reason='resubmitted_changed' WHERE id=? AND closed_at IS NULL AND ${exists}`)
      .bind(input.now, input.closeCaseId, input.submissionId));
  }
  if (input.autoDrop) {
    out.push(
      db.prepare(`INSERT INTO review_drops(id,submission_id,case_id,source,actor_member_id,batch_id,created_at)
        SELECT ?,?,?,'auto_same_content',NULL,NULL,? WHERE ${exists} AND EXISTS(SELECT 1 FROM review_drop_cases WHERE id=? AND closed_at IS NULL)`)
        .bind(crypto.randomUUID(), input.submissionId, input.autoDrop.caseId, input.now, input.submissionId, input.autoDrop.caseId),
      reviewEventStatement(db, { key: 'auto_drop:' + input.submissionId, submissionId: input.submissionId, cardId: input.cardId, at: input.now, action: 'drop', from: 'pending', to: 'dropped', actorKind: 'system', source: 'auto_same_content', requireSubmission: true }),
    );
  }
  return out;
}

/** 送審前要決定的事：原樣重送就沿用哪個不受理案件；改版重送就結束哪個案件。 */
export async function dropCaseForSubmission(db: D1Database, input: { cardId: string | null; memberId: string; fingerprint: string | null }): Promise<{ autoDrop: { caseId: string } | null; closeCaseId: string | null }> {
  if (input.fingerprint) {
    // 同作者複製成另一張卡原樣送也算：看作者與卡號兩邊
    const same = await db.prepare(`SELECT id FROM review_drop_cases WHERE closed_at IS NULL AND fingerprint=? AND (card_id=? OR author_member_id=?) ORDER BY opened_at DESC LIMIT 1`)
      .bind(input.fingerprint, input.cardId === null ? -1 : Number(input.cardId), input.memberId).first<{ id: string }>();
    if (same) return { autoDrop: { caseId: same.id }, closeCaseId: null };
  }
  if (input.cardId === null) return { autoDrop: null, closeCaseId: null };
  const open = await db.prepare(`SELECT id FROM review_drop_cases WHERE closed_at IS NULL AND card_id=? ORDER BY opened_at DESC LIMIT 1`).bind(Number(input.cardId)).first<{ id: string }>();
  return { autoDrop: null, closeCaseId: open?.id ?? null };
}

export interface QueueContext { sameAuthor: number | null; sameDevice: number | null; deviceKnown: boolean }

/** 「其他」可處理的待審卡（排除本卡、冷凍、不受理、同步中的定案）。 */
const OTHER_WORKABLE = `s.status='pending' AND s.reopen_of IS NULL AND s.card_id<>t.card_id
  AND NOT EXISTS(SELECT 1 FROM review_holds h WHERE h.card_id=s.card_id)
  AND NOT EXISTS(SELECT 1 FROM review_drops d WHERE d.submission_id=s.id AND d.restored_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM work_review_decisions w WHERE w.submission_id=s.id)`;

/** 作業當下佇列裡同作者、同安裝還有幾張別的卡在等（批量操作共用變更前的計數）。 */
export async function queueContext(db: D1Database, submissionId: string): Promise<QueueContext> {
  const row = await db.prepare(`SELECT
     (SELECT COUNT(DISTINCT s.card_id) FROM review_submissions s JOIN hosting_versions v ON v.submission_id=s.id
       WHERE ${OTHER_WORKABLE} AND v.member_id=(SELECT member_id FROM hosting_versions WHERE submission_id=t.id)) AS same_author,
     EXISTS(SELECT 1 FROM hosting_versions WHERE submission_id=t.id) AS author_known,
     (SELECT device_hash FROM review_submission_devices WHERE submission_id=t.id) AS device,
     (SELECT COUNT(DISTINCT s.card_id) FROM review_submissions s JOIN review_submission_devices sd ON sd.submission_id=s.id
       WHERE ${OTHER_WORKABLE} AND sd.device_hash=(SELECT device_hash FROM review_submission_devices WHERE submission_id=t.id)) AS same_device
    FROM review_submissions t WHERE t.id=?`).bind(submissionId).first<{ same_author: number; author_known: number; device: string | null; same_device: number }>();
  if (!row) return { sameAuthor: null, sameDevice: null, deviceKnown: false };
  return { sameAuthor: row.author_known ? row.same_author : null, sameDevice: row.device ? row.same_device : null, deviceKnown: !!row.device };
}

export interface ReviewEvent {
  key: string; submissionId: string; cardId: string | number; at: number; action: string;
  from?: string; to?: string; actorKind: 'author' | 'reviewer' | 'system'; actorMemberId?: string | null;
  source?: string | null; batchId?: string | null; reasons?: readonly string[] | null; reasonVersion?: number | null; coaching?: boolean | null;
  claimElapsedMs?: number | null; ctx?: QueueContext | null;
  /** 只在這張單還存在時寫（跟建立單子同一批時用） */
  requireSubmission?: boolean;
  /** 只在這個條件成立時寫（同一批裡前面的寫入真的生效了才記） */
  guard?: { sql: string; args: unknown[] };
}

/** 一筆審核事件。event_key 綁單子與那一次操作：重試、重放都不多記。 */
export function reviewEventStatement(db: D1Database, e: ReviewEvent): D1PreparedStatement {
  return db.prepare(`INSERT OR IGNORE INTO review_events(event_key,spec_version,submission_id,card_id,at,action,from_state,to_state,actor_kind,actor_member_id,source,batch_id,reasons,reason_version,coaching,claim_elapsed_ms,queue_same_author,queue_same_device,device_known,originality,originality_version)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,f.originality,f.originality_version
    FROM (SELECT 1) LEFT JOIN review_submission_features f ON f.submission_id=?3
    WHERE (?20=0 OR EXISTS(SELECT 1 FROM review_submissions WHERE id=?3))${e.guard ? ` AND (${e.guard.sql})` : ''}`)
    .bind(e.key, REVIEW_SPEC_VERSION, e.submissionId, Number(e.cardId), e.at, e.action, e.from ?? null, e.to ?? null, e.actorKind, e.actorMemberId ?? null,
      e.source ?? null, e.batchId ?? null, e.reasons?.length ? JSON.stringify(e.reasons) : null, e.reasonVersion ?? null,
      e.coaching === undefined || e.coaching === null ? null : e.coaching ? 1 : 0, e.claimElapsedMs ?? null,
      e.ctx?.sameAuthor ?? null, e.ctx?.sameDevice ?? null, e.ctx ? (e.ctx.deviceKnown ? 1 : 0) : null, e.requireSubmission ? 1 : 0, ...(e.guard?.args ?? []));
}

/** 審核頁開查重時記下這一版的相似度（同送審版最近一次成功的計算為準） */
export function recordOriginalityStatement(db: D1Database, submissionId: string, similarity: number, version: string, now: number): D1PreparedStatement {
  return db.prepare('UPDATE review_submission_features SET originality=?,originality_version=?,originality_at=? WHERE submission_id=?').bind(similarity, version, now, submissionId);
}

/**
 * 駁回理由的伺服器端規則：至少一個代碼、只收認得的代碼、去重；選「其他」一定要寫補充。
 * 有效字數未達標時一定帶「有效字數不足」（審核頁也是自動勾選、不能取消）。
 * 舊頁面只送說明、不送代碼：記成「其他」，說明就是補充（不讓還開著舊頁的審核員送不出去）。
 */
export function normalizeRejectReasons(input: { reasons: unknown; note: string; lengthInsufficient: boolean }): { reasons: string[]; legacy: boolean } {
  let legacy = false;
  let picked: string[];
  if (input.reasons === undefined || input.reasons === null) {
    if (!input.note.trim()) throw new HttpError(400, 'review_reasons_required');
    picked = ['other']; legacy = true;
  } else {
    if (!Array.isArray(input.reasons) || input.reasons.some((r) => !isReviewReason(r))) throw new HttpError(400, 'review_reason_invalid');
    picked = input.reasons as string[];
  }
  if (input.lengthInsufficient) picked = [...picked, 'content.min_length'];
  const set = new Set(picked);
  const reasons = REVIEW_REASONS.filter((c) => set.has(c));
  if (!reasons.length) throw new HttpError(400, 'review_reasons_required');
  if (set.has('other') && !input.note.trim()) throw new HttpError(400, 'review_other_needs_note');
  return { reasons, legacy };
}
