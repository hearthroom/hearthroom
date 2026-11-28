import { bumpOp } from './ops-metrics';
import { apiBaseOf } from './providers';
import type { Env } from './types';

const PAGE_SIZE = 100;
const PAGES_PER_RUN = 8;
const LEASE_MS = 120_000;
type Play = { players: number; reached: number; medianTurns: number | null };
type Snapshot = Record<string, Play | null>;
type Card = { id: number; role: string };

async function readPlay(env: Env, roles: string[]): Promise<Snapshot> {
  const response = await fetch(`${apiBaseOf(env, 'harbor')}/open/v1/hosting/card-quality/play`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hosting-Key': env.HOSTING_SERVICE_KEY ?? '' },
    body: JSON.stringify({ roleIds: roles }),
    redirect: 'manual',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('quality source unavailable');
  }
  return (await response.json<{ items?: Snapshot }>() ?? {}).items ?? {};
}

function validPlay(play: Play | null | undefined): play is Play | null {
  if (play === null) return true;
  if (!play || !Number.isSafeInteger(play.players) || play.players < 0
    || !Number.isSafeInteger(play.reached) || play.reached < 0 || play.reached > play.players) return false;
  if (play.players === 0) return play.medianTurns === null;
  return play.medianTurns !== null && Number.isFinite(play.medianTurns) && play.medianTurns >= 1;
}

export async function syncCardQualityPlay(
  env: Env,
  { read = (roles: string[]) => readPlay(env, roles), now = Date.now } = {},
): Promise<'ok' | 'busy'> {
  const started = now();
  const lease = crypto.randomUUID();
  try {
    const acquired = await env.DB.prepare(`UPDATE card_quality_play_sync SET lease=?, lease_until=?
      WHERE singleton=1 AND lease_until<=? RETURNING cursor`).bind(lease, started + LEASE_MS, started).first<{ cursor: number }>();
    if (!acquired) {
      await bumpOp(env.DB, 'card_quality_play_sync', 'run', 'busy');
      return 'busy';
    }
    let cursor = acquired.cursor;
    for (let i = 0; i < PAGES_PER_RUN; i++) {
      const { results: cards } = await env.DB.prepare(`SELECT id, COALESCE(approved_hosted_role_id,source_role_id) AS role FROM cards NOT INDEXED
        WHERE id>? AND provider='harbor' AND status='approved' ORDER BY id LIMIT ?`).bind(cursor, PAGE_SIZE).all<Card>();
      const roles = [...new Set(cards.map(card => card.role))];
      cursor = cards.length < PAGE_SIZE ? 0 : cards[cards.length - 1].id;
      const checkpoint = (checkAt: number) => env.DB.prepare('UPDATE card_quality_play_sync SET cursor=? WHERE singleton=1 AND lease=? AND lease_until>?')
        .bind(cursor, lease, checkAt);
      let snapshot: Snapshot;
      try {
        snapshot = roles.length ? await read(roles) : {};
        if (roles.some(role => !Object.hasOwn(snapshot, role) || !validPlay(snapshot[role]))) {
          throw new Error('incomplete quality snapshot');
        }
      } catch (error) {
        // Keep this page's last good data. A permanently oversized page must
        // not stop the cursor from refreshing the rest of the catalog.
        await checkpoint(now()).run();
        throw error;
      }
      const payload = JSON.stringify(cards.map(card => ({ ...card, play: snapshot[card.role] })));
      const fence = 'EXISTS(SELECT 1 FROM card_quality_play_sync WHERE singleton=1 AND lease=? AND lease_until>?)';
      const checkAt = now();
      const [, , saved] = await env.DB.batch([
        env.DB.prepare(`INSERT INTO card_quality_play(card_id,players,reached,median_turns,verified_at)
          SELECT c.id,json_extract(j.value,'$.play.players'),json_extract(j.value,'$.play.reached'),COALESCE(json_extract(j.value,'$.play.medianTurns'),0),?
          FROM json_each(?) j CROSS JOIN cards c ON c.id=json_extract(j.value,'$.id')
          WHERE c.provider='harbor' AND c.status='approved' AND COALESCE(c.approved_hosted_role_id,c.source_role_id)=json_extract(j.value,'$.role')
            AND json_extract(j.value,'$.play') IS NOT NULL AND ${fence}
          ON CONFLICT(card_id) DO UPDATE SET players=excluded.players,reached=excluded.reached,
            median_turns=excluded.median_turns,verified_at=excluded.verified_at
          WHERE card_quality_play.verified_at<=excluded.verified_at`).bind(checkAt, payload, lease, checkAt),
        env.DB.prepare(`DELETE FROM card_quality_play WHERE card_id IN (
          SELECT c.id FROM json_each(?) j CROSS JOIN cards c ON c.id=json_extract(j.value,'$.id')
          WHERE json_extract(j.value,'$.play') IS NULL AND COALESCE(c.approved_hosted_role_id,c.source_role_id)=json_extract(j.value,'$.role')
        ) AND ${fence}`).bind(payload, lease, checkAt),
        checkpoint(checkAt),
      ]);
      if (!saved.meta.changes) throw new Error('quality sync lease expired');
      if (!cursor) break;
    }
    await bumpOp(env.DB, 'card_quality_play_sync', 'run', 'ok');
    return 'ok';
  } catch (error) {
    await bumpOp(env.DB, 'card_quality_play_sync', 'run', 'error');
    throw error;
  } finally {
    await env.DB.prepare("UPDATE card_quality_play_sync SET lease='',lease_until=0 WHERE singleton=1 AND lease=?").bind(lease).run();
  }
}
