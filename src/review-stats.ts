import { Hono } from 'hono';
import { requireMember, reviewerRole } from './members';
import { bumpOp } from './ops-metrics';
import { REVIEW_SPEC_VERSION } from './review-v2';
import { PROFILE_RULE_VERSION } from './review-profile';
import { parseReviewReasons, RETIRED_REVIEW_REASONS, REVIEW_REASONS } from '../shared/review-reasons';
import { type Env, HttpError } from './types';

/**
 * 審核統計（審卡 V2 第二批，管理員限定；口徑 da.md「每個問題要看哪個數字」「統計頁、匯出與權限」，版面 ui.md §4.3）。
 *
 * 一支彙總函式 reviewStats 算出全部格子並在這裡做完抑制；JSON 與 CSV 都只是把同一份結果換個排法，
 * 所以兩邊看到的「樣本不足」永遠一致，小格的原始筆數不會離開伺服器。
 *
 * 格子（cell）＝一個期間（UTC 週、整個窗口，或 now＝資料截至時的存量）× 一個區塊 × 一個維度值。
 * 格子的「筆數」是落在這格的資料列（送審單、駁回單、案件、事件…，各區塊註明），「作者數」是其中可辨識的不同作者。
 *   - ok：筆數 ≥ 10 且作者 ≥ 5，或筆數是 0（真的沒有，顯示 0；比例的分母是 0 時比例是 null）。
 *   - suppressed：1–9 筆或不到 5 位作者。只回狀態，不回任何數字。
 *   - unmeasured：資料根本沒記（例如 V2 前的駁回理由、「看過作者側寫」的人數），不是 0。
 * 互補格：
 *   - 同一期間裡互斥且加總等於上層總數的一組格子（開場字數五段、不受理第 7 天的結果…），只有一格被抑制時
 *     再抑制一格最小的，免得「總數 − 其他格」反推回來。
 *   - 窗口總計：同一區塊同一維度只要有任何一週被抑制（且那週有資料），總計也抑制。這樣不同 weeks 的窗口
 *     互減也只會得到本來就公開的週數字（da.md「總計和連續多週窗口也需檢查互補格」）。
 *
 * 作者：送審特徵表的 author_member_id；沒有特徵列（V2 之前的單）退到託管版本的成員，再退到卡片作者公開 ID 對應的成員。
 * 三者都查不到的列照算筆數，但不算作者（不會因為認不出作者而讓格子更容易公開）。作者識別只在這支函式裡用來數人頭。
 *
 * ponytail: 每次請求把窗口內的事件、案件讀進記憶體再分組；審核量是每週幾百筆的量級沒問題。上萬筆時改成每晚彙總到統計表。
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** 1970-01-01 是星期四：第一個星期一 00:00 UTC 是 1970-01-05 */
const MONDAY = 4 * DAY;
export const MIN_ROWS = 10;
export const MIN_AUTHORS = 5;
export const RESUBMIT_DAYS = 14;
export const DROP_OUTCOME_DAYS = 7;
export const MAX_WEEKS = 12;
export const DEFAULT_WEEKS = 4;
/** 0145 上線時間（2026-11-23 14:27 台北）。還沒有任何事件時，空狀態用它說「從哪天起累積」 */
export const V2_DEPLOYED_AT = Date.UTC(2026, 10, 23, 6, 27);

/** 開場白有效字數五段（PM 2026-11-23 裁定）；沒有送審特徵的單另列 missing */
export const OPENING_BUCKETS = [['lt100', 100], ['100_299', 300], ['300_599', 600], ['600_1199', 1200], ['ge1200', Infinity]] as const;
export const OPENING_DIMS = [...OPENING_BUCKETS.map(([k]) => k), 'missing'] as const;

/** 更新差異的改動欄位粗分組（da.md「粗分組」；欄位鍵見 review-diff.ts TEXT_FIELDS / ASSET_FIELDS） */
export const FIELD_GROUPS = ['opening', 'setting', 'profile', 'lorebook', 'rules', 'presentation', 'unchanged'] as const;
const FIELD_GROUP_OF: Record<string, (typeof FIELD_GROUPS)[number]> = {
  opening: 'opening', alternates: 'opening', prologue: 'opening',
  setting: 'setting', world: 'setting', instructions: 'setting', talkExample: 'setting', outputContract: 'setting', speech: 'setting', userName: 'setting',
  name: 'profile', summary: 'profile', type: 'profile', sex: 'profile', language: 'profile', tags: 'profile',
};
export const UPDATE_BASES = ['approved', 'rejected', 'none', 'missing'] as const;
export const DROP_OUTCOMES = ['restored', 'withdrawn', 'resubmitted_changed', 'still_dropped', 'other'] as const;
export const RESTORED_RESULTS = ['approved', 'rejected', 'pending', 'withdrawn'] as const;
export const DROP_SOURCES = ['single', 'author_batch', 'device_batch', 'auto_same_content'] as const;
export const OPERATIONS = ['approve', 'reject', 'hold', 'unhold', 'drop', 'restore', 'reopen', 'reopen_withdraw'] as const;
/** 首個人工處置：蓋章、駁回、冷凍、人工不受理（領取與同內容自動移出不算，da.md） */
const FIRST_ACTIONS = ['approve', 'reject', 'hold', 'drop'];
const REASON_CODES: readonly string[] = [...REVIEW_REASONS, ...RETIRED_REVIEW_REASONS];

export const weekStart = (t: number) => Math.floor((t - MONDAY) / WEEK) * WEEK + MONDAY;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const utcDayStart = (t: number) => Math.floor(t / DAY) * DAY;

/** 取最近名次（nearest-rank），跟分享活動看板同一個口徑 */
const percentile = (sorted: number[], p: number): number | null => (sorted.length ? sorted[Math.max(Math.ceil(p * sorted.length), 1) - 1]! : null);
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export type CellValues = Record<string, number | null>;
export type Cell =
  | { status: 'ok'; n: number; denominator?: number; values: CellValues }
  | { status: 'suppressed' }
  | { status: 'unmeasured' };
export interface StatRow { period: string; section: string; dimension: string; cell: Cell }

export interface ReviewStats {
  specVersion: number;
  generatedAt: number;
  weeks: number;
  /** 窗口：最近幾個完整 UTC 週，週一 00:00 起算、左閉右開 */
  window: { start: number; end: number; weekStarts: string[] };
  /** V2 前基線：V2 開始那週往前同樣週數，截在 V2 開始的那一刻（不加總進 V2） */
  baseline: { start: number; end: number; weekStarts: string[] };
  /** V2 開始＝最早一筆審核事件；還沒有事件時是上線時間，v2Recorded=false */
  v2StartedAt: number;
  v2Recorded: boolean;
  /** 窗口內沒有任何審核事件 */
  empty: boolean;
  thresholds: { rows: number; authors: number };
  rows: StatRow[];
}

/** 抑制前的格子。values=null 是量不到 */
interface Draft {
  period: string; section: string; dimension: string; rows: number; authors: number; values: CellValues | null; denominator?: number; partition?: boolean; suppressed: boolean;
  /** 分母取自同一期間的哪一格；那一格沒公開時，這格的分母與用它算出的比例（derived）一起拿掉 */
  parent?: { section: string; dimension: string; derived: string[] };
}

/** 一列資料：落在哪一週、作者是誰（可能認不出）、帶什麼值 */
interface Item<T> { week: string; author: string | null; data: T }

/**
 * 依期間分組：每一列同時進它那一週與 all（窗口總計）。dims 先全部開好格子，沒有資料的格子是 0 筆。
 */
class Grid<T> {
  private cells = new Map<string, { period: string; dimension: string; items: T[]; authors: Set<string> }>();
  constructor(readonly section: string, private periods: string[], dims: readonly string[] = []) {
    for (const d of dims) for (const p of [...periods, 'all']) this.cell(p, d);
  }
  private cell(period: string, dimension: string) {
    const key = `${period}|${dimension}`;
    let c = this.cells.get(key);
    if (!c) this.cells.set(key, (c = { period, dimension, items: [], authors: new Set() }));
    return c;
  }
  add(dimension: string, item: Item<T>) {
    for (const p of [item.week, 'all']) {
      const c = this.cell(p, dimension);
      c.items.push(item.data);
      if (item.author) c.authors.add(item.author);
    }
  }
  /** 每一格交給 reduce 算值；partition＝這一組維度互斥、加總等於上層 */
  drafts(reduce: (items: T[], period: string, dimension: string) => { values: CellValues | null; denominator?: number }, partition = false): Draft[] {
    return [...this.cells.values()].map((c) => ({ period: c.period, section: this.section, dimension: c.dimension, rows: c.items.length, authors: c.authors.size, partition, suppressed: false, ...reduce(c.items, c.period, c.dimension) }));
  }
}

/** 抑制：門檻 → 互補格 → 窗口總計，反覆到不再變 */
export function suppress(drafts: Draft[]): StatRow[] {
  for (const d of drafts) d.suppressed = d.values !== null && d.rows > 0 && (d.rows < MIN_ROWS || d.authors < MIN_AUTHORS);
  const byPartition = new Map<string, Draft[]>();
  const byWeekRow = new Map<string, Draft[]>();
  for (const d of drafts) {
    if (d.partition) {
      const k = `${d.section}|${d.period}`;
      byPartition.set(k, [...(byPartition.get(k) ?? []), d]);
    }
    if (d.period !== 'all' && d.period !== 'now') {
      const k = `${d.section}|${d.dimension}`;
      byWeekRow.set(k, [...(byWeekRow.get(k) ?? []), d]);
    }
  }
  const totals = drafts.filter((d) => d.period === 'all');
  for (let changed = true; changed;) {
    changed = false;
    for (const group of byPartition.values()) {
      if (group.filter((d) => d.suppressed && d.rows > 0).length !== 1) continue;
      const next = group.filter((d) => !d.suppressed && d.values !== null).sort((a, b) => Number(a.rows === 0) - Number(b.rows === 0) || a.rows - b.rows)[0];
      if (next) { next.suppressed = true; changed = true; }
    }
    for (const total of totals) {
      if (total.suppressed || total.values === null) continue;
      if ((byWeekRow.get(`${total.section}|${total.dimension}`) ?? []).some((w) => w.suppressed && w.rows > 0)) { total.suppressed = true; changed = true; }
    }
  }
  // 分母跟著上層格：上層被抑制（或量不到），分母就是一個沒公開的數字，不能從旁邊的格子帶出去
  const byKey = new Map(drafts.map((d) => [`${d.section}|${d.dimension}|${d.period}`, d]));
  for (const d of drafts) {
    if (!d.parent || d.suppressed || d.values === null) continue;
    const parent = byKey.get(`${d.parent.section}|${d.parent.dimension}|${d.period}`);
    if (parent && !parent.suppressed && parent.values !== null) continue;
    delete d.denominator;
    d.values = { ...d.values, ...Object.fromEntries(d.parent.derived.map((k) => [k, null])) };
  }
  return drafts.map((d) => ({
    period: d.period, section: d.section, dimension: d.dimension,
    cell: d.values === null ? { status: 'unmeasured' } : d.suppressed ? { status: 'suppressed' }
      : { status: 'ok', n: d.rows, ...(d.denominator === undefined ? {} : { denominator: d.denominator }), values: d.values },
  }));
}

/**
 * 作者：送審特徵 → 託管版本的成員 → 卡片作者公開 ID 對應的成員（再不行用卡片作者公開 ID 本身當鍵）。
 * 同一個人在三個來源都對到同一個成員 id，不會被數成好幾位。
 */
const AUTHOR = (sid: string) => `COALESCE(
  (SELECT author_member_id FROM review_submission_features WHERE submission_id=${sid}),
  (SELECT member_id FROM hosting_versions WHERE submission_id=${sid} LIMIT 1),
  (SELECT COALESCE(i.member_id,'card:'||c.provider||':'||c.author_num_id) FROM review_submissions rs JOIN cards c ON c.id=rs.card_id
    LEFT JOIN member_identities i ON i.provider=c.provider AND i.external_id=CAST(c.author_num_id AS TEXT) WHERE rs.id=${sid}))`;
const LIST = 'SELECT value FROM json_each(?)';

type Result = 'approved' | 'rejected';
interface DecisionRow { id: string; at: number; result: Result; reasons: string | null; author: string | null; submitted_at: number | null; base: number | null; opening: number | null; diff_state: string | null; base_kind: string | null; summary: string | null }
interface RejectRow { id: string; card_id: number; at: number; reasons: string | null; author: string | null; base: number | null }
interface CaseRow { id: string; opened_at: number; closed_at: number | null; close_reason: string | null; author: string | null }
interface DropRow { case_id: string; submission_id: string; created_at: number; restored_at: number | null; left_at: number | null; decided: string | null; author: string | null }

export async function reviewStats(db: D1Database, input: { now: number; weeks?: number }): Promise<ReviewStats> {
  const now = input.now;
  const weeks = input.weeks ?? DEFAULT_WEEKS;
  const end = weekStart(now), start = end - weeks * WEEK;
  const weekStarts = Array.from({ length: weeks }, (_, i) => isoDay(start + i * WEEK));
  const head = await db.prepare('SELECT MIN(at) AS first, (SELECT COUNT(*) FROM review_events WHERE at>=?1 AND at<?2) AS n FROM review_events').bind(start, end).first<{ first: number | null; n: number }>();
  const v2Recorded = head?.first != null;
  const v2Start = head?.first ?? V2_DEPLOYED_AT;
  const bEnd = v2Start, bStart = weekStart(v2Start) - weeks * WEEK;
  const bWeekStarts = Array.from({ length: Math.ceil((bEnd - bStart) / WEEK) }, (_, i) => isoDay(bStart + i * WEEK));
  const weekOf = (t: number) => isoDay(weekStart(t));
  const resubmitCutoff = now - RESUBMIT_DAYS * DAY, dropCutoff = now - DROP_OUTCOME_DAYS * DAY;

  const [decisionsQ, firstActionQ, rejectsQ, casesQ, sourcesQ, marksQ, opsQ, pendingQ, droppedQ, bDecisionsQ, bStampsQ] = await db.batch([
    // 首次生效定案（每單一筆；託管作品同步完成才算）
    db.prepare(`SELECT e.submission_id AS id, e.at, e.to_state AS result, e.reasons, ${AUTHOR('e.submission_id')} AS author,
        COALESCE((SELECT x.at FROM review_events x WHERE x.event_key='submit:'||e.submission_id), s.submitted_at) AS submitted_at,
        f.has_approved_base AS base, json_extract(f.features,'$.openingChars') AS opening,
        d.state AS diff_state, d.base_kind, d.summary
      FROM review_events e LEFT JOIN review_submissions s ON s.id=e.submission_id
      LEFT JOIN review_submission_features f ON f.submission_id=e.submission_id
      LEFT JOIN review_submission_diffs d ON d.submission_id=e.submission_id
      WHERE e.action='first_decision' AND e.to_state IN ('approved','rejected') AND e.at>=?1 AND e.at<?2`).bind(start, end),
    // 首個人工處置：只算有送審事件的單（V2 起送審的），送審時間才可靠、也確定之前沒有沒記到的處置
    db.prepare(`WITH firsts AS (SELECT submission_id, MIN(at) AS at FROM review_events
        WHERE actor_kind='reviewer' AND action IN (${FIRST_ACTIONS.map((a) => `'${a}'`).join(',')}) AND submission_id IS NOT NULL GROUP BY submission_id)
      SELECT x.at, sub.at AS submitted_at, ${AUTHOR('x.submission_id')} AS author
      FROM firsts x JOIN review_events sub ON sub.event_key='submit:'||x.submission_id
      WHERE x.at>=?1 AND x.at<?2`).bind(start, end),
    // 已滿 14 天的首次定案駁回
    db.prepare(`SELECT e.submission_id AS id, e.card_id, e.at, e.reasons, ${AUTHOR('e.submission_id')} AS author, f.has_approved_base AS base
      FROM review_events e LEFT JOIN review_submission_features f ON f.submission_id=e.submission_id
      WHERE e.action='first_decision' AND e.to_state='rejected' AND e.at>=?1 AND e.at<?2 AND e.at<=?3`).bind(start, end, resubmitCutoff),
    // 已滿 7 天的不受理案件（依入案時間分週）
    db.prepare(`SELECT id, opened_at, closed_at, close_reason, author_member_id AS author FROM review_drop_cases WHERE opened_at>=?1 AND opened_at<?2 AND opened_at<=?3`).bind(start, end, dropCutoff),
    db.prepare(`SELECT d.source, d.created_at AS at, COALESCE(${AUTHOR('d.submission_id')}, k.author_member_id) AS author
      FROM review_drops d JOIN review_drop_cases k ON k.id=d.case_id WHERE d.created_at>=?1 AND d.created_at<?2`).bind(start, end),
    db.prepare(`SELECT author_member_id AS author, kind, value, auto_value, rule_version, created_at AS at FROM review_author_marks WHERE created_at>=?1 AND created_at<?2`).bind(start, end),
    db.prepare(`SELECT e.action, e.at, ${AUTHOR('e.submission_id')} AS author FROM review_events e WHERE e.actor_kind='reviewer' AND e.at>=?1 AND e.at<?2`).bind(start, end),
    // 存量（資料截至時）：待審＝作者送審、未定案、不在不受理清單；不受理＝清單上的單，年齡從案件起點算
    db.prepare(`SELECT s.submitted_at AS at, ${AUTHOR('s.id')} AS author FROM review_submissions s
      WHERE s.status='pending' AND s.reopen_of IS NULL AND NOT EXISTS(SELECT 1 FROM review_drops d WHERE d.submission_id=s.id AND d.restored_at IS NULL)`),
    db.prepare(`SELECT k.opened_at AS at, COALESCE(k.author_member_id, ${AUTHOR('s.id')}) AS author FROM review_drops d
      JOIN review_drop_cases k ON k.id=d.case_id JOIN review_submissions s ON s.id=d.submission_id WHERE d.restored_at IS NULL AND s.status='pending'`),
    // V2 前基線：只能從審核單現況回溯（之後改判過的單是改判後的狀態），理由是自由文字、不分類
    db.prepare(`SELECT s.status AS result, s.decided_at AS at, s.submitted_at, ${AUTHOR('s.id')} AS author FROM review_submissions s
      WHERE s.reopen_of IS NULL AND s.status IN ('approved','rejected') AND s.decided_at>=?1 AND s.decided_at<?2`).bind(bStart, bEnd),
    db.prepare(`SELECT st.verdict, st.created_at AS at, ${AUTHOR('st.submission_id')} AS author FROM review_stamps st WHERE st.created_at>=?1 AND st.created_at<?2`).bind(bStart, bEnd),
  ]);
  const rows = <T>(r: D1Result<unknown> | undefined) => (r?.results ?? []) as T[];
  const decisions = rows<DecisionRow>(decisionsQ);
  const rejects = rows<RejectRow>(rejectsQ);
  const cases = rows<CaseRow>(casesQ);

  // 駁回後的下一張同卡作者新單、案件裡的每一張單：要先知道卡號與案件才查得到
  const cardIds = [...new Set(rejects.map((r) => Number(r.card_id)))];
  const caseIds = cases.map((c) => c.id);
  const [candidatesQ, dropsQ] = await db.batch([
    // 送審事件為主（舊流程撤銷登記會刪待審單，事件留著）；V2 之前就在的單用審核單本身
    db.prepare(`SELECT x.submission_id AS id, x.card_id, x.at, (SELECT to_state FROM review_events y WHERE y.event_key='first:'||x.submission_id) AS decided
        FROM review_events x WHERE x.action='submit' AND x.card_id IN (${LIST})
      UNION ALL SELECT s.id, CAST(s.card_id AS INTEGER), s.submitted_at, (SELECT to_state FROM review_events y WHERE y.event_key='first:'||s.id) FROM review_submissions s
        WHERE s.reopen_of IS NULL AND CAST(s.card_id AS INTEGER) IN (${LIST})`).bind(JSON.stringify(cardIds), JSON.stringify(cardIds)),
    db.prepare(`SELECT d.case_id, d.submission_id, d.created_at, d.restored_at,
        (SELECT MIN(x.at) FROM review_events x WHERE x.submission_id=d.submission_id AND x.action IN ('superseded','first_decision')) AS left_at,
        (SELECT to_state FROM review_events x WHERE x.event_key='first:'||d.submission_id) AS decided,
        ${AUTHOR('d.submission_id')} AS author
      FROM review_drops d WHERE d.case_id IN (${LIST})`).bind(JSON.stringify(caseIds)),
  ]);

  const drafts: Draft[] = [];
  const P = weekStarts;
  const valued = (values: CellValues, denominator?: number) => ({ values, ...(denominator === undefined ? {} : { denominator }) });

  // ---- 首次定案通過率（每單只算第一次生效定案） ----
  const dec = new Grid<DecisionRow>('decisions', P, ['all']);
  for (const r of decisions) dec.add('all', { week: weekOf(r.at), author: r.author, data: r });
  const passCounts = (xs: DecisionRow[]) => {
    const approved = xs.filter((x) => x.result === 'approved').length, rejected = xs.length - approved;
    return { approved, rejected, rate: ratio(approved, xs.length) };
  };
  drafts.push(...dec.drafts((xs) => valued(passCounts(xs))));

  // ---- 等待：送審 → 首個人工處置；送審 → 首次定案（中位數、第 90 百分位、樣本數＝n） ----
  const waitCells = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return valued({ medianMs: percentile(s, 0.5), p90Ms: percentile(s, 0.9) }); };
  const waits = new Grid<number>('waits', P, ['first_action', 'first_decision']);
  for (const r of rows<{ at: number; submitted_at: number; author: string | null }>(firstActionQ)) waits.add('first_action', { week: weekOf(r.at), author: r.author, data: Math.max(0, r.at - r.submitted_at) });
  for (const r of decisions) if (r.submitted_at !== null) waits.add('first_decision', { week: weekOf(r.at), author: r.author, data: Math.max(0, r.at - r.submitted_at) });
  drafts.push(...waits.drafts(waitCells));

  // ---- 駁回理由：各理由的駁回單 ÷ 有代碼的駁回單（多選，合計可超過 100%）；有代碼的 ÷ 全部駁回 ----
  const rejected = decisions.filter((r) => r.result === 'rejected');
  const reasons = new Grid<DecisionRow>('reasons', P, REASON_CODES);
  const coverage = new Grid<DecisionRow>('reasons', P, ['coverage']);
  const coded = new Map<string, number>();
  for (const r of rejected) {
    const codes = parseReviewReasons(r.reasons);
    const week = weekOf(r.at);
    coverage.add('coverage', { week, author: r.author, data: r });
    if (codes.length) for (const p of [week, 'all']) coded.set(p, (coded.get(p) ?? 0) + 1);
    for (const code of codes) reasons.add(code, { week, author: r.author, data: r });
  }
  drafts.push(...coverage.drafts((xs, period) => valued({ coded: coded.get(period) ?? 0, rejects: xs.length, rate: ratio(coded.get(period) ?? 0, xs.length) })));
  drafts.push(...reasons.drafts((xs, period) => valued({ count: xs.length, share: ratio(xs.length, coded.get(period) ?? 0) }, coded.get(period) ?? 0))
    .map((d) => ({ ...d, parent: { section: 'reasons', dimension: 'coverage', derived: ['share'] } })));

  // ---- 駁回後 14 天內再送（只算已滿 14 天的駁回；依原駁回的每個理由各算一次，多選可跨列） ----
  const candidates = new Map<string, { at: number; decided: string | null; card: number }>();
  for (const c of rows<{ id: string; card_id: number; at: number; decided: string | null }>(candidatesQ)) {
    const prev = candidates.get(c.id);
    // 同一張單事件與審核單各一列：用較早的時間
    if (!prev || c.at < prev.at) candidates.set(c.id, { at: c.at, decided: c.decided ?? prev?.decided ?? null, card: Number(c.card_id) });
  }
  const byCard = new Map<number, { id: string; at: number; decided: string | null }[]>();
  for (const [id, c] of candidates) byCard.set(c.card, [...(byCard.get(c.card) ?? []), { id, at: c.at, decided: c.decided }]);
  type Resubmit = { resubmitted: boolean; decided: string | null };
  const resubmit = new Grid<Resubmit>('resubmit', P, ['all', ...REASON_CODES.map((c) => `reason:${c}`), 'reason:none', 'base:yes', 'base:no', 'base:unknown']);
  for (const r of rejects) {
    // 下一張同卡作者新單（每張新單只配對它之前最近一次駁回：同卡一次只會有一張待審，所以「駁回之後最早的那張」就是）
    const next = (byCard.get(Number(r.card_id)) ?? []).filter((c) => c.id !== r.id && c.at > r.at).sort((a, b) => a.at - b.at)[0];
    const data = { resubmitted: !!next && next.at < r.at + RESUBMIT_DAYS * DAY, decided: next && next.at < r.at + RESUBMIT_DAYS * DAY ? next.decided : null };
    const item = { week: weekOf(r.at), author: r.author, data };
    resubmit.add('all', item);
    const codes = parseReviewReasons(r.reasons);
    for (const code of codes) resubmit.add(`reason:${code}`, item);
    if (!codes.length) resubmit.add('reason:none', item);
    resubmit.add(r.base === null ? 'base:unknown' : r.base ? 'base:yes' : 'base:no', item);
  }
  const resubmitDrafts = resubmit.drafts((xs) => {
    const re = xs.filter((x) => x.resubmitted);
    const decidedN = re.filter((x) => x.decided === 'approved' || x.decided === 'rejected').length, approved = re.filter((x) => x.decided === 'approved').length;
    return valued({ resubmitted: re.length, rate: ratio(re.length, xs.length), decided: decidedN, approved, passRate: ratio(approved, decidedN) });
  });
  // 有沒有過審基準三組互斥：互補格只套在這三格
  for (const d of resubmitDrafts) d.partition = d.dimension.startsWith('base:');
  drafts.push(...resubmitDrafts);

  // ---- 不受理：入案滿 7 天的案件，重建第 7 天的狀態（不看現在的結案原因） ----
  const dropsByCase = new Map<string, DropRow[]>();
  for (const d of rows<DropRow>(dropsQ)) dropsByCase.set(d.case_id, [...(dropsByCase.get(d.case_id) ?? []), d]);
  const outcome = new Grid<string>('drop_outcome', P, ['all']);
  const outcomes = new Grid<string>('drop_outcome.result', P, DROP_OUTCOMES);
  const restoredResult = new Grid<string>('drop_restored', P, RESTORED_RESULTS);
  const restoredAll = new Grid<string>('drop_restored', P, ['all']);
  for (const k of cases) {
    const drops = dropsByCase.get(k.id) ?? [];
    const author = k.author ?? drops[0]?.author ?? null;
    const t7 = k.opened_at + DROP_OUTCOME_DAYS * DAY;
    let state: (typeof DROP_OUTCOMES)[number];
    if (k.closed_at !== null && k.closed_at <= t7) state = k.close_reason === 'restored' ? 'restored' : k.close_reason === 'resubmitted_changed' ? 'resubmitted_changed' : 'other';
    else {
      // 第 7 天還有一張在清單上、還沒離開待審的單＝仍不受理；否則作者撤回了、也還沒原樣再送
      const active = drops.some((d) => d.created_at <= t7 && (d.restored_at === null || d.restored_at > t7) && (d.left_at === null || d.left_at > t7));
      state = active ? 'still_dropped' : 'withdrawn';
    }
    const week = weekOf(k.opened_at);
    outcome.add('all', { week, author, data: state });
    outcomes.add(state, { week, author, data: state });
    if (k.close_reason === 'restored') {
      // 復原之後那張單現在的結果
      const d = drops.filter((x) => x.restored_at !== null).sort((a, b) => b.restored_at! - a.restored_at!)[0];
      const result = !d ? 'pending' : d.decided === 'approved' || d.decided === 'rejected' ? d.decided : d.left_at !== null ? 'withdrawn' : 'pending';
      restoredResult.add(result, { week, author, data: result });
      restoredAll.add('all', { week, author, data: result });
    }
  }
  const outcomeTotals = new Map<string, number>();
  for (const d of outcome.drafts((xs) => valued({ count: xs.length }))) { drafts.push({ ...d, section: 'drop_outcome' }); outcomeTotals.set(d.period, d.rows); }
  drafts.push(...outcomes.drafts((xs, period) => valued({ count: xs.length, share: ratio(xs.length, outcomeTotals.get(period) ?? 0) }, outcomeTotals.get(period) ?? 0), true)
    .map((d) => ({ ...d, section: 'drop_outcome', parent: { section: 'drop_outcome', dimension: 'all', derived: ['share'] } })));
  const restoredTotals = new Map<string, number>();
  for (const d of restoredAll.drafts((xs) => valued({ count: xs.length }))) { drafts.push(d); restoredTotals.set(d.period, d.rows); }
  drafts.push(...restoredResult.drafts((xs, period) => valued({ count: xs.length, share: ratio(xs.length, restoredTotals.get(period) ?? 0) }, restoredTotals.get(period) ?? 0), true)
    .map((d) => ({ ...d, parent: { section: 'drop_restored', dimension: 'all', derived: ['share'] } })));

  // 不受理的來源：人工移出（單張／同作者批量／同裝置批量）與同內容自動移出，依移出時間分週
  const sources = new Grid<null>('drop_source', P, DROP_SOURCES);
  for (const r of rows<{ source: string; at: number; author: string | null }>(sourcesQ)) sources.add(r.source, { week: weekOf(r.at), author: r.author, data: null });
  drafts.push(...sources.drafts((xs) => valued({ count: xs.length })));

  // ---- 更新內容與結果：有沒有基準、改了哪些欄（粗分組，一張可跨多組） ----
  const updatesBase = new Grid<DecisionRow>('updates', P, UPDATE_BASES.map((b) => `base:${b}`));
  const updatesField = new Grid<DecisionRow>('updates', P, FIELD_GROUPS.map((g) => `field:${g}`));
  for (const r of decisions) {
    const item = { week: weekOf(r.at), author: r.author, data: r };
    const base = r.diff_state === null ? 'none' : r.diff_state === 'done' ? (r.base_kind === 'rejected' ? 'rejected' : 'approved') : 'missing';
    updatesBase.add(`base:${base}`, item);
    if (r.diff_state !== 'done' || !r.summary) continue;
    for (const g of fieldGroups(r.summary)) updatesField.add(`field:${g}`, item);
  }
  const updateCells = (xs: DecisionRow[]) => {
    const rej = xs.filter((x) => x.result === 'rejected').length;
    const w = xs.filter((x) => x.submitted_at !== null).map((x) => x.at - x.submitted_at!).sort((a, b) => a - b);
    return valued({ rejected: rej, rejectRate: ratio(rej, xs.length), medianWaitMs: percentile(w, 0.5) });
  };
  drafts.push(...updatesBase.drafts(updateCells, true).map((d) => ({ ...d, partition: true })));
  drafts.push(...updatesField.drafts(updateCells));

  // ---- 開場白字數五段與結果 ----
  const opening = new Grid<DecisionRow>('opening', P, OPENING_DIMS);
  for (const r of decisions) {
    const n = typeof r.opening === 'number' ? r.opening : null;
    const bucket = n === null ? 'missing' : OPENING_BUCKETS.find(([, max]) => n < max)![0];
    opening.add(bucket, { week: weekOf(r.at), author: r.author, data: r });
  }
  drafts.push(...opening.drafts((xs) => { const c = passCounts(xs); return valued({ approved: c.approved, rejected: c.rejected, rejectRate: ratio(c.rejected, xs.length) }); }, true));

  // ---- 標記覆寫：每作者每週每類標記算一次。分母「該週看過這版側寫的作者」沒有記錄：比例量不到 ----
  type Mark = { author: string; week: string; kind: string; change: string };
  const markRows = rows<{ author: string; kind: string; value: string; auto_value: string | null; rule_version: number; at: number }>(marksQ);
  // 現行規則版本一定開格子：沒有人改過標記是真的 0，不是量不到
  const versions = [...new Set([PROFILE_RULE_VERSION, ...markRows.map((m) => m.rule_version)])].sort((a, b) => a - b);
  const marks = new Grid<Mark>('marks', P, versions.map((v) => `v${v}`));
  const seen = new Set<string>();
  for (const m of markRows.sort((a, b) => a.at - b.at)) {
    const week = weekOf(m.at);
    const key = `${m.rule_version}|${m.author}|${week}|${m.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const change = markChange(m.kind, m.value, m.auto_value);
    const data = { author: m.author, week, kind: m.kind, change };
    marks.add(`v${m.rule_version}`, { week, author: m.author, data });
    marks.add(`v${m.rule_version}:${m.kind}:${change}`, { week, author: m.author, data });
  }
  drafts.push(...marks.drafts((xs) => valued({ authors: new Set(xs.map((x) => x.author)).size })));
  for (const v of versions) for (const p of [...P, 'all']) drafts.push({ period: p, section: 'marks', dimension: `v${v}:rate`, rows: 0, authors: 0, values: null, suppressed: false });

  // ---- 人工作業數（蓋章、駁回、冷凍、不受理、復原…；依事件時間） ----
  const ops = new Grid<null>('operations', P, OPERATIONS);
  for (const r of rows<{ action: string; at: number; author: string | null }>(opsQ)) ops.add(r.action, { week: weekOf(r.at), author: r.author, data: null });
  drafts.push(...ops.drafts((xs) => valued({ count: xs.length })));

  // ---- 存量（資料截至時） ----
  const stock = (dimension: string, xs: { at: number; author: string | null }[]): Draft => ({
    period: 'now', section: 'stock', dimension, rows: xs.length, authors: new Set(xs.map((x) => x.author).filter(Boolean)).size, suppressed: false,
    values: { count: xs.length, oldestDays: xs.length ? Math.floor((now - Math.min(...xs.map((x) => x.at))) / DAY) : null },
  });
  drafts.push(stock('pending', rows(pendingQ)), stock('dropped', rows(droppedQ)));

  // ---- V2 前基線（現況回溯，跟 V2 分開呈現、不加總） ----
  const bWeekOf = weekOf;
  const bDec = new Grid<{ result: string; wait: number }>('baseline.decisions', bWeekStarts, ['all']);
  const bWait = new Grid<number>('baseline.waits', bWeekStarts, ['first_decision']);
  for (const r of rows<{ result: string; at: number; submitted_at: number; author: string | null }>(bDecisionsQ)) {
    const week = bWeekOf(r.at);
    bDec.add('all', { week, author: r.author, data: { result: r.result, wait: r.at - r.submitted_at } });
    bWait.add('first_decision', { week, author: r.author, data: Math.max(0, r.at - r.submitted_at) });
  }
  drafts.push(...bDec.drafts((xs) => { const approved = xs.filter((x) => x.result === 'approved').length; return valued({ approved, rejected: xs.length - approved, rate: ratio(approved, xs.length) }); }));
  drafts.push(...bWait.drafts(waitCells));
  const bStamps = new Grid<null>('baseline.stamps', bWeekStarts, ['approve', 'reject']);
  for (const r of rows<{ verdict: string; at: number; author: string | null }>(bStampsQ)) if (r.verdict === 'approve' || r.verdict === 'reject') bStamps.add(r.verdict, { week: bWeekOf(r.at), author: r.author, data: null });
  drafts.push(...bStamps.drafts((xs) => valued({ count: xs.length })));
  for (const p of [...bWeekStarts, 'all']) drafts.push({ period: p, section: 'baseline.reasons', dimension: 'all', rows: 0, authors: 0, values: null, suppressed: false });

  return {
    specVersion: REVIEW_SPEC_VERSION, generatedAt: now, weeks,
    window: { start, end, weekStarts },
    baseline: { start: bStart, end: bEnd, weekStarts: bWeekStarts },
    v2StartedAt: v2Start, v2Recorded, empty: (head?.n ?? 0) === 0,
    thresholds: { rows: MIN_ROWS, authors: MIN_AUTHORS },
    rows: suppress(drafts),
  };
}

/** 差異摘要 → 改動欄位粗分組；沒有任何改動是 unchanged */
function fieldGroups(raw: string): Set<string> {
  const out = new Set<string>();
  try {
    const s = JSON.parse(raw) as { changedFields?: string[]; worldbook?: { added: number; removed: number; modified: number }; rules?: { added: number; removed: number; modified: number }; unchanged?: boolean };
    for (const f of s.changedFields ?? []) out.add(f.startsWith('asset.') ? 'presentation' : FIELD_GROUP_OF[f] ?? 'setting');
    if (s.worldbook && (s.worldbook.added || s.worldbook.removed || s.worldbook.modified)) out.add('lorebook');
    if (s.rules && (s.rules.added || s.rules.removed || s.rules.modified)) out.add('rules');
    if (s.unchanged || !out.size) out.add('unchanged');
  } catch { /* 摘要壞掉：不歸任何欄位組，base 仍算 */ }
  return out;
}

/** 覆寫方向：取消（none／clear）、加標（自動值沒有標記）、改標（自動值是另一個標記） */
function markChange(kind: string, value: string, auto: string | null): 'add' | 'cancel' | 'change' {
  if (value === 'none' || value === 'clear') return 'cancel';
  const unmarked = auto === null || auto === '' || (kind === 'tier' ? auto === 'general' || auto === 'unknown' : auto !== 'suspected');
  return unmarked ? 'add' : 'change';
}

/** 給頁面：只有窗口總計（all）與存量（now）；週別的格子只進 CSV */
export function statsJson(s: ReviewStats) {
  const cells: Record<string, Record<string, Cell>> = {};
  for (const r of s.rows) {
    if (r.period !== 'all' && r.period !== 'now') continue;
    (cells[r.section] ??= {})[r.dimension] = r.cell;
  }
  // 最早一筆事件的時刻只給到 UTC 日（頁面只顯示日期）
  const { rows: _rows, ...meta } = s;
  return { ...meta, v2StartedAt: utcDayStart(s.v2StartedAt), baseline: { ...s.baseline, end: utcDayStart(s.baseline.end) }, cells };
}

const csvField = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csvNumber = (v: number | null) => (v === null ? '' : Number.isInteger(v) ? String(v) : String(Math.round(v * 10_000) / 10_000));

/**
 * 管理員匯出：同一份已抑制的格子，一個值一列。欄位＝UTC 週、區塊（含值名）、維度、值、分母。
 * 不含單筆資料、作品／帳號／審核員識別、裝置、精確時間與備註；被抑制的格子只寫 suppressed，量不到寫 unmeasured。
 */
export function statsCsv(s: ReviewStats): string {
  const lines = ['utc_week,section,dimension,value,denominator'];
  const total = `${isoDay(s.window.start)}..${isoDay(s.window.end)}`;
  const bTotal = `${isoDay(s.baseline.start)}..${isoDay(s.baseline.end)}`;
  lines.push(['', 'meta.spec_version', '', String(s.specVersion), ''].join(','));
  lines.push(['', 'meta.data_as_of', '', isoDay(s.generatedAt), ''].join(','));
  for (const r of s.rows) {
    const week = r.period === 'all' ? (r.section.startsWith('baseline.') ? bTotal : total) : r.period === 'now' ? 'as_of' : r.period;
    const head = (section: string) => [week, section, r.dimension].map(csvField);
    if (r.cell.status !== 'ok') { lines.push([...head(r.section), r.cell.status, ''].join(',')); continue; }
    const denominator = String(r.cell.denominator ?? r.cell.n);
    for (const [k, v] of Object.entries(r.cell.values)) lines.push([...head(`${r.section}.${k}`), csvNumber(v), denominator].join(','));
  }
  return lines.join('\n') + '\n';
}

export function parseWeeks(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_WEEKS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_WEEKS) throw new HttpError(400, 'review_stats_weeks_invalid');
  return n;
}

/** 管理員與擁有者；一般審核員、作者、未登入一律 403／401 */
async function requireStatsManager(c: Parameters<typeof requireMember>[0]) {
  const member = await requireMember(c);
  const role = await reviewerRole(c.env.DB, member.id);
  if (role !== 'manager' && role !== 'owner') throw new HttpError(403, 'review_stats_manager_required');
  return member;
}

export const reviewStatsRoutes = new Hono<{ Bindings: Env }>();

reviewStatsRoutes.get('/v1/review/stats', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  try {
    await requireStatsManager(c);
    const stats = await reviewStats(c.env.DB, { now: Date.now(), weeks: parseWeeks(c.req.query('weeks')) });
    await bumpOp(c.env.DB, 'review_stats', 'read', 'success');
    return c.json(statsJson(stats));
  } catch (error) {
    await bumpOp(c.env.DB, 'review_stats', 'read', error instanceof HttpError && [401, 403].includes(error.status) ? 'denied' : 'error');
    throw error;
  }
});

reviewStatsRoutes.get('/v1/review/stats/export', async (c) => {
  try {
    await requireStatsManager(c);
    const stats = await reviewStats(c.env.DB, { now: Date.now(), weeks: parseWeeks(c.req.query('weeks')) });
    await bumpOp(c.env.DB, 'review_stats', 'export', 'success');
    return new Response(statsCsv(stats), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="review-stats-${isoDay(stats.window.end)}.csv"`,
      },
    });
  } catch (error) {
    await bumpOp(c.env.DB, 'review_stats', 'export', error instanceof HttpError && [401, 403].includes(error.status) ? 'denied' : 'error');
    throw error;
  }
});
