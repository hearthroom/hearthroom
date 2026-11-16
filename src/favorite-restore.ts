import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireMember } from './members';
import { HttpError, type Env } from './types';

type Member = Awaited<ReturnType<typeof requireMember>>;
type Snapshot = { v: 1; member: string; cardId: string; createdAt: number; expires: number };
const domain = 'hearthroom.favorite-restore.v1:';
const encode = (value: Uint8Array) => btoa(Array.from(value, b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const bytes = (payload: string) => new TextEncoder().encode(domain + payload);
async function signingKey(env: Env) {
  if (!env.SHORTCUT_SECRET) throw new HttpError(503, 'favorite_restore_unavailable');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SHORTCUT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const subject = async (member: Member) => encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([member.id, member.provider, member.externalId])))));

/** Only an actual owned bookmark removal can grant this short-lived undo. */
export async function removeFavorite(env: Env, member: Member, cardId: string): Promise<{ active: boolean; restoreToken?: string }> {
  const row = await env.DB.prepare('SELECT created_at FROM member_favorites WHERE member_id=? AND card_id=?')
    .bind(member.id, cardId).first<{ created_at: number }>();
  if (!row) return { active: false };
  // Finish signing before mutation. A missing secret cannot lose a bookmark.
  const key = await signingKey(env);
  const snapshot: Snapshot = { v: 1, member: await subject(member), cardId, createdAt: row.created_at, expires: Date.now() + 15 * 60 * 1000 };
  const payload = encode(new TextEncoder().encode(JSON.stringify(snapshot)));
  const restoreToken = payload + '.' + encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes(payload))));
  const removed = await env.DB.prepare('DELETE FROM member_favorites WHERE member_id=? AND card_id=? AND created_at=?')
    .bind(member.id, cardId, row.created_at).run();
  if (removed.meta.changes) return { active: false, restoreToken };
  const current = await env.DB.prepare('SELECT 1 FROM member_favorites WHERE member_id=? AND card_id=?').bind(member.id, cardId).first();
  return { active: !!current };
}

async function verify(env: Env, raw: unknown, member: string): Promise<Snapshot> {
  if (typeof raw !== 'string' || raw.length > 2048) throw new HttpError(400, 'invalid_restoration');
  const [payload, sig, ...rest] = raw.split('.');
  let snapshot: Snapshot;
  try {
    if (!payload || !sig || rest.length || !await crypto.subtle.verify('HMAC', await signingKey(env), decode(sig), bytes(payload))) throw new Error();
    snapshot = JSON.parse(new TextDecoder().decode(decode(payload)));
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'invalid_restoration'); }
  if (snapshot.v !== 1 || !/^\d{1,16}$/.test(snapshot.cardId) || !Number.isSafeInteger(snapshot.createdAt) || !Number.isSafeInteger(snapshot.expires)) throw new HttpError(400, 'invalid_restoration');
  if (snapshot.member !== member) throw new HttpError(403, 'invalid_restoration');
  if (snapshot.expires < Date.now()) throw new HttpError(409, 'restoration_expired');
  return snapshot;
}

export const favoriteRestoreRoutes = new Hono<{ Bindings: Env }>();
favoriteRestoreRoutes.post('/v1/me/favorites/restore', bodyLimit({ maxSize: 52000, onError: c => c.json({ error: 'payload_too_large' }, 413) }), async c => {
  const member = await requireMember(c);
  const body = await c.req.json().catch(() => null) as { tokens?: unknown } | null;
  if (!Array.isArray(body?.tokens) || !body.tokens.length || body.tokens.length > 24 || new Set(body.tokens).size !== body.tokens.length) throw new HttpError(400, 'invalid_restoration');
  const memberSubject = await subject(member);
  // Validate every capability before any database mutation.
  const snapshots = await Promise.all(body.tokens.map(raw => verify(c.env, raw, memberSubject)));
  await c.env.DB.batch(snapshots.map(snapshot => c.env.DB.prepare(`INSERT OR IGNORE INTO member_favorites(member_id,card_id,created_at)
    SELECT ?,id,? FROM cards WHERE id=?`).bind(member.id, snapshot.createdAt, snapshot.cardId)));
  const ids = snapshots.map(snapshot => snapshot.cardId);
  const rows = await c.env.DB.prepare('SELECT CAST(card_id AS TEXT) AS id FROM member_favorites WHERE member_id=? AND card_id IN(SELECT value FROM json_each(?))')
    .bind(member.id, JSON.stringify(ids)).all<{ id: string }>();
  const restored = new Set(rows.results.map(row => row.id));
  return c.json({ restoredIds: ids.filter(id => restored.has(id)) });
});
