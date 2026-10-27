import { parseUpdateIntent, UPDATE_COOLDOWN_MS, type UpdateIntent } from '../shared/card-update';
import { HttpError } from './types';
import { bumpOp } from './ops-metrics';

export function updateIntent(input: { updateKind?: unknown; updateNote?: unknown }): UpdateIntent {
  try { return parseUpdateIntent(input); }
  catch (error) { throw new HttpError(400, (error as Error).message); }
}
export async function nextMajorUpdateAt(db: D1Database, work: string): Promise<number> {
  const row = await db.prepare("SELECT MAX(published_at) AS latest FROM card_update_events WHERE work_id=? AND state='published'").bind(work).first<{ latest: number | null }>();
  return row?.latest ? row.latest + UPDATE_COOLDOWN_MS : 0;
}
export async function assertUpdateCooldown(db: D1Database, work: string, now: number): Promise<void> {
  const next = await nextMajorUpdateAt(db, work);
  if (next > now) {
    await bumpOp(db, 'card_update', 'admission', 'cooldown');
    throw new HttpError(409, 'update_notification_cooldown', undefined, { nextMajorUpdateAt: next });
  }
}
/** Reserve durably before Provider commit. The publication trigger activates this exact version. */
export async function reserveUpdateNotification(db: D1Database, submission: string, now: number): Promise<void> {
  const v = await db.prepare('SELECT version_id,work_id,update_kind FROM hosting_versions WHERE submission_id=?').bind(submission).first<{ version_id: string; work_id: string; update_kind: string }>();
  if (!v || v.update_kind !== 'major') return;
  if (await db.prepare('SELECT 1 FROM card_update_events WHERE version_id=?').bind(v.version_id).first()) return;
  await assertUpdateCooldown(db, v.work_id, now);
  try {
    await db.prepare(`INSERT INTO card_update_events(version_id,work_id,state,reserved_at)
      SELECT version_id,work_id,'reserved',? FROM hosting_versions v
      WHERE version_id=? AND EXISTS(SELECT 1 FROM review_submissions s WHERE s.id=v.submission_id AND s.status='pending')
      AND NOT EXISTS(SELECT 1 FROM card_update_events WHERE version_id=v.version_id)`)
      .bind(now, v.version_id).run();
  } catch (error) {
    if (await db.prepare('SELECT 1 FROM card_update_events WHERE version_id=?').bind(v.version_id).first()) return;
    if (String(error).includes('update_notification_cooldown')) await assertUpdateCooldown(db, v.work_id, now);
    throw new HttpError(503, 'update_notification_pending');
  }
  if (!await db.prepare('SELECT 1 FROM card_update_events WHERE version_id=?').bind(v.version_id).first()) throw new HttpError(409, 'submission already decided');
}

/** Followed-work update recipients can qualify through either relationship. Other kinds retain their existing author filter. */
export const notificationRecipientEligible=(n='n')=>`(${n}.author_id IS NULL
 OR EXISTS(SELECT 1 FROM member_follows f WHERE f.member_id=${n}.member_id AND f.author_id=${n}.author_id)
 OR (${n}.kind='followed_work' AND json_extract(${n}.extra,'$.event')='update'
 AND EXISTS(SELECT 1 FROM member_favorites f WHERE f.member_id=${n}.member_id AND f.card_id=${n}.card_id)))`;

export async function sourceUpdateTimes(db:D1Database,sources:string[]):Promise<Map<string,number>> {
  if(!sources.length)return new Map();
  const rows=await db.prepare(`SELECT w.source_role_id AS source,MAX(e.published_at) AS latest
    FROM works w JOIN card_update_events e ON e.work_id=w.id AND e.state='published'
    WHERE w.source_provider='harbor' AND w.source_role_id IN(SELECT value FROM json_each(?)) GROUP BY w.source_role_id`)
    .bind(JSON.stringify(sources)).all<{source:string;latest:number}>();
  return new Map(rows.results.map(r=>[r.source,r.latest+UPDATE_COOLDOWN_MS]));
}
