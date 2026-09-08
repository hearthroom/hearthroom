import { HttpError, type Localized, pickLocale } from "./types";

/**
 * 社群審核：審核單、共享佇列、蓋章。
 *
 * 規則（owner 2026-09-07）：
 *   - 共享佇列，不派工：審核人自己領（claim），領了就是「我正在看」。逾時（CLAIM_TTL_MS）
 *     自動視為放回——沒有排程，讀取與動作時懶惰判定。
 *   - 初審兩章、重審一章；蓋章的人要不同；任何一個駁回即駁回。
 *   - 盲審：佇列與詳情都不帶作者身分。卡片名稱與封面會露出，那是內容本身，擋不了。
 *   - 過審綁內容版本：approved 時把提交當下的雜湊寫進 cards.reviewed_hash；同步時發現
 *     主站雜湊變了就開重審單、卡片離榜。
 */
export const CLAIM_TTL_MS = 45 * 60 * 1000;
export const STAMPS_REQUIRED: Record<SubmissionKind, number> = { first: 2, re: 1 };

export type SubmissionKind = "first" | "re";
export type SubmissionStatus = "pending" | "approved" | "rejected";
export type CardStatus = "pending" | "approved" | "rejected" | "needs_review" | "unshared";

export interface SubmissionRow {
  id: string;
  card_id: string;
  provider: string;
  source_role_id: string;
  kind: SubmissionKind;
  status: SubmissionStatus;
  content_hash: string;
  submitted_at: number;
  claimed_by: string | null;
  claimed_at: number | null;
  decided_at: number | null;
  note: string;
  /** 作者提交這一版時宣告的分級：1＝成人內容。審核人對照內容，不符就駁回。 */
  nsfw: number;
}

/** 這張卡有沒有還在排隊的單；有就回它（提交是冪等的）。 */
export async function pendingSubmissionOf(db: D1Database, cardId: string): Promise<SubmissionRow | null> {
  return await db
    .prepare("SELECT * FROM review_submissions WHERE card_id = ? AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1")
    .bind(cardId)
    .first<SubmissionRow>();
}

export async function createSubmission(
  db: D1Database,
  input: { cardId: string; provider: string; roleId: string; kind: SubmissionKind; contentHash: string; now: number; nsfw: boolean },
): Promise<SubmissionRow> {
  const existing = await pendingSubmissionOf(db, input.cardId);
  if (existing) {
    // 還在排隊就再送一次、只是改了宣告：單子照舊，宣告跟著最新的走——審核人看到的要是作者現在說的
    if ((existing.nsfw === 1) !== input.nsfw) {
      await db.prepare("UPDATE review_submissions SET nsfw = ? WHERE id = ?").bind(input.nsfw ? 1 : 0, existing.id).run();
      existing.nsfw = input.nsfw ? 1 : 0;
    }
    return existing;
  }
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO review_submissions (id, card_id, provider, source_role_id, kind, status, content_hash, submitted_at, nsfw)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(id, input.cardId, input.provider, input.roleId, input.kind, input.contentHash, input.now, input.nsfw ? 1 : 0)
    .run();
  return (await db.prepare("SELECT * FROM review_submissions WHERE id = ?").bind(id).first<SubmissionRow>())!;
}

const claimIsLive = (row: { claimed_by: string | null; claimed_at: number | null }, now: number) =>
  !!row.claimed_by && row.claimed_at !== null && now - row.claimed_at < CLAIM_TTL_MS;

export interface QueueItem {
  id: string;
  kind: SubmissionKind;
  submittedAt: number;
  card: { id: string; roleId: string; name: string; summary: string; avatarUrl: string | null; zone: string; tags: string[] };
  stamps: { approve: number; required: number };
  /** 作者宣告：成人內容 */
  nsfw: boolean;
  /** free＝沒人在看；mine＝我領的；other＝別人領著（還沒逾時） */
  claim: "free" | "mine" | "other";
  /** 我已經蓋過章：不能再領、也不能再蓋 */
  stampedByMe: boolean;
}

/** 佇列：所有待審的單，最舊的在前。不帶作者。 */
export async function listQueue(db: D1Database, memberId: string, now: number, lang: string): Promise<QueueItem[]> {
  const rows = await db
    .prepare(
      `SELECT s.id, s.kind, s.submitted_at, s.claimed_by, s.claimed_at, s.nsfw,
              c.id AS card_id, c.source_role_id, c.names, c.summaries, c.avatar_url, c.zone, c.tags,
              (SELECT COUNT(*) FROM review_stamps st WHERE st.submission_id = s.id AND st.verdict = 'approve') AS approvals,
              (SELECT COUNT(*) FROM review_stamps st WHERE st.submission_id = s.id AND st.member_id = ?) AS mine
       FROM review_submissions s JOIN cards c ON c.id = s.card_id
       WHERE s.status = 'pending' ORDER BY s.submitted_at ASC LIMIT 200`,
    )
    .bind(memberId)
    .all<{
      id: string; kind: SubmissionKind; submitted_at: number; claimed_by: string | null; claimed_at: number | null;
      card_id: string; source_role_id: string; names: string; summaries: string; avatar_url: string | null; zone: string; tags: string;
      approvals: number; mine: number; nsfw: number;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    kind: r.kind,
    submittedAt: r.submitted_at,
    card: {
      id: r.card_id,
      roleId: r.source_role_id,
      name: pickLocale(JSON.parse(r.names) as Localized, lang),
      summary: pickLocale(JSON.parse(r.summaries) as Localized, lang),
      avatarUrl: r.avatar_url,
      zone: r.zone,
      tags: JSON.parse(r.tags) as string[],
    },
    stamps: { approve: r.approvals, required: STAMPS_REQUIRED[r.kind] },
    nsfw: r.nsfw === 1,
    claim: claimIsLive(r, now) ? (r.claimed_by === memberId ? "mine" : "other") : "free",
    stampedByMe: r.mine > 0,
  }));
}

export async function getSubmission(db: D1Database, id: string): Promise<SubmissionRow> {
  const row = await db.prepare("SELECT * FROM review_submissions WHERE id = ?").bind(id).first<SubmissionRow>();
  if (!row) throw new HttpError(404, "submission not found");
  return row;
}

async function hasStamped(db: D1Database, submissionId: string, memberId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM review_stamps WHERE submission_id = ? AND member_id = ?")
    .bind(submissionId, memberId)
    .first<{ ok: number }>();
  return !!row;
}

/** 領取。別人領著且沒逾時 → 409；自己蓋過章的不能再領。 */
export async function claim(db: D1Database, submissionId: string, memberId: string, now: number): Promise<SubmissionRow> {
  const row = await getSubmission(db, submissionId);
  if (row.status !== "pending") throw new HttpError(409, "submission already decided");
  if (await hasStamped(db, submissionId, memberId)) throw new HttpError(409, "you already reviewed this submission");
  if (claimIsLive(row, now) && row.claimed_by !== memberId) throw new HttpError(409, "claimed by another reviewer");
  await db
    .prepare("UPDATE review_submissions SET claimed_by = ?, claimed_at = ? WHERE id = ?")
    .bind(memberId, now, submissionId)
    .run();
  return getSubmission(db, submissionId);
}

/** 放回。只有領的人能放；不是自己領的當成功（冪等）。 */
export async function release(db: D1Database, submissionId: string, memberId: string): Promise<void> {
  await db
    .prepare("UPDATE review_submissions SET claimed_by = NULL, claimed_at = NULL WHERE id = ? AND claimed_by = ?")
    .bind(submissionId, memberId)
    .run();
}

export interface StampResult {
  submission: SubmissionRow;
  cardStatus: CardStatus;
  approvals: number;
  required: number;
}

/**
 * 蓋章。要先領著（沒逾時）才能蓋：蓋章是「我看完了」，沒領就沒看。
 * 通過章數夠了就上榜並把內容版本綁上；任一駁回即駁回。蓋完章就放回，讓下一個人領。
 */
export async function stamp(
  db: D1Database,
  input: { submissionId: string; memberId: string; verdict: "approve" | "reject"; note: string; now: number },
): Promise<StampResult> {
  const row = await getSubmission(db, input.submissionId);
  if (row.status !== "pending") throw new HttpError(409, "submission already decided");
  if (!claimIsLive(row, input.now) || row.claimed_by !== input.memberId) throw new HttpError(409, "claim this submission first");
  if (await hasStamped(db, input.submissionId, input.memberId)) throw new HttpError(409, "you already reviewed this submission");
  const note = input.note.trim().slice(0, 2000);

  const required = STAMPS_REQUIRED[row.kind];
  const writes: D1PreparedStatement[] = [
    db
      .prepare("INSERT INTO review_stamps (submission_id, member_id, verdict, note, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(row.id, input.memberId, input.verdict, note, input.now),
    db.prepare("UPDATE review_submissions SET claimed_by = NULL, claimed_at = NULL WHERE id = ?").bind(row.id),
  ];

  const prior = await db
    .prepare("SELECT COUNT(*) AS n FROM review_stamps WHERE submission_id = ? AND verdict = 'approve'")
    .bind(row.id)
    .first<{ n: number }>();
  const approvals = (prior?.n ?? 0) + (input.verdict === "approve" ? 1 : 0);

  let cardStatus: CardStatus = row.kind === "first" ? "pending" : "needs_review";
  if (input.verdict === "reject") {
    cardStatus = "rejected";
    writes.push(
      db.prepare("UPDATE review_submissions SET status = 'rejected', decided_at = ?, note = ? WHERE id = ?").bind(input.now, note, row.id),
      db.prepare("UPDATE cards SET status = 'rejected' WHERE id = ?").bind(row.card_id),
    );
  } else if (approvals >= required) {
    cardStatus = "approved";
    writes.push(
      db.prepare("UPDATE review_submissions SET status = 'approved', decided_at = ? WHERE id = ?").bind(input.now, row.id),
      db.prepare("UPDATE cards SET status = 'approved', reviewed_hash = ? WHERE id = ?").bind(row.content_hash, row.card_id),
    );
  }
  await db.batch(writes);
  return { submission: await getSubmission(db, row.id), cardStatus, approvals, required };
}

/** 作者這幾張卡的審核狀態與最近一次駁回說明（給「我的卡片」）。 */
export async function statusAmong(
  db: D1Database,
  roleIds: string[],
): Promise<Map<string, { status: CardStatus; note: string; nsfw: boolean }>> {
  const out = new Map<string, { status: CardStatus; note: string; nsfw: boolean }>();
  if (!roleIds.length) return out;
  const holes = roleIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT c.source_role_id, c.status, c.nsfw,
              (SELECT note FROM review_submissions s WHERE s.card_id = c.id AND s.status = 'rejected'
               ORDER BY s.decided_at DESC LIMIT 1) AS note
       FROM cards c WHERE c.source_role_id IN (${holes})`,
    )
    .bind(...roleIds)
    .all<{ source_role_id: string; status: CardStatus; note: string | null; nsfw: number }>();
  for (const r of rows.results) out.set(r.source_role_id, { status: r.status, note: r.note ?? "", nsfw: r.nsfw === 1 });
  return out;
}

/** 同步時發現內容變了：卡片離榜、開一張重審單。已經有待審單就不重複開。 */
export function needsReviewStatements(
  db: D1Database,
  input: { cardId: string; provider: string; roleId: string; contentHash: string; now: number },
): D1PreparedStatement[] {
  return [
    db.prepare("UPDATE cards SET status = 'needs_review' WHERE id = ? AND status = 'approved'").bind(input.cardId),
    db
      .prepare(
        `INSERT INTO review_submissions (id, card_id, provider, source_role_id, kind, status, content_hash, submitted_at)
         SELECT ?, ?, ?, ?, 're', 'pending', ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM review_submissions WHERE card_id = ? AND status = 'pending')`,
      )
      .bind(crypto.randomUUID(), input.cardId, input.provider, input.roleId, input.contentHash, input.now, input.cardId),
  ];
}
