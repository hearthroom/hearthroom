import { QUALITY_MIN_PLAYERS, QUALITY_TURNS, type CardQualityDetail, type CardQualityLength, type CardQualitySignal } from '../shared/card-quality';

export interface QualitySignalRow {
  quality_chars?: number | null;
  quality_players?: number | null;
  quality_reached?: number | null;
}

function deepPlay(players: number | null | undefined, reached: number | null | undefined) {
  return players != null && players >= QUALITY_MIN_PLAYERS && reached != null
    ? { players, reached, turns: QUALITY_TURNS }
    : null;
}

export function cardQualitySignal(row: QualitySignalRow): CardQualitySignal {
  return { lengthCharacters: row.quality_chars ?? null, deepPlay: deepPlay(row.quality_players, row.quality_reached) };
}

type LengthRow = {
  total_chars: number | null;
  setting_chars: number | null;
  worldbook_entries: number;
  worldbook_chars: number;
  opening_count: number;
  opening_chars: number;
  display_rules: number;
  opening_page: number;
  panel: number;
  players: number | null;
  reached: number | null;
  median_turns: number | null;
};

export async function readCardQuality(
  db: D1Database, cardId: string, approvedVersion: string | null,
): Promise<Pick<CardQualityDetail, 'length' | 'deepPlay'>> {
  const row = await db.prepare(`SELECT q.*, p.players, p.reached, p.median_turns
    FROM cards c
    LEFT JOIN card_quality_lengths q ON q.version_id=c.approved_version_id
    LEFT JOIN card_quality_play p ON p.card_id=c.id
    WHERE c.id=? AND c.status='approved' AND c.public_blocked=0 AND c.approved_version_id IS ?`)
    .bind(cardId, approvedVersion).first<LengthRow>();
  if (!row) return { length: null, deepPlay: null };
  const activity = deepPlay(row.players, row.reached);
  return {
    length: row.total_chars === null ? null : {
      total: row.total_chars,
      setting: row.setting_chars,
      worldbook: { entries: row.worldbook_entries, characters: row.worldbook_chars },
      openings: { count: row.opening_count, characters: row.opening_chars },
      presentation: { openingPage: row.opening_page === 1, displayRules: row.display_rules, panel: row.panel === 1 },
    },
    deepPlay: activity && row.median_turns !== null ? { ...activity, medianTurns: row.median_turns } : null,
  };
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
