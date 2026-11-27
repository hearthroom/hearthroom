import { bumpOp } from './ops-metrics';
import { HttpError } from './types';

export interface CoverFlags {
  cover_author_sensitive?: number | null;
  cover_review_sensitive?: number | null;
  cover_review_url?: string | null;
}

export function effectiveCover(flags: CoverFlags, cover: string | null | undefined) {
  return !!cover && (flags.cover_author_sensitive === 1 || flags.cover_review_sensitive === 1);
}

export function coverState(flags: CoverFlags, cover: string | null | undefined) {
  return {
    coverAuthorSensitive: flags.cover_author_sensitive === 1,
    coverReviewSensitive: flags.cover_review_sensitive === 1,
    coverSensitive: effectiveCover(flags, cover),
    coverChanged: !!cover && flags.cover_review_sensitive === 1 && !!flags.cover_review_url && flags.cover_review_url !== cover,
  };
}

export async function readCoverFlags(db: D1Database, cardId: string | number) {
  return (await db.prepare('SELECT cover_author_sensitive,cover_review_sensitive,cover_review_url FROM card_numbers WHERE num=?')
    .bind(cardId).first<CoverFlags>()) ?? {};
}

export async function saveAuthorCover(db: D1Database, cardId: number, sensitive: boolean) {
  const next = Number(sensitive);
  const changed = await db.prepare('UPDATE card_numbers SET cover_author_sensitive=?1 WHERE num=?2 AND cover_author_sensitive<>?1')
    .bind(next,cardId).run();
  if (changed.meta.changes) await bumpOp(db,'cover_sensitive','author',sensitive ? 'set' : 'clear');
}

export async function saveReviewerCover(db: D1Database, cardId: string, actor: string, cover: string | null, body: unknown) {
  const input = body && typeof body === "object" ? body as Record<string,unknown> : {};
  const { sensitive, operationId } = input;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (typeof sensitive !== 'boolean' || typeof operationId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(operationId) || !reason || reason.length > 500) {
    throw new HttpError(400,'cover_mark_invalid');
  }
  if (sensitive && !cover) throw new HttpError(409,'cover_mark_missing');
  const id = crypto.randomUUID();
  const now = Date.now();
  const next = Number(sensitive);
  const tx = await db.batch([
    db.prepare(`INSERT INTO audit_log(id,subject_kind,subject_id,actor_member_id,actor_kind,action,reason,before_json,after_json,operation_id,created_at)
      SELECT ?,'card',CAST(num AS TEXT),?,'human','cover_mark',?,json_object('sensitive',cover_review_sensitive),json_object('sensitive',?),?,?
      FROM card_numbers WHERE num=? AND cover_review_sensitive<>?
      ON CONFLICT(actor_member_id,operation_id) DO NOTHING`)
      .bind(id,actor,reason,next,operationId,now,cardId,next),
    db.prepare(`INSERT INTO moderation_events(id,provider,source_role_id,actor,action,reason,before_value,after_value,created_at,operation_id)
      SELECT ?,provider,source_role_id,?,'cover_mark',?,CAST(cover_review_sensitive AS TEXT),?,?,?
      FROM card_numbers WHERE num=? AND EXISTS (SELECT 1 FROM audit_log WHERE id=?)`)
      .bind(id,actor,reason,String(next),now,operationId,cardId,id),
    db.prepare(`UPDATE card_numbers SET cover_review_sensitive=?,cover_review_url=?
      WHERE num=? AND EXISTS (SELECT 1 FROM audit_log WHERE id=?)`)
      .bind(next,sensitive ? cover : null,cardId,id),
  ]);
  if (tx[0].meta.changes) {
    await bumpOp(db,'cover_sensitive','review',sensitive ? 'set' : 'clear');
  } else {
    const previous = await db.prepare(`SELECT subject_kind,subject_id,action,reason,json_extract(after_json,'$.sensitive') AS sensitive
      FROM audit_log WHERE actor_member_id=? AND operation_id=?`).bind(actor,operationId)
      .first<{subject_kind:string;subject_id:string;action:string;reason:string;sensitive:number}>();
    if (!previous || previous.subject_kind !== 'card' || previous.subject_id !== cardId || previous.action !== 'cover_mark'
      || previous.sensitive !== next || previous.reason !== reason) throw new HttpError(409,'cover_mark_conflict');
  }
  return coverState(await readCoverFlags(db,cardId),cover);
}
