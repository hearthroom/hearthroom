import { applyBatchMarks, authorProfiles, deviceSignals } from "./review-profile";
import { authorSignals, aiCardInput } from "./review-ai";
import { originalityReport, similarityToCards } from "./originality";
import { agentAuthorCards } from "./review-author";
import { parseReviewReasons } from "../shared/review-reasons";
import type { SubmissionRow } from "./review";
import type { ProviderId } from "./providers";
import { upstream } from "./upstream";
import { HttpError, type Env } from "./types";

/**
 * 審卡員讀得到審核頁上的證據（任務 2026-11-23-ai-card-review，owner 2026-11-24：人看得到的 AI 也要看得到）：
 * 完整查重（含重疊原文）、作者側寫、作者的其他卡（含同作者模板重複率）、上架版內容、審卡員自己的作者筆記。
 *
 * 雙盲照舊：AI 讀到的東西不能透露這張單的人工決定。所以
 *   - 作者側寫的數字一律算到某個時間點：待審＝現在，已定案＝送審那一刻（跟 authorSignals 一樣），不含這張單之後的事；
 *     分級、疑似批量與審核員的作者標記只給待審單（它們是「現在」的狀態，會含這張單自己的結果）。
 *   - 作者的其他卡不含這張卡本身（它的狀態就是人工決定）。
 *   - 不回成員 ID、Harbor 數字帳號、@代號、裝置雜湊、審核員身分；只回數量與卡號。
 * 已知的缺口：上架版內容（/v1/review-ai/cards/:cardId）沒有「是哪張單在問」的脈絡，試跑單拿自己的卡號去問就看得出結果。
 * 說明文字引導審卡員只拿它看作者的其他卡；試跑報表的人機對照要記得這一點。
 */

const DAY = 86_400_000;
/** 查重回應裡重疊原文的總字數上限：各來源平分 */
export const OVERLAP_BUDGET = 4_000;
export const AUTHOR_NOTE_MAX = 2_000;

/** 這張單的作者（本站成員）。舊流程沒有託管版本的單沒有作者可查。 */
async function authorOf(db: D1Database, submissionId: string) {
  const v = await db.prepare("SELECT member_id, source_role_id FROM hosting_versions WHERE submission_id=?").bind(submissionId).first<{ member_id: string; source_role_id: string }>();
  if (!v) throw new HttpError(404, "author_unknown");
  return v;
}

/** 完整查重：跟審核頁同一份計算（作者自己的卡不算），每個來源附這張卡設定裡跟它重疊的原文。 */
export async function agentOriginality(db: D1Database, s: SubmissionRow, detail: Record<string, any>) {
  const report = await originalityReport(db, s, detail, "zh-Hant");
  if (!report.available) return report;
  const setting = String(detail.document?.roleDetailDesc ?? "");
  const share = report.sources.length ? Math.floor(OVERLAP_BUDGET / report.sources.length) : 0;
  return {
    available: true as const,
    similarity: report.similarity,
    units: report.units,
    comparedCards: report.comparedCards,
    sources: report.sources.map((src) => {
      const pieces = src.segments.map(([a, b]) => setting.slice(a, b));
      const total = pieces.reduce((n, p) => n + p.length, 0);
      const overlap: string[] = [];
      let left = share;
      for (const p of pieces) {
        if (left <= 0) break;
        overlap.push(p.slice(0, left));
        left -= p.length;
      }
      return {
        cardId: src.cardId, name: src.name, status: src.status, earlier: src.earlier, firstSeenAt: src.firstSeenAt,
        similarity: src.similarity, overlapChars: total, overlap, clipped: total > share,
      };
    }),
  };
}

/** 作者側寫：數字算到 asOf（待審＝現在，已定案＝送審那一刻）；分級、批量與標記只給待審單。 */
export async function agentAuthorProfile(db: D1Database, s: SubmissionRow, now: number) {
  const v = await authorOf(db, s.id);
  const pending = s.status === "pending";
  const asOf = pending ? now : s.submitted_at;
  const [signals, prior, subs, note] = await Promise.all([
    authorSignals(db, v.member_id, v.source_role_id, asOf),
    db.prepare(`SELECT s2.status, s2.reject_reasons FROM review_submissions s2 JOIN hosting_versions v2 ON v2.submission_id=s2.id
      WHERE v2.member_id=? AND s2.id<>? AND s2.reopen_of IS NULL AND s2.status IN ('approved','rejected') AND s2.decided_at<?`)
      .bind(v.member_id, s.id, asOf).all<{ status: string; reject_reasons: string | null }>(),
    // 新卡＝送審時這張卡還沒上架過；更新＝已上架卡的新版本。含這張單自己
    db.prepare(`SELECT s2.submitted_at AS at,
        EXISTS (SELECT 1 FROM review_submissions p0 WHERE p0.card_id=s2.card_id AND p0.id<>s2.id AND p0.status='approved' AND p0.decided_at<s2.submitted_at) AS live
      FROM review_submissions s2 JOIN hosting_versions v2 ON v2.submission_id=s2.id
      WHERE v2.member_id=? AND s2.reopen_of IS NULL AND s2.submitted_at>? AND s2.submitted_at<=?`)
      .bind(v.member_id, asOf - 30 * DAY, asOf).all<{ at: number; live: number }>(),
    readAuthorNote(db, v.member_id),
  ]);
  const rejectReasons: Record<string, number> = {};
  for (const r of prior.results) if (r.status === "rejected") for (const code of parseReviewReasons(r.reject_reasons)) rejectReasons[code] = (rejectReasons[code] ?? 0) + 1;
  const split = (from: number) => {
    const rows = subs.results.filter((r) => r.at > from);
    return { newCard: rows.filter((r) => !r.live).length, update: rows.filter((r) => r.live).length };
  };
  let tier: string | null = null, batchSuspected: boolean | null = null;
  let marks: { kind: string; value: string; reason: string; note: string; at: number; expiresAt: number }[] = [];
  if (pending) {
    const profiles = await authorProfiles(db, [v.member_id], now);
    await applyBatchMarks(db, profiles, now);
    const p = profiles.get(v.member_id);
    if (p) {
      const device = await db.prepare("SELECT device_hash FROM review_submission_devices WHERE submission_id=?").bind(s.id).first<{ device_hash: string }>();
      const signal = device ? (await deviceSignals(db, [device.device_hash], now)).get(device.device_hash) : undefined;
      tier = p.tier;
      batchSuspected = p.manual.batch ? p.batchSuspected : !!signal?.suspected;
    }
    // 每一類只取最新、還有效的那一筆（就是審核頁現在套用的那一筆）；不帶審核員是誰
    const rows = await db.prepare(`SELECT kind, value, reason_code, note, created_at, expires_at FROM review_author_marks m
      WHERE author_member_id=? AND revoked_at IS NULL AND expires_at>?
      AND created_at=(SELECT MAX(created_at) FROM review_author_marks x WHERE x.author_member_id=m.author_member_id AND x.kind=m.kind AND x.revoked_at IS NULL)
      ORDER BY kind`).bind(v.member_id, now).all<{ kind: string; value: string; reason_code: string; note: string; created_at: number; expires_at: number }>();
    marks = rows.results.map((r) => ({ kind: r.kind, value: r.value, reason: r.reason_code, note: r.note, at: r.created_at, expiresAt: r.expires_at }));
  }
  return {
    asOf,
    accountAgeDays: signals.accountAgeDays,
    prior: {
      approved: prior.results.filter((r) => r.status === "approved").length,
      rejected: prior.results.filter((r) => r.status === "rejected").length,
      rejectReasons,
    },
    submissions: { last7d: split(asOf - 7 * DAY), last30d: split(asOf - 30 * DAY), newCardLast24h: split(asOf - DAY).newCard },
    deviceAccounts: signals.deviceAccounts,
    tier, batchSuspected, marks,
    authorNote: note.updatedAt === null ? null : note,
  };
}

/** 作者的其他卡，附這張單的設定跟每張卡的重複率（同作者也算，抓「一個模板改名重送」） */
export async function agentAuthorCardList(db: D1Database, s: SubmissionRow, detail: Record<string, any> | null) {
  const list = await agentAuthorCards(db, s.card_id);
  if (!list) throw new HttpError(404, "card not found");
  const sim = await similarityToCards(db, s.id, detail, list.items.map((i) => i.cardId));
  return {
    total: list.total,
    similarityAvailable: sim !== null,
    items: list.items.map((i) => ({ ...i, settingSimilarity: sim?.get(i.cardId) ?? null })),
  };
}

/** 一張卡目前上架的那一版（站方擋下公開、或那一版被擋的不算上架）。內容跟讀卡同一個形狀。 */
export async function agentLiveCard(env: Env, cardId: string) {
  const row = await env.DB.prepare(`SELECT c.id, c.status, c.public_blocked, v.hosted_revision_id, v.provider,
      json_extract(v.public_role,'$.tags') AS tags, json_extract(v.public_role,'$.fandom') AS fandom,
      EXISTS (SELECT 1 FROM moderation_blocked_versions b WHERE b.version_id=v.version_id) AS version_blocked
    FROM cards c LEFT JOIN hosting_versions v ON v.version_id=c.approved_version_id WHERE c.id=?`)
    .bind(cardId).first<{ id: string | number; status: string; public_blocked: number; hosted_revision_id: string | null; provider: string | null; tags: string | null; fandom: string | null; version_blocked: number }>();
  if (!row) throw new HttpError(404, "card_not_found");
  if (row.status !== "approved" || row.public_blocked || row.version_blocked) throw new HttpError(404, "card_not_live");
  if (!row.hosted_revision_id) throw new HttpError(404, "content_unavailable");
  let settings: Record<string, unknown>;
  try {
    settings = await upstream.readSealedForReview(env, row.hosted_revision_id, (row.provider ?? "harbor") as ProviderId);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throw new HttpError(404, "content_unavailable");
    throw error;
  }
  let tags: string[] = [];
  try { tags = row.tags ? (JSON.parse(row.tags) as string[]) : []; } catch { tags = []; }
  return { cardId: String(row.id), ...aiCardInput(settings, { tags, fandom: row.fandom ?? "" }, { applyRules: true }) };
}

async function readAuthorNote(db: D1Database, authorMemberId: string): Promise<{ note: string; updatedAt: number | null }> {
  const row = await db.prepare("SELECT note, updated_at FROM review_ai_author_notes WHERE author_member_id=?").bind(authorMemberId).first<{ note: string; updated_at: number }>();
  return row ? { note: row.note, updatedAt: row.updated_at } : { note: "", updatedAt: null };
}

export async function getAuthorNote(db: D1Database, submissionId: string) {
  return readAuthorNote(db, (await authorOf(db, submissionId)).member_id);
}

/** 覆蓋寫入；空字串（去掉前後空白後）＝刪掉 */
export async function putAuthorNote(db: D1Database, submissionId: string, input: unknown, agentId: string, now: number) {
  if (typeof input !== "string" || input.length > AUTHOR_NOTE_MAX) {
    throw new HttpError(400, "invalid_arguments", undefined, { field: "note", hint: `note must be text of at most ${AUTHOR_NOTE_MAX} characters; send an empty note to delete it.` });
  }
  const { member_id } = await authorOf(db, submissionId);
  const note = input.trim();
  if (!note) {
    await db.prepare("DELETE FROM review_ai_author_notes WHERE author_member_id=?").bind(member_id).run();
    return { note: "", updatedAt: null };
  }
  await db.prepare(`INSERT INTO review_ai_author_notes (author_member_id, note, agent_member_id, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(author_member_id) DO UPDATE SET note=excluded.note, agent_member_id=excluded.agent_member_id, updated_at=excluded.updated_at`)
    .bind(member_id, note, agentId, now).run();
  return { note, updatedAt: now };
}
