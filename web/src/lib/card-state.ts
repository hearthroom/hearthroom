/**
 * 卡片變數（CardState）：作者在編輯器裡寫的那份骨架，跟上游存的正規化結果之間的轉換。
 *
 * 上游只在寫入時正規化一次（server provider/internal/service/cardstate/definition.go 的 Normalize）：
 *   - mvu：葉子寫成 [值, "規則"]，值進 data、規則進 rules.paths（路徑寫法見 keyPath）；
 *     寫入時另外帶的 rules.paths 照收，原文裡的 [值, "規則"] 再疊上去；
 *     物件上的 {"$meta": {"extensible": true}}／recursiveExtensible 記成 open（可以新增鍵）；
 *     $meta.required 記成 required；清單裡的 "$__META_EXTENSIBLE__$" 標記剝掉；
 *     一對 [值, 規則] 裡的值若是清單，它就是清單，不再當成另一對。
 *   - plain：照原樣存；每個空物件 {} 都記成 open；逐值規則只能走 rules.paths。
 * 讀回來的只有正規化後的純值樹，所以編輯器要把它組回作者寫的樣子（rebuildStateText），
 * 而且再存一次要得到同一份結果。normalizeState 是上游規則的本地鏡像：存檔前的檢查、
 * 每輪大小的提示、與往返測試都靠它。兩邊不一致時以上游為準，改這裡去配合。
 */

export type StateConvention = "mvu" | "plain";

export interface CardStateDraft {
  convention: StateConvention;
  /** 骨架的 JSON 原文（作者打的字，可能暫時解不開）。 */
  dataText: string;
  /** 寫給模型的變數規則（風月的「變量提示詞」也落在這裡）。 */
  rulesText: string;
  /** 面板皮膚（Handlebars 的 HTML／CSS）；空字串＝沒有面板。 */
  template: string;
  /**
   * 骨架原文放不下的逐值規則，照路徑記（清單元素上的規則、或「只有值」寫法下的規則），
   * 存檔時當 rules.paths 送出，讀回再存一次才不會掉。沒有就不帶這個欄位。
   */
  pathRules?: Record<string, string>;
}

/** 上游的上限（definition.go）。位元組都是 UTF-8。 */
export const STATE_LIMITS = {
  dataBytes: 16 << 10,
  depth: 8,
  keys: 400,
  stringBytes: 2 << 10,
  rulesTextBytes: 8 << 10,
  rulePathBytes: 8 << 10,
  templateBytes: 32 << 10,
} as const;

/** 錯誤句子裡的上限數字（KB 換算好），本地檢查與上游拒收共用同一組。 */
export const stateLimitParams = (): Record<string, number> => ({
  dataKB: STATE_LIMITS.dataBytes >> 10,
  depth: STATE_LIMITS.depth,
  keys: STATE_LIMITS.keys,
  stringKB: STATE_LIMITS.stringBytes >> 10,
  rulesKB: STATE_LIMITS.rulesTextBytes >> 10,
  pathsKB: STATE_LIMITS.rulePathBytes >> 10,
  templateKB: STATE_LIMITS.templateBytes >> 10,
});

/** 每一輪都會整份送進對話；超過這個大小就提醒作者。 */
export const STATE_TURN_WARN_BYTES = 4 << 10;

export type StateReason =
  | "convention" | "data" | "data_size" | "depth" | "keys" | "string_size"
  | "rules_text_size" | "rule_paths_size" | "rule_path" | "template_size";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export interface NormalizedState {
  data: JsonObject;
  paths: Record<string, string>;
  open: string[];
  required: string[];
}

const MARKER = "$__META_EXTENSIBLE__$";
const isObject = (v: unknown): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v);
const isMarker = (v: unknown): boolean => v === MARKER;
const bytes = (s: string): number => new TextEncoder().encode(s).length;

/**
 * 上游路徑的標準寫法（Path.String）：鍵用點接、索引寫 [n]；鍵是空字串或含 . [ ] " 時寫成 ["鍵"]，
 * 前面不加點，例如 a["x.y"]、["HP.max"]、背包[0]。上游回傳的 rules.paths／open／required 都是這個寫法，
 * 這裡組不出一模一樣的字串，讀回時就對不上、再存一次就掉了。
 */
const keyPath = (p: string, key: string): string => (key === "" || /[.[\]"]/.test(key) ? `${p}["${key}"]` : p ? `${p}.${key}` : key);
const indexPath = (p: string, i: number): string => `${p}[${i}]`;

type PathPart = { key: string } | { index: number; raw: string };

/** 上游 ParsePath 的鏡像：a.b、a[0].c、a["有點的鍵"]、a['鍵']、/a/0/c。讀不懂就 null。 */
function parsePath(raw: string): PathPart[] | null {
  const s = raw.trim();
  if (!s) return null;
  const parts: PathPart[] = [];
  if (s.startsWith("/")) {
    for (let seg of s.slice(1).split("/")) {
      seg = seg.replaceAll("~1", "/").replaceAll("~0", "~");
      parts.push(/^\d+$/.test(seg) ? { index: Number(seg), raw: seg } : { key: seg });
    }
    return parts;
  }
  let i = 0;
  while (i < s.length) {
    if (s[i] === ".") { i++; continue; }
    if (s[i] === "[") {
      const end = s.indexOf("]", i);
      if (end < 0) return null;
      const inner = s.slice(i + 1, end).trim();
      i = end + 1;
      if (inner.length >= 2 && (inner[0] === '"' || inner[0] === "'") && inner.at(-1) === inner[0]) {
        parts.push({ key: inner.slice(1, -1) });
        continue;
      }
      if (!/^\d+$/.test(inner)) return null;
      parts.push({ index: Number(inner), raw: inner });
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== "." && s[j] !== "[") j++;
    parts.push({ key: s.slice(i, j).trim() });
    i = j;
  }
  return parts.length ? parts : null;
}

const formatPath = (parts: PathPart[]): string => parts.reduce((p, part) => ("index" in part ? indexPath(p, part.index) : keyPath(p, part.key)), "");

/** 路徑在值樹裡找得到東西（上游 Lookup：對不上的規則路徑整份拒收）。 */
function pathExists(data: Json, path: string): boolean {
  const parts = parsePath(path);
  if (!parts) return false;
  let cur: Json = data;
  for (const part of parts) {
    if (isObject(cur) && "key" in part) {
      if (!Object.hasOwn(cur, part.key)) return false;
      cur = cur[part.key];
    } else if (isObject(cur) && "index" in part) {
      // 物件上的索引照原字當鍵名找（上游 Lookup 也這樣）
      if (!Object.hasOwn(cur, part.raw)) return false;
      cur = cur[part.raw];
    } else if (Array.isArray(cur) && "index" in part) {
      if (part.index >= cur.length) return false;
      cur = cur[part.index];
    } else return false;
  }
  return true;
}

/** 一對 [值, "規則"] 的樣子；清單裡的元素永遠不是一對。 */
const isPair = (v: unknown): v is [Json, string] =>
  Array.isArray(v) && v.length === 2 && typeof v[1] === "string" && !isMarker(v[0]) && !isMarker(v[1]);

const sortDedupe = (list: string[]): string[] => [...new Set(list)].sort();

/** 照上游規則正規化。data 不是物件時丟 "data"。不做大小檢查（那是 stateProblem 的事）。 */
export function normalizeState(convention: StateConvention, data: unknown, rulePaths: Record<string, string> = {}): NormalizedState {
  if (!isObject(data)) throw new StateError("data");
  const paths: Record<string, string> = {};
  for (const [k, v] of Object.entries(rulePaths)) if (v.trim()) paths[k] = v.trim();
  const open: string[] = [];
  const required: string[] = [];

  if (convention === "plain") {
    const walk = (n: Json, p: string) => {
      if (isObject(n)) {
        if (p && !Object.keys(n).length) open.push(p);
        for (const [k, v] of Object.entries(n)) walk(v, keyPath(p, k));
      } else if (Array.isArray(n)) n.forEach((v, i) => walk(v, indexPath(p, i)));
    };
    walk(data, "");
    return { data: clone(data), paths, open: sortDedupe(open), required: [] };
  }
  if (convention !== "mvu") throw new StateError("convention");

  const node = (n: Json, p: string, inherited: boolean): Json => {
    if (Array.isArray(n)) {
      if (isPair(n)) {
        if (p && n[1].trim()) paths[p] = n[1].trim();
        return value(n[0], p, inherited);
      }
      return list(n, p, inherited);
    }
    if (isObject(n)) {
      const out: JsonObject = {};
      let isOpen = inherited;
      let recursive = inherited;
      const meta = n.$meta;
      if (isObject(meta)) {
        if (typeof meta.extensible === "boolean") isOpen = meta.extensible;
        if (meta.recursiveExtensible === true) { isOpen = true; recursive = true; }
        if (Array.isArray(meta.required)) {
          for (const r of meta.required) if (typeof r === "string") required.push(keyPath(p, r));
        }
      }
      for (const [k, v] of Object.entries(n)) {
        if (k === "$meta") continue;
        out[k] = node(v, keyPath(p, k), recursive);
      }
      if (isOpen && p) open.push(p);
      return out;
    }
    return n;
  };
  const value = (n: Json, p: string, inherited: boolean): Json => (Array.isArray(n) ? list(n, p, inherited) : node(n, p, inherited));
  // 索引是剝掉標記之後的位置，跟上游一樣
  const list = (n: Json[], p: string, inherited: boolean): Json[] => {
    const out: Json[] = [];
    for (const v of n) if (!isMarker(v)) out.push(value(v, indexPath(p, out.length), inherited));
    return out;
  };
  return { data: node(data, "", false) as JsonObject, paths, open: sortDedupe(open), required: sortDedupe(required) };
}

export class StateError extends Error {
  constructor(readonly reason: StateReason) {
    super(reason);
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * 上游讀回的定義 → 作者看到的骨架原文。
 *
 * 有逐值規則、可擴充物件或必填鍵時組回 MVU 寫法：有規則的值包成 [值, "規則"]，
 * 可擴充的物件補 {"$meta": {"extensible": true}}，必填鍵記在父物件的 $meta.required。
 * 兩個元素、第二個是字串的清單（["短刀", "鐵護腕"]）在 MVU 裡會被讀成一對，
 * 所以沒有規則時也包一層 [清單, ""]——空規則上游不記，值照樣是清單。
 * 規則掛在清單元素上（a[0]）的寫法 MVU 原文表達不了，那幾條放進 pathRules，存檔時照路徑送回去。
 */
export function rebuildStateText(def: { data: unknown; paths?: Record<string, string>; open?: string[]; required?: string[] }): { convention: StateConvention; dataText: string; pathRules: Record<string, string> } {
  const data = isObject(def.data) ? def.data : {};
  const paths = def.paths ?? {};
  const required = def.required ?? [];
  const plain = normalizeState("plain", data);
  const plainFits = !Object.keys(paths).length && !required.length && sameList(plain.open, sortDedupe([...(def.open ?? [])]));
  if (plainFits) return { convention: "plain", dataText: formatJson(data), pathRules: {} };
  const built = mvuSkeleton(data, paths, def.open ?? [], required);
  return { convention: "mvu", dataText: formatJson(built.data), pathRules: built.pathRules };
}

/**
 * 純值樹 → MVU 原文的物件：paths 裡掛在物件鍵上的規則寫成 [值, "規則"]，其餘的（清單元素上的、
 * 對不上的）原樣回傳在 pathRules；open 的物件補 $meta.extensible，required 記在父物件的 $meta.required。
 */
function mvuSkeleton(data: JsonObject, paths: Record<string, string>, openList: string[], required: string[]): { data: JsonObject; pathRules: Record<string, string> } {
  const open = new Set(openList);
  const rest = { ...paths };
  // 每條必填路徑是「父物件路徑 + 一個鍵」：照父物件分組，組回時寫進那個物件的 $meta.required
  const requiredByParent = new Map<string, string[]>();
  for (const r of required) {
    const parts = parsePath(r);
    const last = parts?.at(-1);
    if (!parts || !last || !("key" in last)) continue;
    const parent = formatPath(parts.slice(0, -1));
    requiredByParent.set(parent, [...(requiredByParent.get(parent) ?? []), last.key]);
  }
  const build = (n: Json, p: string): Json => {
    if (Array.isArray(n)) return n.map((v, i) => build(v, indexPath(p, i)));
    if (!isObject(n)) return n;
    const out: JsonObject = {};
    const meta: JsonObject = {};
    if (p && open.has(p)) meta.extensible = true;
    const req = requiredByParent.get(p);
    if (req?.length) meta.required = req;
    if (Object.keys(meta).length) out.$meta = meta;
    for (const [k, v] of Object.entries(n)) {
      const cp = keyPath(p, k);
      const child = build(v, cp);
      const rule = rest[cp];
      if (rule !== undefined) delete rest[cp];
      out[k] = rule !== undefined ? [child, rule] : isPair(child) ? [child, ""] : child;
    }
    return out;
  };
  return { data: build(data, "") as JsonObject, pathRules: rest };
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * 縮排兩格的 JSON，只含純值的短清單寫在同一行：MVU 的 [值, "規則"] 一行一個才看得出是一對。
 */
export function formatJson(value: unknown, indent = ""): string {
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const flat = value.every((v) => v === null || typeof v !== "object");
    if (flat) {
      const line = `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
      if (line.length <= 100) return line;
    }
    const inner = indent + "  ";
    return `[\n${value.map((v) => inner + formatJson(v, inner)).join(",\n")}\n${indent}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return "{}";
    const inner = indent + "  ";
    return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${formatJson(value[k], inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 上游角色詳情裡的 state（作者視角）→ 草稿；沒有或壞掉就是 null。 */
export function readState(raw: unknown): CardStateDraft | null {
  if (!isObject(raw as Json)) return null;
  const r = raw as Record<string, unknown>;
  let data = r.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!isObject(data as Json)) return null;
  const rules = isObject(r.rules as Json) ? (r.rules as Record<string, unknown>) : {};
  const paths: Record<string, string> = {};
  if (isObject(rules.paths as Json)) {
    for (const [k, v] of Object.entries(rules.paths as Record<string, unknown>)) if (typeof v === "string") paths[k] = v;
  }
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
  const rebuilt = rebuildStateText({ data, paths, open: strings(r.open), required: strings(r.required) });
  const panel = isObject(r.panel as Json) ? (r.panel as Record<string, unknown>) : {};
  return {
    convention: rebuilt.convention,
    dataText: rebuilt.dataText,
    rulesText: typeof rules.text === "string" ? rules.text : "",
    template: typeof panel.template === "string" ? panel.template : "",
    ...(Object.keys(rebuilt.pathRules).length ? { pathRules: rebuilt.pathRules } : {}),
  };
}

/** 解開骨架原文；解不開或不是物件就丟 "data"。 */
export function parseStateData(text: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StateError("data");
  }
  if (!isObject(parsed as Json)) throw new StateError("data");
  return parsed as JsonObject;
}

/** PUT /role/{id}/state 與試玩卡 state 區段共用的寫入體。 */
export interface StatePayload {
  convention: StateConvention;
  data: JsonObject;
  rules?: { text?: string; paths?: Record<string, string> };
  panel?: { template: string };
}

/**
 * 骨架、規則、皮膚三格都空＝沒有變數（存檔時移除）。只清掉骨架、規則或皮膚還有字的，
 * 不是要移除：stateProblem 把它當骨架的錯擋下來，免得一存就把另外兩格一起刪掉。
 */
export const stateEmpty = (state: CardStateDraft | null): boolean =>
  !state || (!state.dataText.trim() && !state.rulesText.trim() && !state.template.trim());

/** 要送出的逐值規則：空白的不送；骨架裡已經沒有那個值的也不送（上游會整份拒收，作者在這裡看不到也刪不掉它）。 */
function sentPathRules(state: CardStateDraft, data: JsonObject): Record<string, string> {
  const out: Record<string, string> = {};
  if (!state.pathRules) return out;
  let values: JsonObject;
  try {
    values = normalizeState(state.convention, data).data;
  } catch {
    return out;
  }
  for (const [k, v] of Object.entries(state.pathRules)) if (v.trim() && pathExists(values, k)) out[k] = v;
  return out;
}

export function statePayload(state: CardStateDraft): StatePayload {
  const data = parseStateData(state.dataText);
  const out: StatePayload = { convention: state.convention, data };
  const rules: NonNullable<StatePayload["rules"]> = {};
  if (state.rulesText.trim()) rules.text = state.rulesText;
  const paths = sentPathRules(state, data);
  if (Object.keys(paths).length) rules.paths = paths;
  if (Object.keys(rules).length) out.rules = rules;
  if (state.template.trim()) out.panel = { template: state.template };
  return out;
}

/**
 * 切換寫法時把骨架轉成另一種寫法，值與規則都不掉：
 *   - 只有值 → MVU：值照原樣，像一對的清單包成 [清單, ""]、空物件補 $meta.extensible（只有值寫法裡它們本來就能新增）；
 *   - MVU → 只有值：骨架只留值，每條逐值規則搬到變數規則，一條一行「路徑: 規則」。
 *     MVU 才有的可擴充（非空物件）與必填在只有值的寫法裡沒有寫法，切過去就沒了。
 * 骨架是空的或解不開時只換寫法，原文不動（錯誤照樣標在骨架下面）。
 */
export function switchConvention(state: CardStateDraft, to: StateConvention): CardStateDraft {
  if (state.convention === to) return state;
  let data: JsonObject;
  try {
    data = parseStateData(state.dataText);
  } catch {
    return { ...state, convention: to };
  }
  if (to === "mvu") {
    const plain = normalizeState("plain", data);
    return { ...state, convention: to, dataText: formatJson(mvuSkeleton(data, {}, plain.open, []).data) };
  }
  const norm = normalizeState("mvu", data);
  const lines = Object.entries(norm.paths).map(([k, v]) => `${k}: ${v}`).join("\n");
  const rulesText = !lines ? state.rulesText : state.rulesText.trim() ? `${state.rulesText.trimEnd()}\n\n${lines}` : lines;
  return { ...state, convention: to, dataText: formatJson(norm.data), rulesText };
}

/** 有沒有改過（含開關本身）。 */
export function stateChanged(draft: { state: CardStateDraft | null }, original: { state: CardStateDraft | null } | null): boolean {
  if (!original) return !stateEmpty(draft.state);
  return JSON.stringify(draft.state) !== JSON.stringify(original.state);
}

/** 正規化之後的值樹（每一輪送進對話的就是它）的精簡 JSON；解不開就 null。 */
export function stateValues(state: CardStateDraft): NormalizedState | null {
  try {
    return normalizeState(state.convention, parseStateData(state.dataText), state.pathRules);
  } catch {
    return null;
  }
}

/**
 * 存檔前的本地檢查，跟上游 Validate 同一套上限。上游仍是最終權威：
 * 規則路徑（rule_path／rule_paths_size）只有上游判斷得了。
 */
export function stateProblem(state: CardStateDraft | null): StateReason | null {
  if (stateEmpty(state)) return null;
  const s = state!;
  let norm: NormalizedState;
  try {
    const data = parseStateData(s.dataText);
    norm = normalizeState(s.convention, data, sentPathRules(s, data));
  } catch (err) {
    return err instanceof StateError ? err.reason : "data";
  }
  const tree = treeProblem(norm.data);
  if (tree) return tree;
  if (bytes(s.rulesText.trim()) > STATE_LIMITS.rulesTextBytes) return "rules_text_size";
  let pathBytes = 0;
  for (const [k, v] of Object.entries(norm.paths)) pathBytes += bytes(k) + bytes(v);
  if (pathBytes > STATE_LIMITS.rulePathBytes) return "rule_paths_size";
  if (s.template.trim() && bytes(s.template) > STATE_LIMITS.templateBytes) return "template_size";
  return null;
}

function treeProblem(data: JsonObject): StateReason | null {
  if (bytes(JSON.stringify(data)) > STATE_LIMITS.dataBytes) return "data_size";
  let keys = 0;
  const walk = (n: Json, depth: number): StateReason | null => {
    if (depth > STATE_LIMITS.depth) return "depth";
    if (typeof n === "string") return bytes(n) > STATE_LIMITS.stringBytes ? "string_size" : null;
    if (Array.isArray(n)) {
      for (const v of n) { const r = walk(v, depth + 1); if (r) return r; }
      return null;
    }
    if (isObject(n)) {
      keys += Object.keys(n).length;
      if (keys > STATE_LIMITS.keys) return "keys";
      for (const v of Object.values(n)) { const r = walk(v, depth + 1); if (r) return r; }
    }
    return null;
  };
  return walk(data, 0);
}

/** 每一輪大約多送多少字（精簡 JSON 的字元數）與位元組數。 */
export function stateTurnSize(state: CardStateDraft): { chars: number; bytes: number } | null {
  const norm = stateValues(state);
  if (!norm) return null;
  const compact = JSON.stringify(norm.data);
  return { chars: [...compact].length, bytes: bytes(compact) };
}

/** 葉子值的數量（匯入摘要用）。 */
export function stateLeafCount(data: unknown): number {
  if (Array.isArray(data)) return data.reduce((n: number, v) => n + stateLeafCount(v), 0);
  if (isObject(data as Json)) return Object.values(data as JsonObject).reduce((n: number, v) => n + stateLeafCount(v), 0);
  return 1;
}

/** 物件逐層合併；清單與純值由後面的蓋掉前面的。匯入時多條初始變數條目照順序併。 */
export function deepMerge(base: unknown, next: unknown): unknown {
  if (!isObject(base as Json) || !isObject(next as Json)) return clone(next);
  const out: JsonObject = { ...(base as JsonObject) };
  for (const [k, v] of Object.entries(next as JsonObject)) {
    const merged = (Object.hasOwn(out, k) ? deepMerge(out[k], v) : clone(v)) as Json;
    Object.defineProperty(out, k, { value: merged, enumerable: true, writable: true, configurable: true });
  }
  return out;
}
