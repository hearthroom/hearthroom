import { listCardIds, type ListOptions } from './cards';
import { qualityLengthStatement } from './card-quality';
import { bumpOp } from './ops-metrics';
import { RANK_DURATION } from './rank-settlement';
import { readSealedCardQuality } from './review-snapshot';
import { HttpError, type Env } from './types';
import { filterPublicRows } from './work-read';

const MINUTE = 60_000;
const PAGE_SIZE = 64;
const CALCULATION_LIMIT = 10;
const BOARD_SIZE = 30;
const BOARD_CANDIDATE_LIMIT = 2 * BOARD_SIZE;
const ZONES = ['zh', 'en', 'ja', 'ko'] as const;
const PRIORITY_BOARDS = [
  ...ZONES.flatMap(zone => (['week', 'month'] as const).map(window => ({ zone, window }))),
  ...ZONES.flatMap(zone => (['new', 'day'] as const).map(window => ({ zone, window }))),
];

type Candidate = { id: number; registered_at: number; version_id: string | null; revision_id: string | null; needs_length: number };
type PriorityCandidate = Candidate & { retried: number };

async function visibleBoardIds(env: Env, options: ListOptions): Promise<string[]> {
  const { rows } = await listCardIds(env.DB, options);
  const ids = rows.map(row => String(row.id));
  const result = await env.DB.prepare(`SELECT CAST(c.id AS TEXT) AS id,c.provider,c.author_num_id,c.source_role_id,
    c.status,c.board_hidden,c.public_blocked,c.approved_hosted_role_id FROM cards c
    JOIN json_each(?) wanted ON c.id=wanted.value
    WHERE c.status='approved' AND c.public_blocked=0 AND c.board_hidden=0 AND c.rating IS NOT 'R'
    ORDER BY CAST(wanted.key AS INTEGER)`).bind(JSON.stringify(ids))
    .all<Parameters<typeof filterPublicRows>[1][number]>();
  const visible = await filterPublicRows(env, result.results, 'list');
  return visible.rows.slice(0, BOARD_SIZE).map(row => row.id);
}

/** Warm one public board at a time, then continue the general sweep newest first. */
export async function backfillCardQualityLengths(env: Env, now: number): Promise<void> {
  if (!env.HOSTING_SERVICE_KEY) return;
  const db = env.DB;
  const lease = crypto.randomUUID();
  const claim = await db.prepare(`UPDATE card_quality_length_scan SET lease=?,run_after=?
    WHERE singleton=1 AND run_after<=? RETURNING cursor_time,cursor_id,priority_board,priority_ids`)
    .bind(lease, now + 4 * MINUTE, now).first<{
      cursor_time: number; cursor_id: number; priority_board: number; priority_ids: string;
    }>();
  if (!claim) return;

  const started = Date.now();
  let cursorTime = claim.cursor_time;
  let cursorId = claim.cursor_id;
  let priorityBoard = claim.priority_board;
  let priorityIds = claim.priority_ids;
  let saved = 0;
  let failed = 0;
  let nextAt = now + MINUTE;
  let attempted = 0;
  const atLimit = () => attempted >= CALCULATION_LIMIT || Date.now() - started > 25_000;
  const calculate = async ({ version_id, revision_id }: Candidate): Promise<boolean> => {
    if (!version_id || !revision_id) return false;
    attempted++;
    let length;
    try {
      length = await readSealedCardQuality(env, revision_id);
    } catch (err) {
      failed++;
      return !(err instanceof HttpError) || err.status >= 500 || err.status === 429;
    }
    const result = await qualityLengthStatement(db, version_id, length).run();
    saved += result.meta.changes;
    return false;
  };
  try {
    const board = PRIORITY_BOARDS[priorityBoard];
    if (board) {
      if (priorityIds === '[]') {
        const ids = await visibleBoardIds(env, {
          ...(board.window === 'new'
            ? { sort: 'new' }
            : { sort: 'hot', since: now - RANK_DURATION[board.window], boardWindow: board.window }),
          zone: board.zone,
          limit: BOARD_CANDIDATE_LIMIT, offset: 0, skipCount: true,
        });
        priorityIds = JSON.stringify(ids.map(id => ({ id })));
      }
      // Retain this page across cron ticks so changing ranks cannot skip a queued card.
      const page = await db.prepare(`SELECT c.id,c.registered_at,v.version_id,v.hosted_revision_id AS revision_id,1 AS needs_length,
        COALESCE(json_extract(wanted.value,'$.retried'),0) AS retried
        FROM json_each(?) wanted JOIN cards c ON c.id=json_extract(wanted.value,'$.id')
        JOIN hosting_versions v ON v.version_id=c.approved_version_id AND v.hosted_revision_id=c.approved_hosted_role_id
        LEFT JOIN card_quality_lengths q ON q.version_id=v.version_id
        WHERE c.provider='harbor' AND c.status='approved' AND c.public_blocked=0 AND q.version_id IS NULL
        ORDER BY CAST(wanted.key AS INTEGER)`).bind(priorityIds).all<PriorityCandidate>();
      let visited = 0;
      const retry: { id: number; retried: number }[] = [];
      for (const row of page.results) {
        if (atLimit()) break;
        if (await calculate(row) && !row.retried) retry.push({ id: row.id, retried: 1 });
        visited++;
      }
      const pending = page.results.slice(visited).map(({ id, retried }) => ({ id, retried })).concat(retry);
      priorityIds = JSON.stringify(pending);
      if (!pending.length) priorityBoard++;
      return;
    }
    const page = await db.prepare(`WITH page AS (
      SELECT id,registered_at,provider,status,public_blocked,approved_version_id AS version_id,approved_hosted_role_id AS revision_id
      FROM cards WHERE (registered_at,id)<(?,?) ORDER BY registered_at DESC,id DESC LIMIT ?
    ) SELECT page.id,page.registered_at,page.version_id,page.revision_id,
      (page.provider='harbor' AND page.status='approved' AND page.public_blocked=0
      AND v.hosted_revision_id=page.revision_id AND q.version_id IS NULL) AS needs_length
    FROM page LEFT JOIN hosting_versions v ON v.version_id=page.version_id
    LEFT JOIN card_quality_lengths q ON q.version_id=page.version_id ORDER BY page.registered_at DESC,page.id DESC`)
      .bind(cursorTime, cursorId, PAGE_SIZE).all<Candidate>();
    for (const row of page.results) {
      if (row.needs_length && row.version_id && row.revision_id) {
        if (atLimit()) break;
        // Retry unavailable sealed revisions during the next general sweep.
        await calculate(row);
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
    await db.prepare(`UPDATE card_quality_length_scan SET cursor_time=?,cursor_id=?,priority_board=?,priority_ids=?,lease='',run_after=?
      WHERE singleton=1 AND lease=?`).bind(cursorTime, cursorId, priorityBoard, priorityIds, nextAt, lease).run();
    await Promise.all([
      saved ? bumpOp(db, 'card_quality_length', 'backfill', 'success', saved) : undefined,
      failed ? bumpOp(db, 'card_quality_length', 'backfill', 'error', failed) : undefined,
      saved || failed ? bumpOp(db, 'card_quality_length_ms', 'backfill', 'elapsed', Date.now() - started) : undefined,
    ]);
  }
}
