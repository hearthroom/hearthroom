import { parseReviewReasons } from "../shared/review-reasons";
import { QUALITY_MIN_PLAYERS, QUALITY_TURNS } from "../shared/card-quality";
import type { SubmissionRow } from "./review";
import { HttpError } from "./types";

/** Human stamps on earlier, finalized cards. A reason can be a rejection or an approval suggestion. */
export async function reviewPrecedents(db: D1Database, target: SubmissionRow, before: number, reason: string | null, type: string | null) {
  const asOf = Math.min(before, target.submitted_at);
  type CaseRow = { decision: string; kind: string; decided_at: number; reasons: string | null; note: string | null };
  const forDecision = async (decision: "approved" | "rejected") => {
    const rows = await db.prepare(`SELECT ?1 AS decision, s.kind, s.decided_at,
        CASE WHEN ?1='approved' THEN s.approve_suggestions ELSE s.reject_reasons END AS reasons,
        st.note
      FROM review_submissions s
      LEFT JOIN review_corrections x ON x.submission_id=s.id AND x.state='complete'
      JOIN review_events e ON e.id=(SELECT h.id FROM review_events h WHERE h.submission_id=s.id
        AND h.actor_kind='reviewer' AND h.action=?6 AND h.at<=s.decided_at ORDER BY h.at DESC,h.id DESC LIMIT 1)
      LEFT JOIN review_stamps st ON st.submission_id=s.id AND st.member_id=e.actor_member_id AND st.verdict=e.action
      WHERE (CASE WHEN x.completed_at>=?3 THEN 'approved' ELSE s.status END)=?1
        AND s.card_id<>?2 AND s.decided_at<?3 AND s.reopen_of IS NULL
        AND NOT EXISTS (SELECT 1 FROM review_submissions f WHERE f.flip_of=s.id AND f.decided_at<?3 AND
          (f.status='approved' OR EXISTS(SELECT 1 FROM review_corrections fx WHERE fx.submission_id=f.id AND fx.state='complete')))
        AND (?4 IS NULL OR EXISTS (SELECT 1 FROM json_each(CASE WHEN ?1='approved' THEN s.approve_suggestions ELSE s.reject_reasons END) r WHERE r.value=?4))
        AND (?5 IS NULL OR EXISTS (SELECT 1 FROM hosting_versions v, json_each(v.public_role, '$.tags') tag
          WHERE v.card_id=s.card_id AND (v.submission_id=s.id OR v.hosted_revision_id=s.source_role_id) AND tag.value=?5))
      ORDER BY (COALESCE(st.note,'')<>'') DESC,s.decided_at DESC,s.id DESC LIMIT 3`)
      .bind(decision, target.card_id, asOf, reason, type, decision === "approved" ? "approve" : "reject").all<CaseRow>();
    return rows.results.map((r) => ({ decision: r.decision, kind: r.kind, decidedAt: r.decided_at,
      reasons: parseReviewReasons(r.reasons), note: r.note || null }));
  };
  const [approved, rejected] = await Promise.all([forDecision("approved"), forDecision("rejected")]);
  return { asOf, approved, rejected };
}

export async function reviewAuthorHistory(db: D1Database, target: SubmissionRow, before: number | null, now: number) {
  const author = await db.prepare(`SELECT member_id FROM hosting_versions
    WHERE submission_id=?1 OR (card_id=?2 AND hosted_revision_id=?3) ORDER BY (submission_id=?1) DESC LIMIT 1`)
    .bind(target.id, target.card_id, target.source_role_id).first<{ member_id: string }>();
  if (!author) throw new HttpError(404, "author_unknown");
  const live = target.status === "pending" && before === null;
  const asOf = live ? now : Math.min(target.submitted_at, before ?? target.submitted_at);
  type Decision = { decision: string; kind: string; decided_at: number; reject_reasons: string | null };
  type Published = { card_id: string | number; quality_chars: number | null; quality_players: number | null; quality_reached: number | null };
  // A flip moves the version's submission link. A correction preserves the original approval time.
  const history = `WITH history AS (
    SELECT s.id,v.version_id,s.card_id,s.kind,s.reject_reasons,
      CASE WHEN x.completed_at<?3 THEN x.completed_at ELSE s.decided_at END AS decided_at,
      CASE WHEN x.completed_at>=?3 THEN 'approved' ELSE s.status END AS decision
    FROM hosting_versions v JOIN review_submissions latest ON latest.id=v.submission_id
    JOIN review_submissions s ON s.id=CASE WHEN latest.flip_of IS NOT NULL AND (latest.decided_at IS NULL OR latest.decided_at>=?3)
      THEN latest.flip_of ELSE latest.id END
    LEFT JOIN review_corrections x ON x.submission_id=s.id AND x.state='complete'
    WHERE v.member_id=?1 AND s.card_id<>?2 AND s.decided_at<?3 AND s.reopen_of IS NULL
      AND s.status IN ('approved','rejected'))`;
  const [decisions, published] = await Promise.all([
    db.prepare(`${history} SELECT decision,kind,decided_at,reject_reasons FROM history ORDER BY decided_at DESC,id DESC LIMIT 12`)
      .bind(author.member_id, target.card_id, asOf).all<Decision>(),
    db.prepare(`${history}, versions AS (
      SELECT version_id,card_id,decided_at,ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY decided_at DESC,id DESC) AS position
      FROM history WHERE decision='approved')
      SELECT v.card_id,q.total_chars AS quality_chars,p.players AS quality_players,p.reached AS quality_reached
      FROM versions v LEFT JOIN card_quality_lengths q ON q.version_id=v.version_id
      LEFT JOIN cards c ON c.id=v.card_id
      LEFT JOIN card_quality_play p ON p.card_id=v.card_id AND ?4=1
      WHERE v.position=1 AND (?4=0 OR (c.status='approved' AND c.public_blocked=0 AND c.approved_version_id=v.version_id
        AND NOT EXISTS(SELECT 1 FROM moderation_blocked_versions b WHERE b.version_id=v.version_id)))
      ORDER BY v.decided_at DESC,v.card_id DESC LIMIT 12`).bind(author.member_id, target.card_id, asOf, live ? 1 : 0).all<Published>(),
  ]);
  return {
    asOf, continuationAsOf: live ? "current" : "unavailable_historical",
    decisions: decisions.results.map((r) => ({ decision: r.decision, kind: r.kind, decidedAt: r.decided_at,
      reasons: r.decision === "rejected" ? parseReviewReasons(r.reject_reasons) : [] })),
    published: published.results.map((r) => {
      // Reviewer evidence keeps the cohort counts and fractional rate.
      const players = r.quality_players, reached = r.quality_reached;
      const continuation = players !== null && players >= QUALITY_MIN_PLAYERS && reached !== null
        ? { players, reached, turns: QUALITY_TURNS, rate: reached / players }
        : null;
      return { cardId: String(r.card_id), characters: r.quality_chars, continuation };
    }),
  };
}
