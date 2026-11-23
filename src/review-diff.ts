/**
 * 更新送審的差異：審核人看這一版跟基準版（上次過審的版本；重送時是上次被駁回的版本）差在哪。
 *
 * 兩邊都是 projectForReview 投影出來的審核設定。比對刻意避開每次封存都會變的東西：
 * - 圖片網址（封面、背景、橫式背景、分享圖）：封存後的路徑每次都不同，比了只會全是噪音；
 * - 世界書的 worldbookId（每次封存都是新的）與 entryId（只是位置序號，頂端插一條全部位移）；
 * - 作者資產的 status 與 version。
 *
 * 字數用 effectiveCharacters，跟送審門檻同一把尺；以行為單位比對，所以在既有的一行尾巴加字，
 * 會算成整行刪掉再加回來（量級是給審核人參考的，不是逐字精算）。
 * 摘要（DiffSummary）只放數字與欄位鍵名，不放卡片原文，可以安全落庫。
 */
import { effectiveCharacters } from './review-length';

export interface EntryView { name: string; content: string; keywords: string[]; isEnabled: boolean; isConstant: boolean }
export interface FieldDiff { key: string; before: string; after: string }
export interface DiffSummary {
  changedFields: string[];
  setting: { charsAdded: number; charsRemoved: number };
  opening: { changed: boolean; charsBefore: number; charsAfter: number };
  worldbook: { added: number; removed: number; modified: number };
  rules: { added: number; removed: number; modified: number };
  tags: { added: number; removed: number };
  totalChanged: number;
  unchanged: boolean;
}
export type RuleChange = 'added' | 'removed' | 'modified';
export interface ReviewDiff {
  summary: DiffSummary;
  fields: FieldDiff[];
  worldbook: { added: EntryView[]; removed: EntryView[]; modified: { before: EntryView; after: EntryView }[] };
  rules: { added: number; removed: number; modified: number; items: { change: RuleChange; label: string }[] };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
const LIST_JOIN = '\n\n---\n\n';

/** 文字欄位，順序即 changedFields 的順序。 */
const TEXT_FIELDS: readonly [string, (doc: Obj, greetings: Obj) => string][] = [
  ['name', (d) => str(d.roleName)],
  ['summary', (d) => str(d.roleDesc)],
  ['setting', (d) => str(d.roleDetailDesc)],
  ['userName', (d) => str(d.userName)],
  ['instructions', (d) => str(d.customInstructions)],
  ['talkExample', (d) => str(d.talkExample)],
  ['outputContract', (d) => str(d.roleOutputContract)],
  ['speech', (d) => str(d.roleSpeech)],
  ['type', (d) => str(d.roleType)],
  ['sex', (d) => str(d.roleSex)],
  ['language', (d) => str(d.language)],
  ['tags', () => ''], // 特別處理：當集合比
  ['world', (d) => str(d.world)],
  ['opening', (_d, g) => str(g.welcome)],
  ['alternates', (_d, g) => strList(g.alternates).join(LIST_JOIN)],
  ['prologue', (_d, g) => strList(g.prologue).join(LIST_JOIN)],
];

/**
 * 作者資產裡規則以外、審核人看得到效果的欄位（開場網頁、卡片樣式、版面模式…）。
 * 規格只列了上面那些鍵；這幾個也照樣比，免得整頁開場網頁換掉了摘要還說「沒變」。
 * 鍵名帶 asset. 前綴，排在規格鍵之後。不要的話刪掉這個常數即可。
 */
const ASSET_FIELDS = ['openingPage', 'openingMode', 'cardFormat', 'cardCss', 'cardCssDialect', 'pageMode', 'mountTrigger', 'mountLayer'] as const;

/** 標籤：JSON 字串陣列、真陣列、{text}/{tagName} 物件都收；不是 JSON 的純字串以逗號切開。 */
function tagSet(v: unknown): Set<string> {
  let parsed: unknown = v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return new Set();
    try { parsed = JSON.parse(s); } catch { parsed = s.split(/[,，、]/); }
    if (typeof parsed === 'string') parsed = [parsed];
  }
  if (!Array.isArray(parsed)) return new Set();
  const names = parsed.map((t) => (typeof t === 'string' ? t : str(obj(t).text) || str(obj(t).tagName)).trim());
  return new Set(names.filter(Boolean));
}

/** 以行比對，回傳增刪行各自的有效字數。先削掉共同的頭尾，剩下的中段任一邊超過 2000 行就整段當換掉。 */
export function lineDelta(before: string, after: string): { added: number; removed: number } {
  if (before === after) return { added: 0, removed: 0 };
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  let removedLines: string[];
  let addedLines: string[];
  if (!midA.length || !midB.length || midA.length > 2000 || midB.length > 2000) {
    removedLines = midA;
    addedLines = midB;
  } else {
    const n = midA.length;
    const m = midB.length;
    const w = m + 1;
    // dp[i][j] = midA[i..] 與 midB[j..] 的 LCS 長度；長度不超過 2000，Uint16 夠用。
    const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = midA[i] === midB[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
      }
    }
    removedLines = [];
    addedLines = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { i++; j++; }
      else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) removedLines.push(midA[i++]!);
      else addedLines.push(midB[j++]!);
    }
    while (i < n) removedLines.push(midA[i++]!);
    while (j < m) addedLines.push(midB[j++]!);
  }
  return {
    added: addedLines.length ? effectiveCharacters(addedLines.join('\n')) : 0,
    removed: removedLines.length ? effectiveCharacters(removedLines.join('\n')) : 0,
  };
}

interface Entry { name: string; content: string; keywords: string[]; secondaryKeywords: string[]; category: string; isEnabled: boolean; isConstant: boolean; triggerRegion: string }

function entriesOf(settings: Obj): Entry[] {
  const books = Array.isArray(settings.worldbooks) ? settings.worldbooks : settings.worldbook ? [settings.worldbook] : [];
  return books.flatMap((b) => (Array.isArray(obj(b).entries) ? (obj(b).entries as unknown[]) : [])).map((raw) => {
    const e = obj(raw);
    return {
      name: str(e.name), content: str(e.content), keywords: strList(e.keywords), secondaryKeywords: strList(e.secondaryKeywords),
      category: str(e.category), isEnabled: e.isEnabled !== false, isConstant: e.isConstant === true, triggerRegion: str(e.triggerRegion),
    };
  });
}
const entryKey = (e: Entry) => JSON.stringify([e.name, e.content, e.keywords, e.secondaryKeywords, e.isEnabled, e.isConstant, e.triggerRegion, e.category]);
const view = (e: Entry): EntryView => ({ name: e.name, content: e.content, keywords: e.keywords, isEnabled: e.isEnabled, isConstant: e.isConstant });

/**
 * 依序配對兩邊剩下的項目：同一個鍵（空鍵不參與）的按出現順序兩兩配對。
 * 回傳配成的 [baseIndex, currentIndex]，並從兩個剩餘集合移除。
 */
function pairBy<T>(base: T[], cur: T[], restBase: Set<number>, restCur: Set<number>, key: (t: T) => string): [number, number][] {
  const queues = new Map<string, number[]>();
  for (const i of restBase) {
    const k = key(base[i]!);
    if (!k) continue;
    const q = queues.get(k);
    if (q) q.push(i); else queues.set(k, [i]);
  }
  const pairs: [number, number][] = [];
  for (const j of restCur) {
    const k = key(cur[j]!);
    const q = k ? queues.get(k) : undefined;
    const i = q?.shift();
    if (i === undefined) continue;
    pairs.push([i, j]);
    restBase.delete(i);
    restCur.delete(j);
  }
  return pairs;
}
const indices = (n: number) => new Set(Array.from({ length: n }, (_, i) => i));

/** 排序過鍵的 JSON：同一條規則不論欄位順序都得到同一個字串。 */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Obj;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
const ruleLabel = (r: Obj): string => Array.from(str(r.name) || str(r.label) || str(r.find) || str(r.id)).slice(0, 80).join('');

function compute(baseIn: unknown, curIn: unknown, detailed: boolean): ReviewDiff {
  const base = obj(baseIn);
  const cur = obj(curIn);
  const docA = obj(base.document);
  const docB = obj(cur.document);
  const grA = obj(base.greetings);
  const grB = obj(cur.greetings);

  const fields: FieldDiff[] = [];
  const changedFields: string[] = [];
  let totalChanged = 0;
  const setting = { charsAdded: 0, charsRemoved: 0 };
  const tags = { added: 0, removed: 0 };

  for (const [key, read] of TEXT_FIELDS) {
    if (key === 'tags') {
      const ta = tagSet(docA.roleTag);
      const tb = tagSet(docB.roleTag);
      tags.added = [...tb].filter((t) => !ta.has(t)).length;
      tags.removed = [...ta].filter((t) => !tb.has(t)).length;
      if (!tags.added && !tags.removed) continue;
      const before = [...ta].join(', ');
      const after = [...tb].join(', ');
      changedFields.push(key);
      const d = lineDelta([...ta].join('\n'), [...tb].join('\n'));
      totalChanged += d.added + d.removed;
      if (detailed) fields.push({ key, before, after });
      continue;
    }
    const before = read(docA, grA);
    const after = read(docB, grB);
    if (before === after) continue;
    changedFields.push(key);
    const d = lineDelta(before, after);
    totalChanged += d.added + d.removed;
    if (key === 'setting') { setting.charsAdded = d.added; setting.charsRemoved = d.removed; }
    if (detailed) fields.push({ key, before, after });
  }

  const assetA = obj(base.authorAsset);
  const assetB = obj(cur.authorAsset);
  for (const name of ASSET_FIELDS) {
    const before = str(assetA[name]);
    const after = str(assetB[name]);
    if (before === after) continue;
    const key = `asset.${name}`;
    changedFields.push(key);
    const d = lineDelta(before, after);
    totalChanged += d.added + d.removed;
    if (detailed) fields.push({ key, before, after });
  }

  const openA = str(grA.welcome);
  const openB = str(grB.welcome);
  const opening = { changed: openA !== openB, charsBefore: effectiveCharacters(openA), charsAfter: effectiveCharacters(openB) };

  // 世界書：先整條完全相同（不算改動），再同名配對，再同內容配對（改名），剩下的是新增或刪除。
  const ea = entriesOf(base);
  const eb = entriesOf(cur);
  const restA = indices(ea.length);
  const restB = indices(eb.length);
  pairBy(ea, eb, restA, restB, entryKey);
  const modifiedPairs = [...pairBy(ea, eb, restA, restB, (e) => e.name), ...pairBy(ea, eb, restA, restB, (e) => e.content)];
  for (const [i, j] of modifiedPairs) {
    const d = lineDelta(ea[i]!.content, eb[j]!.content);
    totalChanged += d.added + d.removed;
  }
  // 新增、刪除的條目整條內容都算進變動量：新加一條五千字的設定，不該顯示成 0。
  for (const i of restA) totalChanged += effectiveCharacters(ea[i]!.content);
  for (const j of restB) totalChanged += effectiveCharacters(eb[j]!.content);
  const worldbook = { added: restB.size, removed: restA.size, modified: modifiedPairs.length };

  // 規則：整條相同（排序鍵後的 JSON）當作沒變，可重複；剩下的依 id、再依 name 配對成「修改」。
  const ra = Array.isArray(assetA.rules) ? (assetA.rules as unknown[]).map(obj) : [];
  const rb = Array.isArray(assetB.rules) ? (assetB.rules as unknown[]).map(obj) : [];
  const rRestA = indices(ra.length);
  const rRestB = indices(rb.length);
  pairBy(ra, rb, rRestA, rRestB, canonicalJson);
  const ruleMods = [...pairBy(ra, rb, rRestA, rRestB, (r) => str(r.id)), ...pairBy(ra, rb, rRestA, rRestB, (r) => str(r.name))];
  const rules = { added: rRestB.size, removed: rRestA.size, modified: ruleMods.length };
  const ruleItems: { change: RuleChange; label: string }[] = detailed
    ? [
        ...ruleMods.map(([, j]) => ({ change: 'modified' as const, label: ruleLabel(rb[j]!) })),
        ...[...rRestB].map((j) => ({ change: 'added' as const, label: ruleLabel(rb[j]!) })),
        ...[...rRestA].map((i) => ({ change: 'removed' as const, label: ruleLabel(ra[i]!) })),
      ]
    : [];

  const unchanged = !changedFields.length && !worldbook.added && !worldbook.removed && !worldbook.modified && !rules.added && !rules.removed && !rules.modified;
  const summary: DiffSummary = { changedFields, setting, opening, worldbook, rules, tags, totalChanged, unchanged };
  return {
    summary,
    fields,
    worldbook: detailed
      ? { added: [...restB].map((j) => view(eb[j]!)), removed: [...restA].map((i) => view(ea[i]!)), modified: modifiedPairs.map(([i, j]) => ({ before: view(ea[i]!), after: view(eb[j]!) })) }
      : { added: [], removed: [], modified: [] },
    rules: { ...rules, items: ruleItems },
  };
}

/** 審核頁用的完整差異：欄位前後文、世界書條目、規則清單。 */
export function diffSettings(base: unknown, current: unknown): ReviewDiff {
  return compute(base, current, true);
}

/** 只要數字（可落庫）：跟 diffSettings(...).summary 完全相同，只是不組前後文與條目。 */
export function summarizeOnly(base: unknown, current: unknown): DiffSummary {
  return compute(base, current, false).summary;
}
