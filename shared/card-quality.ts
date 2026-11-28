export const QUALITY_TURNS = 5;
export const QUALITY_MIN_PLAYERS = 20;

export interface CardQualityLength {
  /** Character counts are rounded. Zero represents fewer than 1,000 characters. */
  total: number;
  /** Null represents no eligible setting text. */
  setting: number | null;
  worldbook: { entries: number; characters: number };
  openings: { count: number; characters: number };
  presentation: { openingPage: boolean; displayRules: number; panel: boolean };
}

export interface CardQualityDeepPlay {
  /** An integer percentage, rounded down. The public API omits cohort counts. */
  rate: number;
}

export interface CardQualitySignal {
  lengthCharacters: number | null;
  deepPlay: CardQualityDeepPlay | null;
  /** Public card lists include the preview data so the preview opens without another request. Absent when it could not be read. */
  detail?: CardQualityDetail;
}

export interface CardQualityDetail {
  length: CardQualityLength | null;
  deepPlay: (CardQualityDeepPlay & { medianTurns: number }) | null;
  rating: { average: number; count: number } | null;
  comments: number | null;
}
