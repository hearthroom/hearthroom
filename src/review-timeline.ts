import { parseReviewReasons } from '../shared/review-reasons';

/**
 * 單卡審核紀錄（審卡 V2 第二批，ui.md §4.2）：一張卡從第一次送審到現在的每一件事排成一條線。
 *
 * 來源分兩種，各取各的、不重複：
 *   - 送審、定案、審核章（含駁回理由與補充）、重新審核：審核單與審核章本身（V2 之前的歷史也在）。
 *   - 不受理／復原（含來源）、冷凍／解凍、撤回或被新版取代、撤銷重新審核：V2 的審核事件，0145 上線後才有。
 * 舊流程撤銷登記會刪單，那些送審留不下來；V2 之前的冷凍與不受理沒有事件。coverageFrom 標出事件紀錄的起點，
 * 畫面照實說，不補造。只給審核員（跟審核頁同一道門）；審核員之間本來就看得到彼此的名字，作者看不到這條線。
 */
export type TimelineAction =
  | 'submit' | 'approve' | 'reject' | 'reopen' | 'reopen_withdraw'
  | 'drop' | 'restore' | 'hold' | 'unhold' | 'superseded';

export interface TimelineItem {
  at: number;
  action: TimelineAction;
  /** 第幾次作者送審（重新審核單掛在它審的那一張上）；從 1 起 */
  round: number;
  /** 審核員的顯示名；作者與系統動作是 null */
  actor: string | null;
  mine: boolean;
  /** 不受理的來源：single／author_batch／device_batch／auto_same_content */
  source?: string | null;
  reasons?: string[];
  note?: string;
  /** 審核標記（只給審核員） */
  marks?: string[];
  /** 通過並附改進建議的理由代碼 */
  suggestions?: string[];
  /** 這一筆屬於現在打開的這張單 */
  current: boolean;
}

const EVENT_ACTIONS: TimelineAction[] = ['drop', 'restore', 'hold', 'unhold', 'superseded', 'reopen_withdraw'];

export async function reviewTimeline(db: D1Database, submissionId: string, viewer: string): Promise<{ items: TimelineItem[]; coverageFrom: number | null }> {
  const card = await db.prepare('SELECT card_id FROM review_submissions WHERE id=?').bind(submissionId).first<{ card_id: number }>();
  if (!card) return { items: [], coverageFrom: null };
  const [subs, stamps, events, first] = await db.batch([
    db.prepare(`SELECT id, submitted_at, status, decided_at, note, reject_reasons, reopen_of FROM review_submissions WHERE card_id=? ORDER BY submitted_at, rowid`).bind(card.card_id),
    db.prepare(`SELECT st.submission_id, st.member_id, st.verdict, st.note, st.created_at, COALESCE(NULLIF(m.display_name,''), m.handle) AS name, s.reject_reasons, s.reopen_of,
        (SELECT ev.marks FROM review_events ev WHERE ev.event_key='stamp:'||st.submission_id||':'||st.member_id) AS marks,
        (SELECT ev.reasons FROM review_events ev WHERE ev.event_key='stamp:'||st.submission_id||':'||st.member_id AND ev.source='suggestions') AS suggestions
      FROM review_stamps st JOIN review_submissions s ON s.id=st.submission_id LEFT JOIN members m ON m.id=st.member_id WHERE s.card_id=?`).bind(card.card_id),
    db.prepare(`SELECT e.submission_id, e.action, e.at, e.actor_member_id, e.source, e.marks, COALESCE(NULLIF(m.display_name,''), m.handle) AS name
      FROM review_events e LEFT JOIN members m ON m.id=e.actor_member_id
      WHERE e.card_id=? AND +e.action IN (${EVENT_ACTIONS.map(() => '?').join(',')})`).bind(card.card_id, ...EVENT_ACTIONS),
    db.prepare('SELECT MIN(at) AS at FROM review_events'),
  ]);
  type Sub = { id: string; submitted_at: number; status: string; decided_at: number | null; note: string; reject_reasons: string | null; reopen_of: string | null };
  const subRows = (subs as D1Result<Sub>).results;
  // 作者送審的輪次；重新審核單沿用它審的那一張的輪次
  const round = new Map<string, number>();
  let n = 0;
  for (const s of subRows) if (!s.reopen_of) round.set(s.id, ++n);
  for (const s of subRows) if (s.reopen_of) round.set(s.id, round.get(s.reopen_of) ?? n);
  const items: TimelineItem[] = [];
  const base = (id: string) => ({ round: round.get(id) ?? 1, current: id === submissionId });
  for (const s of subRows) items.push({ at: s.submitted_at, action: s.reopen_of ? 'reopen' : 'submit', actor: null, mine: false, ...base(s.id) });
  const marksOf = (raw: string | null) => { try { const m = raw ? JSON.parse(raw) : []; return Array.isArray(m) && m.length ? { marks: m.filter((x): x is string => typeof x === 'string') } : {}; } catch { return {}; } };
  for (const st of (stamps as D1Result<{ submission_id: string; member_id: string; verdict: 'approve' | 'reject'; note: string; created_at: number; name: string | null; reject_reasons: string | null; marks: string | null; suggestions: string | null }>).results) {
    const suggestions = st.verdict === 'approve' ? parseReviewReasons(st.suggestions) : [];
    items.push({ ...marksOf(st.marks), ...(suggestions.length ? { suggestions } : {}),
      at: st.created_at, action: st.verdict, actor: (st.name ?? '').slice(0, 80) || null, mine: st.member_id === viewer,
      ...(st.verdict === 'reject' ? { reasons: parseReviewReasons(st.reject_reasons), note: st.note.slice(0, 2000) } : {}),
      ...base(st.submission_id),
    });
  }
  for (const e of (events as D1Result<{ submission_id: string; action: TimelineAction; at: number; actor_member_id: string | null; source: string | null; marks: string | null; name: string | null }>).results) {
    items.push({ ...marksOf(e.marks), at: e.at, action: e.action, actor: e.actor_member_id ? (e.name ?? '').slice(0, 80) || null : null, mine: !!e.actor_member_id && e.actor_member_id === viewer, ...(e.action === 'drop' ? { source: e.source } : {}), ...base(e.submission_id) });
  }
  items.sort((a, b) => a.at - b.at);
  return { items, coverageFrom: (first as D1Result<{ at: number | null }>).results[0]?.at ?? null };
}
