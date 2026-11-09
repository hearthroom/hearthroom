/**
 * 卡片變數的表格檢視：骨架原文（dataText）⇄ 表格的列，原文仍是唯一的真相。
 *
 * 讀：照草稿的寫法（convention）解讀原文，跟 normalizeState 一樣——[值, "規則"] 只在 mvu 才是一對，
 * plain 的兩個字串清單就是清單（風月匯入的卡是 plain，酒館匯入的是 mvu）。
 * 寫：寫法自動判斷。先組一份 MVU 原文當基準；沒有任何規則、而且照 plain 讀得到同一份正規化結果時，
 * 改存只有值的 plain 原文（空群組在 plain 一定可以新增項目、在 mvu 預設不行，兩者不一定等價，所以用比的，不用猜）。
 *
 * 不用 JSON.parse：它會把整數樣的鍵（"2"）排到最前面、把 1.0／-0／超過 2^53 的整數改寫掉。
 * 這裡自己解析成保序的節點，數字留原文，表格沒改到的數字一個字都不動。
 *
 * 表格放不下的結構整份交給原始碼分頁，不做部分顯示（見 readStateTable 的規則清單），
 * 免得表格改一格就把看不到的部分改壞。
 */
import { normalizeState, switchConvention, type CardStateDraft, type StateConvention } from "./card-state";

export type StateKind = "number" | "text" | "boolean" | "list" | "group";
export type StateScalarKind = "number" | "text" | "boolean";

/** 清單裡的一項。value：數字是原文、文字是字本身、是否是 "true"／"false"。 */
export interface StateItem {
  kind: StateScalarKind;
  value: string;
}

export interface StateRow {
  /** 只給畫面當 key 用，不寫進原文。 */
  id: number;
  name: string;
  kind: StateKind;
  /** 數字是原文（"0.1"、"1e21"）、文字是字本身、是否是 "true"／"false"；清單與群組不用。 */
  value: string;
  /** 什麼時候變；空字串＝沒有規則。 */
  rule: string;
  /** 清單的項目。 */
  items: StateItem[];
  /** 群組的子列（只有一層，子列不會是群組）。 */
  children: StateRow[];
  /** 群組在對話中可以新增項目（MVU 的 $meta.extensible）。 */
  extensible: boolean;
}

export type StateTableRead =
  | { ok: true; rows: StateRow[] }
  | { ok: false; reason: "invalid" | "unsupported" };

// ---------------------------------------------------------------------------
// 保序的 JSON 節點

type JNode =
  | { t: "num"; raw: string }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "null" }
  | { t: "arr"; items: JNode[] }
  | { t: "obj"; entries: Array<[string, JNode]> };

class ParseError extends Error {}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
/** 表格裡打的數字要是 JSON 數字的寫法（不收 .5、+1、1.）。 */
export const isNumberText = (s: string): boolean => NUMBER.test(s);

function parseJson(text: string): JNode {
  let i = 0;
  const ws = () => { while (i < text.length && " \t\n\r".includes(text[i])) i++; };
  const value = (): JNode => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const entries: Array<[string, JNode]> = [];
      ws();
      if (text[i] === "}") { i++; return { t: "obj", entries }; }
      for (;;) {
        ws();
        if (text[i] !== '"') throw new ParseError();
        const key = string();
        ws();
        if (text[i++] !== ":") throw new ParseError();
        entries.push([key, value()]);
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return { t: "obj", entries }; }
        throw new ParseError();
      }
    }
    if (c === "[") {
      i++;
      const items: JNode[] = [];
      ws();
      if (text[i] === "]") { i++; return { t: "arr", items }; }
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return { t: "arr", items }; }
        throw new ParseError();
      }
    }
    if (c === '"') return { t: "str", v: string() };
    for (const [word, node] of [["true", { t: "bool", v: true }], ["false", { t: "bool", v: false }], ["null", { t: "null" }]] as const) {
      if (text.startsWith(word, i)) { i += word.length; return node; }
    }
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m || !m[0]) throw new ParseError();
    i += m[0].length;
    return { t: "num", raw: m[0] };
  };
  // 字串的跳脫交給 JSON.parse 解（只餵它一個字串字面值，不會碰到鍵序與數字的問題）
  const string = (): string => {
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    if (i >= text.length) throw new ParseError();
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const out = value();
  ws();
  if (i !== text.length) throw new ParseError();
  return out;
}

/** 照 formatJson 的版面印出節點：縮排兩格，只含純值的短清單寫在同一行。 */
function printJson(n: JNode, indent = ""): string {
  if (n.t === "arr") {
    if (!n.items.length) return "[]";
    if (n.items.every((v) => v.t !== "arr" && v.t !== "obj")) {
      const line = `[${n.items.map((v) => printJson(v)).join(", ")}]`;
      if (line.length <= 100) return line;
    }
    const inner = indent + "  ";
    return `[\n${n.items.map((v) => inner + printJson(v, inner)).join(",\n")}\n${indent}]`;
  }
  if (n.t === "obj") {
    if (!n.entries.length) return "{}";
    const inner = indent + "  ";
    return `{\n${n.entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${printJson(v, inner)}`).join(",\n")}\n${indent}}`;
  }
  if (n.t === "num") return n.raw;
  if (n.t === "str") return JSON.stringify(n.v);
  if (n.t === "bool") return String(n.v);
  return "null";
}

// ---------------------------------------------------------------------------
// 讀

const MARKER = "$__META_EXTENSIBLE__$";
let seq = 0;
const nextId = (): number => ++seq;

class Unsupported extends Error {}

/** 換行放不進單行的格子（輸入框會把它吃掉），有換行的字交給原始碼。 */
const oneLine = (s: string): string => {
  if (/[\r\n\u2028\u2029]/.test(s)) throw new Unsupported();
  return s;
};

/**
 * 鍵名：空字串分不出是「還沒取名的新列」，$ 開頭是 MVU 的特殊鍵，前後有空白的寫回時會被修掉
 * （規則與面板引用的就是原本那個名字），都交給原始碼。
 */
const plainKey = (k: string): string => {
  if (!k || k.startsWith("$") || k !== k.trim()) throw new Unsupported();
  return oneLine(k);
};

function scalar(n: JNode): StateItem {
  if (n.t === "num") return { kind: "number", value: n.raw };
  if (n.t === "bool") return { kind: "boolean", value: String(n.v) };
  if (n.t === "str") {
    if (n.v === MARKER) throw new Unsupported();
    return { kind: "text", value: oneLine(n.v) };
  }
  // null、物件、清單都不是一格放得下的值
  throw new Unsupported();
}

const isPair = (n: JNode): n is { t: "arr"; items: [JNode, { t: "str"; v: string }] } =>
  n.t === "arr" && n.items.length === 2 && n.items[1].t === "str"
  && !(n.items[0].t === "str" && n.items[0].v === MARKER) && n.items[1].v !== MARKER;

function readEntries(entries: Array<[string, JNode]>, convention: StateConvention, depth: number): StateRow[] {
  const seen = new Set<string>();
  const rows: StateRow[] = [];
  for (const [key, node] of entries) {
    // 重複的鍵：JSON.parse 只留最後一個，表格兩個都畫會改變結果
    if (seen.has(key)) throw new Unsupported();
    seen.add(key);
    rows.push(readRow(plainKey(key), node, convention, depth));
  }
  return rows;
}

function readRow(name: string, node: JNode, convention: StateConvention, depth: number): StateRow {
  const row: StateRow = { id: nextId(), name, kind: "text", value: "", rule: "", items: [], children: [], extensible: false };
  let value = node;
  if (convention === "mvu" && isPair(node)) {
    row.rule = oneLine(node.items[1].v);
    value = node.items[0];
  }
  if (value.t === "arr") {
    row.kind = "list";
    row.items = value.items.map(scalar);
    return row;
  }
  if (value.t === "obj") {
    // 群組裡的群組
    if (depth > 0) throw new Unsupported();
    row.kind = "group";
    let entries = value.entries;
    if (convention === "mvu") {
      const metas = entries.filter(([k]) => k === "$meta");
      if (metas.length > 1) throw new Unsupported();
      const meta = metas[0]?.[1];
      if (meta) {
        // $meta 只認 {"extensible": true/false}；required、recursiveExtensible 之類表格表達不了
        if (meta.t !== "obj" || meta.entries.some(([k, v]) => k !== "extensible" || v.t !== "bool") || meta.entries.length > 1) throw new Unsupported();
        const flag = meta.entries[0]?.[1];
        row.extensible = flag?.t === "bool" ? flag.v : false;
        entries = entries.filter(([k]) => k !== "$meta");
      }
    } else {
      // plain：每個空物件都能新增項目，非空的不能
      row.extensible = !entries.length;
    }
    row.children = readEntries(entries, convention, depth + 1);
    return row;
  }
  const item = scalar(value);
  row.kind = item.kind;
  row.value = item.value;
  return row;
}

/**
 * 原文 → 表格的列。表格放不下（unsupported）的情況：
 *   - 最外層不是物件，或最外層有 $meta；
 *   - 群組裡還有群組；
 *   - 清單裡放物件、清單或 null；任何地方的 null；
 *   - $meta 不是只有一個布林的 extensible（例如 required、recursiveExtensible）；
 *   - 除了群組上的 $meta 之外任何 $ 開頭的鍵、空字串鍵、重複的鍵、清單裡的 $__META_EXTENSIBLE__$ 標記；
 *   - 鍵、字或規則裡有換行；
 *   - 草稿帶著原文放不下的逐值規則（pathRules，例如規則掛在清單的某一項上）。
 * 解不開的原文是 invalid。空白原文是空表格。
 */
export function readStateTable(draft: Pick<CardStateDraft, "convention" | "dataText" | "pathRules">): StateTableRead {
  const text = draft.dataText.trim();
  if (!text) return { ok: true, rows: [] };
  let root: JNode;
  try {
    root = parseJson(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (root.t !== "obj") return { ok: false, reason: "invalid" };
  if (draft.pathRules && Object.values(draft.pathRules).some((v) => v.trim())) return { ok: false, reason: "unsupported" };
  try {
    return { ok: true, rows: readEntries(root.entries, draft.convention, 0) };
  } catch (err) {
    if (err instanceof Unsupported) return { ok: false, reason: "unsupported" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 寫

export type RowProblem = "name_empty" | "name_reserved" | "name_duplicate" | "number";

/** 一列自己的問題（名稱或數字），子列另外檢查。有問題的表格不寫回原文。 */
export function rowProblems(siblings: StateRow[], row: StateRow): RowProblem[] {
  const out: RowProblem[] = [];
  const name = row.name.trim();
  if (!name) out.push("name_empty");
  else if (name.startsWith("$")) out.push("name_reserved");
  else if (siblings.some((r) => r !== row && r.name.trim() === name)) out.push("name_duplicate");
  if (row.kind === "number" && !isNumberText(row.value.trim())) out.push("number");
  return out;
}

export function tableHasProblems(rows: StateRow[]): boolean {
  return rows.some((r) => rowProblems(rows, r).length > 0 || (r.kind === "group" && tableHasProblems(r.children)));
}

const hasRule = (rows: StateRow[]): boolean => rows.some((r) => r.rule.trim() || hasRule(r.children));

function itemNode(item: StateItem): JNode {
  if (item.kind === "number") return { t: "num", raw: item.value.trim() };
  if (item.kind === "boolean") return { t: "bool", v: item.value === "true" };
  return { t: "str", v: item.value };
}

function valueNode(row: StateRow, mvu: boolean): JNode {
  if (row.kind === "list") return { t: "arr", items: row.items.map(itemNode) };
  if (row.kind === "group") {
    const entries = entriesNode(row.children, mvu);
    if (mvu && row.extensible) entries.unshift(["$meta", { t: "obj", entries: [["extensible", { t: "bool", v: true }]] }]);
    return { t: "obj", entries };
  }
  return itemNode({ kind: row.kind, value: row.value });
}

function entriesNode(rows: StateRow[], mvu: boolean): Array<[string, JNode]> {
  return rows.map((row) => {
    const value = valueNode(row, mvu);
    if (!mvu) return [row.name.trim(), value];
    const rule = row.rule.trim();
    // 沒有規則但長得像一對的清單（["短刀", "鐵護腕"]）包一層空規則，MVU 才不會把它讀成值加規則
    if (rule || isPair(value)) return [row.name.trim(), { t: "arr", items: [value, { t: "str", v: rule ? row.rule : "" }] }];
    return [row.name.trim(), value];
  });
}

const sameNormalized = (a: ReturnType<typeof normalizeState>, b: ReturnType<typeof normalizeState>): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * 表格 → 原文與寫法。任一列有規則就是 mvu；都沒有時，plain 原文照 plain 讀得到跟 mvu 原文同一份結果才用 plain。
 * 表格有問題（名稱空白、重複、$ 開頭、數字寫錯）時回 null，不寫回去。
 */
export function writeStateTable(rows: StateRow[]): { dataText: string; convention: StateConvention } | null {
  if (tableHasProblems(rows)) return null;
  const mvuText = printJson({ t: "obj", entries: entriesNode(rows, true) });
  if (!hasRule(rows)) {
    const plainText = printJson({ t: "obj", entries: entriesNode(rows, false) });
    if (sameNormalized(normalizeState("plain", JSON.parse(plainText)), normalizeState("mvu", JSON.parse(mvuText)))) {
      return { dataText: plainText, convention: "plain" };
    }
  }
  return { dataText: mvuText, convention: "mvu" };
}

/** 新的一列（加一列的按鈕、群組裡加一項）。 */
export function newRow(kind: Exclude<StateKind, "boolean">): StateRow {
  return { id: nextId(), name: "", kind, value: kind === "number" ? "0" : "", rule: "", items: [], children: [], extensible: false };
}

/**
 * 把範例（MVU 寫法的物件）併進目前的原文：同名的由範例蓋掉、位置不變，其餘照原順序，數字原文不動。
 * 原文是 plain 時先換成 mvu 的讀法再併（範例本身是 MVU 寫法）；這一步走 switchConvention，
 * 會照 formatJson 重排（像整數的鍵排到前面、數字照 JSON 數值印），只在 plain 原文插範例時發生。
 * 原文解不開時回 null。
 */
export function mergeStateExample(draft: Pick<CardStateDraft, "convention" | "dataText">, example: Record<string, unknown>): { dataText: string; convention: "mvu" } | null {
  const add = parseJson(JSON.stringify(example));
  if (add.t !== "obj") return null;
  const text = draft.dataText.trim();
  if (!text) return { dataText: printJson(add), convention: "mvu" };
  let base: CardStateDraft = { convention: draft.convention, dataText: text, rulesText: "", template: "" };
  if (base.convention !== "mvu") base = switchConvention(base, "mvu");
  let root: JNode;
  try {
    root = parseJson(base.dataText);
  } catch {
    return null;
  }
  if (root.t !== "obj") return null;
  const entries = [...root.entries];
  for (const [k, v] of add.entries) {
    const at = entries.findIndex(([key]) => key === k);
    if (at >= 0) entries[at] = [k, v];
    else entries.push([k, v]);
  }
  return { dataText: printJson({ t: "obj", entries }), convention: "mvu" };
}

/** 同 formatJson 的版面，但吃原文、保序、留數字原文；解不開就丟錯。 */
export const reformatStateText = (text: string): string => printJson(parseJson(text));
