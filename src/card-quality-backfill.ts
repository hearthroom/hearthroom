import { qualityLengthStatement } from './card-quality';
import { bumpOp } from './ops-metrics';
import { readSealedCardQuality } from './review-snapshot';
import type { Env } from './types';

const MINUTE = 60_000;
const PAGE_SIZE = 64;
const CALCULATION_LIMIT = 20;

type Candidate = { id: number; registered_at: number; version_id: string | null; revision_id: string | null; needs_length: number };

/** One bounded sweep in the scheduled Worker. Each continuation resumes at the last checked publication time and card number, newest first. */
export async function backfillCardQualityLengths(env: Env, now: number): Promise<void> {
  if (!env.HOSTING_SERVICE_KEY) return;
  const db = env.DB;
  const lease = crypto.randomUUID();
  const claim = await db.prepare(`UPDATE card_quality_length_scan SET lease=?,run_after=?
    WHERE singleton=1 AND run_after<=? RETURNING cursor_time,cursor_id`)
    .bind(lease, now + 4 * MINUTE, now).first<{ cursor_time: number; cursor_id: number }>();
  if (!claim) return;

  const started = Date.now();
  let cursorTime = claim.cursor_time;
  let cursorId = claim.cursor_id;
  let saved = 0;
  let failed = 0;
  let nextAt = now + MINUTE;
  try {
    const page = await db.prepare(`WITH page AS (
      SELECT id,registered_at,provider,status,public_blocked,approved_version_id AS version_id,approved_hosted_role_id AS revision_id
      FROM cards WHERE (registered_at,id)<(?,?) ORDER BY registered_at DESC,id DESC LIMIT ?
    ) SELECT page.id,page.registered_at,page.version_id,page.revision_id,
      (page.provider='harbor' AND page.status='approved' AND page.public_blocked=0
      AND v.hosted_revision_id=page.revision_id AND q.version_id IS NULL) AS needs_length
    FROM page LEFT JOIN hosting_versions v ON v.version_id=page.version_id
    LEFT JOIN card_quality_lengths q ON q.version_id=page.version_id ORDER BY page.registered_at DESC,page.id DESC`)
      .bind(cursorTime, cursorId, PAGE_SIZE).all<Candidate>();
    let attempted = 0;
    for (const row of page.results) {
      if (row.needs_length && row.version_id && row.revision_id) {
        if (attempted >= CALCULATION_LIMIT || Date.now() - started > 25_000) break;
        attempted++;
        const length = await readSealedCardQuality(env, row.revision_id).catch(() => null);
        if (length) {
          const result = await qualityLengthStatement(db, row.version_id, length).run();
          saved += result.meta.changes;
        } else {
          // Retry during the next sweep. A missing or unreadable revision must not block newer snapshots.
          failed++;
        }
      }
      cursorTime = row.registered_at;
      cursorId = row.id;
    }
    if (cursorId === (page.results.at(-1)?.id ?? cursorId) && page.results.length < PAGE_SIZE) {
      cursorTime = Number.MAX_SAFE_INTEGER;
      cursorId = 0;
      nextAt = now + 3_600_000;
    }
  } catch {
    failed++;
  } finally {
    await db.prepare(`UPDATE card_quality_length_scan SET cursor_time=?,cursor_id=?,lease='',run_after=? WHERE singleton=1 AND lease=?`)
      .bind(cursorTime, cursorId, nextAt, lease).run();
    await Promise.all([
      saved ? bumpOp(db, 'card_quality_length', 'backfill', 'success', saved) : undefined,
      failed ? bumpOp(db, 'card_quality_length', 'backfill', 'error', failed) : undefined,
      saved || failed ? bumpOp(db, 'card_quality_length_ms', 'backfill', 'elapsed', Date.now() - started) : undefined,
    ]);
  }
}
