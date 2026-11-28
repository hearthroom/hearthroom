import { QUALITY_MIN_PLAYERS, type CardQualityDetail, type CardQualityLength, type CardQualitySignal } from '../shared/card-quality';
import { MIN_SCORE_COUNT } from '../shared/card-score';
import type { Env } from './types';

// The scheduled sync rechecks cohorts. Stop serving a last-good value after
// six hours if its page cannot be verified, so an old cohort cannot persist.
const MAX_PLAY_SNAPSHOT_AGE_MS = 6 * 60 * 60 * 1000;
export const FRESH_PLAY_SNAPSHOT = `qp.verified_at > unixepoch('now') * 1000 - ${MAX_PLAY_SNAPSHOT_AGE_MS}`;

export interface QualitySignalRow {
  quality_chars?: number | null;
  quality_players?: number | null;
  quality_reached?: number | null;
}

/** Every rounded count the preview shows, as both the detail endpoint and public lists select it. */
export interface QualityRow extends QualitySignalRow {
  quality_setting_chars?: number | null;
  quality_worldbook_entries?: number | null;
  quality_worldbook_chars?: number | null;
  quality_opening_count?: number | null;
  quality_opening_chars?: number | null;
  quality_display_rules?: number | null;
  quality_opening_page?: number | null;
  quality_panel?: number | null;
  quality_median_turns?: number | null;
}
/** Callers join `ql` (card_quality_lengths of the approved version) and `qp` (a fresh card_quality_play row). */
export const QUALITY_COLUMNS = `ql.total_chars AS quality_chars, ql.setting_chars AS quality_setting_chars,
  ql.worldbook_entries AS quality_worldbook_entries, ql.worldbook_chars AS quality_worldbook_chars,
  ql.opening_count AS quality_opening_count, ql.opening_chars AS quality_opening_chars,
  ql.display_rules AS quality_display_rules, ql.opening_page AS quality_opening_page, ql.panel AS quality_panel,
  qp.players AS quality_players, qp.reached AS quality_reached, qp.median_turns AS quality_median_turns`;

export function qualityProjection(row: QualityRow): Pick<CardQualityDetail, 'length' | 'deepPlay'> {
  const activity = deepPlay(row.quality_players, row.quality_reached);
  return {
    length: row.quality_chars == null ? null : {
      total: row.quality_chars,
      setting: row.quality_setting_chars ?? null,
      worldbook: { entries: row.quality_worldbook_entries ?? 0, characters: row.quality_worldbook_chars ?? 0 },
      openings: { count: row.quality_opening_count ?? 0, characters: row.quality_opening_chars ?? 0 },
      presentation: { openingPage: row.quality_opening_page === 1, displayRules: row.quality_display_rules ?? 0, panel: row.quality_panel === 1 },
    },
    deepPlay: activity && row.quality_median_turns != null ? { ...activity, medianTurns: row.quality_median_turns } : null,
  };
}

export type CardSocial = Pick<CardQualityDetail, 'rating' | 'comments'>;

/**
 * Ratings and top-level comment counts for a page of cards in two grouped reads, with the same rules as the
 * card page: only normal accounts' scores, an average once MIN_SCORE_COUNT people rated, visible comments only.
 */
export async function readCardSocial(db: D1Database, ids: string[]): Promise<Record<string, CardSocial>> {
  const out: Record<string, CardSocial> = {};
  if (!ids.length) return out;
  const list = JSON.stringify(ids);
  const [scores, comments] = await db.batch<{ id: string; score: number; n: number }>([
    // json_each 驅動、逐卡走索引（CROSS JOIN 固定順序）：只讀顯示中那幾張卡的評分與留言，不掃整張表
    db.prepare(`SELECT j.value AS id, s.score, COUNT(*) AS n FROM json_each(?1) j CROSS JOIN card_scores s ON s.card_id = j.value
      WHERE EXISTS(SELECT 1 FROM members m WHERE m.id=s.member_id AND m.account_class='normal') GROUP BY j.value, s.score`).bind(list),
    db.prepare(`SELECT j.value AS id, 0 AS score, COUNT(*) AS n FROM json_each(?1) j CROSS JOIN comments c
      ON c.card_id = CAST(j.value AS INTEGER) AND c.root_id IS NULL AND c.deleted_at IS NULL
      WHERE c.status = 'visible' GROUP BY j.value`).bind(list),
  ]);
  const totals = new Map<string, { count: number; sum: number }>();
  for (const r of scores!.results) {
    const t = totals.get(r.id) ?? { count: 0, sum: 0 };
    t.count += r.n; t.sum += r.score * r.n; totals.set(r.id, t);
  }
  const counted = new Map(comments!.results.map(r => [r.id, r.n]));
  for (const id of ids) {
    const t = totals.get(id);
    out[id] = {
      rating: t && t.count >= MIN_SCORE_COUNT ? { average: Math.round((t.sum / t.count) * 10) / 10, count: t.count } : null,
      comments: counted.get(id) ?? 0,
    };
  }
  return out;
}

function deepPlay(players: number | null | undefined, reached: number | null | undefined) {
  return players != null && players >= QUALITY_MIN_PLAYERS && reached != null
    ? { rate: Math.floor((reached * 100) / players) }
    : null;
}

export function cardQualitySignal(row: QualitySignalRow): CardQualitySignal {
  return { lengthCharacters: row.quality_chars ?? null, deepPlay: deepPlay(row.quality_players, row.quality_reached) };
}

export async function readCardQuality(
  db: D1Database, cardId: string, approvedVersion: string | null,
): Promise<Pick<CardQualityDetail, 'length' | 'deepPlay'>> {
  const row = await db.prepare(`SELECT ${QUALITY_COLUMNS}
    FROM cards c
    LEFT JOIN card_quality_lengths ql ON ql.version_id=c.approved_version_id
    LEFT JOIN card_quality_play qp ON qp.card_id=c.id AND ${FRESH_PLAY_SNAPSHOT}
    WHERE c.id=? AND c.status='approved' AND c.public_blocked=0 AND c.approved_version_id IS ?`)
    .bind(cardId, approvedVersion).first<QualityRow>();
  if (!row) return { length: null, deepPlay: null };
  return qualityProjection(row);
}

export function qualityLengthStatement(db: D1Database, version: string, length: CardQualityLength, submissionId: string | null = null) {
  return db.prepare(`INSERT OR IGNORE INTO card_quality_lengths
    (version_id,total_chars,setting_chars,worldbook_entries,worldbook_chars,opening_count,opening_chars,opening_page,display_rules,panel)
    SELECT version_id,?,?,?,?,?,?,?,?,? FROM hosting_versions WHERE version_id=? AND (? IS NULL OR submission_id=?)`).bind(
    length.total, length.setting, length.worldbook.entries, length.worldbook.characters,
    length.openings.count, length.openings.characters, Number(length.presentation.openingPage),
    length.presentation.displayRules, Number(length.presentation.panel), version, submissionId, submissionId,
  );
}

/**
 * 列表附上預覽要的評分與留言數。每張卡各一筆邊緣快取，5 分鐘到期：推薦（隨機）、搜尋、作者頁、收藏這些
 * 每次組合都不同的列表，也能共用同一張卡算好的數字；只有沒命中的卡才一起讀一次 D1。
 * 不跟留言／評分版本換鍵：熱門卡隨時有人留言，換鍵就幾乎每次都重讀（正式站首屏 24 張約 700 筆評分、1,600 則留言，
 * 一次約 5,000 列讀取）。所以預覽的數字最多晚 5 分鐘，卡片頁的數據區照舊即時讀。
 * 讀不到就回 null：列表照常回、不附預覽數據，前端退回單卡請求。
 */
const LIST_SOCIAL_TTL_MS = 5 * 60 * 1000;
const LIST_SOCIAL_CACHE = 'card-quality-social-v1';
type SocialEntry = { value: CardSocial; expires: number };
export async function listCardSocial(
  env: Env, rows: { id: string | number; status: string }[],
  opts: { ctx?: Pick<ExecutionContext, 'waitUntil'>; onSocial?: (layer: string) => void } = {},
): Promise<Record<string, CardSocial> | null> {
  const ids = [...new Set(rows.filter(r => r.status === 'approved').map(r => String(r.id)))];
  if (!ids.length) return null;
  try {
    const cache = await caches.open(LIST_SOCIAL_CACHE);
    const keyOf = (id: string) => new Request(`https://card-social.internal/${encodeURIComponent(id)}`);
    const now = Date.now();
    const cached = await Promise.all(ids.map(async id => {
      try {
        const entry = await (await cache.match(keyOf(id)))?.json<SocialEntry>();
        return entry && entry.expires > now ? entry.value : null;
      } catch { return null; }
    }));
    const out: Record<string, CardSocial> = {};
    ids.forEach((id, i) => { if (cached[i]) out[id] = cached[i]!; });
    const missing = ids.filter(id => !out[id]);
    if (missing.length) {
      const read = await readCardSocial(env.DB, missing);
      Object.assign(out, read);
      const expires = now + LIST_SOCIAL_TTL_MS;
      const write = Promise.all(missing.map(id => cache.put(keyOf(id), new Response(JSON.stringify({ value: read[id], expires }), {
        headers: { 'Cache-Control': `public, max-age=${LIST_SOCIAL_TTL_MS / 1000}` },
      })))).then(() => {}).catch(() => { console.warn('Card list social cache write unavailable'); });
      if (opts.ctx) opts.ctx.waitUntil(write); else await write;
    }
    opts.onSocial?.(!missing.length ? 'edge' : missing.length === ids.length ? 'origin' : 'partial');
    return out;
  } catch {
    opts.onSocial?.('error');
    console.warn('Card list social signals unavailable');
    return null;
  }
}
