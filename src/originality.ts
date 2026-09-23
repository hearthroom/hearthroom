import { TO_HANS } from "./originality-hans";
import { type Localized, pickLocale } from "./types";

/**
 * 角色設定查重：給審核人的參考，不自動擋卡、作者看不到（owner 2026-09-23）。
 *
 * 做法照論文查重（MOSS／知網一類），純計算、不用模型：
 *   1. 正規化：全半形、大小寫、繁簡（逐字）、標點與空白都抹平；卡片自己的角色名與使用者名
 *      換成同一個佔位，改名不改文的複製照樣抓得到。
 *   2. 切單位：中日韓一個字一個單位，拉丁字母一個詞一個單位。
 *   3. 連續 K 個單位算一個雜湊，再用 winnowing（Schleimer 等 2003）每 W 個挑最小的當指紋：
 *      兩篇只要有連續 K+W-1（=13）個單位相同，就保證至少共有一個指紋——跟知網「連續 13 字」同一條線。
 *   4. 倒排索引：指紋 → 哪張卡。新卡的指紋拿去查，命中的 K-gram 在新卡上圈出來，
 *      連續不到 MIN_RUN 個單位的零星命中不算（常見短語）；出現在太多張卡的指紋當套語丟掉。
 *   5. 相似度＝新卡被圈到的單位數 ÷ 總單位數。整體看全部來源的聯集，另列單一來源最高的幾張。
 *
 * 只存指紋、不存原文：資料庫還原不出任何人的角色設定；審核人看到的標示只在新卡這一側。
 * 抓不到的：翻譯、改寫、站外來源；「先送審」也不等於原作者。這些要寫在審核頁上。
 *
 * 參數改了指紋就不相容，ALGORITHM 要跟著換；舊版本的指紋查詢時直接不看。
 */
export const ALGORITHM = "wn1";
export const K = 8;
export const W = 6;
export const MIN_RUN = K + W - 1;
/** 同一個指紋出現在這麼多張不同的卡，就當成大家都在用的套語。 */
export const COMMON_CARDS = 5;
/**
 * 一張卡最多進索引／拿去查的指紋數。雜湊整串當一個 JSON 參數綁進 D1，單一字串上限 2 MB；
 * 六萬個約 1 MB，約可涵蓋前二十萬字。超過的部分不比對，但送審不會因此失敗。
 */
export const MAX_PRINTS = 60_000;
/** 審核頁列出的來源上限。 */
export const TOP_SOURCES = 5;

export interface Unit { value: string; start: number; end: number }

const PLACEHOLDER = "\u0000";
const SEPARATE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD = /[\p{L}\p{N}\p{M}]/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 名字出現的位置（原文偏移）。一個字的名字不換：「你」「我」換掉會把正文也抹了。 */
function nameRanges(text: string, names: string[]): [number, number][] {
  const list = [...new Set(["{{char}}", "{{user}}", ...names.map((n) => n.trim())])]
    .filter((n) => [...n].length >= 2)
    .sort((a, b) => b.length - a.length);
  const re = new RegExp(list.map(escape).join("|"), "giu");
  const out: [number, number][] = [];
  for (const m of text.matchAll(re)) out.push([m.index, m.index + m[0].length]);
  return out;
}

/** 文字切成比對單位，每個單位記著它在原文的位置。 */
export function toUnits(text: string, names: string[] = []): Unit[] {
  const out: Unit[] = [];
  const ranges = nameRanges(text, names);
  let r = 0;
  let word: Unit | null = null;
  const flush = () => { if (word) out.push(word); word = null; };
  let i = 0;
  while (i < text.length) {
    if (r < ranges.length && ranges[r][0] === i) {
      flush();
      out.push({ value: PLACEHOLDER, start: i, end: ranges[r][1] });
      i = ranges[r][1];
      r++;
      continue;
    }
    const cp = String.fromCodePoint(text.codePointAt(i)!);
    const end = i + cp.length;
    for (const ch of cp.normalize("NFKC").toLowerCase()) {
      const c = TO_HANS.get(ch) ?? ch;
      if (SEPARATE.test(c)) {
        flush();
        out.push({ value: c, start: i, end });
      } else if (WORD.test(c)) {
        if (word) { word.value += c; word.end = end; } else word = { value: c, start: i, end };
      } else flush();
    }
    i = end;
  }
  flush();
  return out;
}

/** cyrb53：同步、53 位元，放得進 JS 整數與 SQLite INTEGER。碰撞只會多一個候選，不影響圈選。 */
function hash53(s: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export interface Print { hash: number; pos: number }

/** Winnowing：每 W 個連續 K-gram 雜湊取最小（同值取最右），換了才記。 */
export function fingerprints(units: Unit[]): Print[] {
  const n = units.length - K + 1;
  if (n <= 0) return [];
  const hs: number[] = [];
  for (let i = 0; i < n; i++) hs.push(hash53(units.slice(i, i + K).map((u) => u.value).join("\u0001")));
  const out: Print[] = [];
  let last = -1;
  for (let s = 0; s + Math.min(W, n) <= n; s++) {
    let min = s;
    for (let j = s; j < s + Math.min(W, n); j++) if (hs[j] <= hs[min]) min = j;
    if (min !== last) { out.push({ hash: hs[min], pos: min }); last = min; }
  }
  return out;
}

/** 去重後的指紋雜湊，依原文位置由前往後，最多 MAX_PRINTS 個。 */
export function printHashes(prints: Print[]): number[] {
  return [...new Set(prints.map((p) => p.hash))].slice(0, MAX_PRINTS);
}

/** 命中的 K-gram 起點 → 連續覆蓋的單位區段 [start, end)；短於 MIN_RUN 的丟掉。 */
export function coveredRuns(positions: number[], total: number): [number, number][] {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const p of sorted) {
    const end = Math.min(p + K, total);
    const cur = runs[runs.length - 1];
    if (cur && p <= cur[1]) cur[1] = Math.max(cur[1], end);
    else runs.push([p, end]);
  }
  return runs.filter(([a, b]) => b - a >= MIN_RUN);
}

const coveredCount = (runs: [number, number][]) => runs.reduce((n, [a, b]) => n + b - a, 0);
const toChars = (units: Unit[], runs: [number, number][]): [number, number][] => runs.map(([a, b]) => [units[a].start, units[b - 1].end]);
const ratio = (n: number, total: number) => Math.round((n / total) * 1000) / 1000;

export interface OriginalityInput { submissionId: string; cardId: string; memberId: string; text: string; names: string[]; now: number }

/**
 * 送審那一刻把新卡的指紋寫進索引，跟審核單同一批寫入（單子沒寫成就不留指紋）。
 * 太短、湊不出一個指紋的就不寫。
 */
export function indexStatements(db: D1Database, input: OriginalityInput): D1PreparedStatement[] {
  const units = toUnits(input.text, input.names);
  const prints = fingerprints(units);
  if (!prints.length) return [];
  return [
    db.prepare(
      `INSERT INTO originality_texts (submission_id, card_id, member_id, algorithm, unit_count, created_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM review_submissions WHERE id = ?)`,
    ).bind(input.submissionId, input.cardId, input.memberId, ALGORITHM, units.length, input.now, input.submissionId),
    db.prepare(
      `INSERT OR IGNORE INTO originality_prints (hash, text_id)
       SELECT DISTINCT j.value, t.id FROM json_each(?) j JOIN originality_texts t ON t.submission_id = ?`,
    ).bind(JSON.stringify(printHashes(prints)), input.submissionId),
  ];
}

export interface OriginalitySource {
  cardId: string;
  name: string;
  /** approved＝在榜上；pending＝也在排隊；removed＝作者已撤下，指紋還留著 */
  status: "approved" | "pending" | "removed";
  /** 那張卡第一次進索引的時間 */
  firstSeenAt: number;
  /** 比這張單早進索引 */
  earlier: boolean;
  similarity: number;
  /** 新卡角色設定裡跟這張卡重複的原文區段 [start, end) */
  segments: [number, number][];
}

export type OriginalityReport =
  | { available: false; reason: "no_snapshot" | "too_short" }
  | { available: true; similarity: number; units: number; comparedCards: number; segments: [number, number][]; sources: OriginalitySource[] };

/** 審核頁要的查重結果。每次現算：語料一直在長，後面才送審的卡也會出現在結果裡。 */
export async function originalityReport(
  db: D1Database,
  submission: { id: string; submitted_at: number },
  detail: Record<string, any> | null,
  lang: string,
): Promise<OriginalityReport> {
  const doc = detail && !detail.partial ? detail.document : null;
  if (!doc) return { available: false, reason: "no_snapshot" };
  const units = toUnits(String(doc.roleDetailDesc ?? ""), [String(doc.roleName ?? ""), String(doc.userName ?? "")]);
  const prints = fingerprints(units);
  if (units.length < MIN_RUN || !prints.length) return { available: false, reason: "too_short" };

  // 作者自己的其他卡不算：同一個人沿用自己的設定不是抄襲
  const self = await db.prepare(
    "SELECT COALESCE((SELECT member_id FROM hosting_versions WHERE submission_id = ?), (SELECT member_id FROM originality_texts WHERE submission_id = ?)) AS m",
  ).bind(submission.id, submission.id).first<{ m: string | null }>();
  const member = self?.m ?? "";
  const live = `t.algorithm = ? AND t.member_id <> ? AND t.submission_id <> ?
    AND EXISTS (SELECT 1 FROM review_submissions s WHERE s.id = t.submission_id AND s.status IN ('pending', 'approved'))`;

  const hits = await db.prepare(
    `WITH q AS (SELECT DISTINCT value AS hash FROM json_each(?)),
     hits AS (SELECT f.hash, t.card_id FROM q JOIN originality_prints f ON f.hash = q.hash JOIN originality_texts t ON t.id = f.text_id WHERE ${live})
     SELECT DISTINCT hash, card_id FROM hits
     WHERE hash NOT IN (SELECT hash FROM hits GROUP BY hash HAVING COUNT(DISTINCT card_id) >= ?)
     LIMIT 50000`,
  ).bind(JSON.stringify(printHashes(prints)), ALGORITHM, member, submission.id, COMMON_CARDS)
    .all<{ hash: number; card_id: string }>();
  const compared = await db.prepare(`SELECT COUNT(DISTINCT t.card_id) AS n FROM originality_texts t WHERE ${live}`)
    .bind(ALGORITHM, member, submission.id).first<{ n: number }>();

  const byCard = new Map<string, Set<number>>();
  for (const h of hits.results) {
    const set = byCard.get(h.card_id) ?? new Set<number>();
    set.add(h.hash);
    byCard.set(h.card_id, set);
  }
  const positionsOf = (set: Set<number>) => prints.filter((p) => set.has(p.hash)).map((p) => p.pos);

  const ranked = [...byCard].map(([cardId, set]) => ({ cardId, runs: coveredRuns(positionsOf(set), units.length) }))
    .map((s) => ({ ...s, covered: coveredCount(s.runs) }))
    .filter((s) => s.covered > 0);
  const all = coveredRuns(positionsOf(new Set(ranked.flatMap((s) => [...byCard.get(s.cardId)!]))), units.length);
  ranked.sort((a, b) => b.covered - a.covered);

  const sources: OriginalitySource[] = [];
  for (const s of ranked.slice(0, TOP_SOURCES)) {
    const info = await db.prepare(
      `SELECT c.status AS card_status,
              COALESCE(c.names, (SELECT json_extract(v.public_role, '$.names') FROM hosting_versions v JOIN originality_texts t2 ON t2.submission_id = v.submission_id
                                 WHERE t2.card_id = ? ORDER BY t2.created_at DESC LIMIT 1)) AS names,
              (SELECT MIN(t.created_at) FROM originality_texts t WHERE t.card_id = ?) AS first_seen,
              EXISTS (SELECT 1 FROM review_submissions s JOIN originality_texts t ON t.submission_id = s.id WHERE t.card_id = ? AND s.status = 'approved') AS approved
       FROM (SELECT 1) LEFT JOIN cards c ON c.id = ?`,
    ).bind(s.cardId, s.cardId, s.cardId, s.cardId).first<{ card_status: string | null; names: string | null; first_seen: number; approved: number }>();
    let name = "";
    try { name = info?.names ? pickLocale(JSON.parse(info.names) as Localized, lang) : ""; } catch { name = ""; }
    sources.push({
      cardId: String(s.cardId),
      name,
      status: !info?.card_status ? "removed" : info.approved ? "approved" : "pending",
      firstSeenAt: info?.first_seen ?? 0,
      earlier: (info?.first_seen ?? Infinity) < submission.submitted_at,
      similarity: ratio(s.covered, units.length),
      segments: toChars(units, s.runs),
    });
  }
  return {
    available: true,
    similarity: ratio(coveredCount(all), units.length),
    units: units.length,
    comparedCards: compared?.n ?? 0,
    segments: toChars(units, all),
    sources,
  };
}
