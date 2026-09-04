/**
 * 角色主頁文件（結構化 JSON，TipTap／ProseMirror 形狀）→ 渲染樹。
 *
 * 來源端交付的是一棵白名單節點樹，不是 HTML：這裡逐型別對應、未知的一律靜默跳過，
 * 屬性全部正規化成固定枚舉與範圍。渲染元件因此只吃「已經合法」的資料，不必再判斷。
 *
 * 規則跟來源端的校驗器對齊（分欄與面板只允許在最上層、mark 排序固定、圖寬只有五檔），
 * 這裡放寬會讓一份來源端拒收的文件在本站看起來能用。
 */

export const COLOR_PALETTE: Record<string, string> = {
  gold: "#F5C542", rose: "#FF8FA3", violet: "#B79CFF", mint: "#6FE3A3",
  sky: "#7EC8FF", amber: "#FFC067", silver: "#C7CDD6",
};
export const HIGHLIGHT_TONE: Record<string, string> = {
  gold: "rgba(245,197,66,0.32)", rose: "rgba(255,143,163,0.32)", violet: "rgba(183,156,255,0.32)",
};
const IMAGE_WIDTHS = new Set([25, 33, 50, 66, 100]);
const PANEL_TONES = new Set(["gold", "rose", "violet", "sky", "mint", "amber", "silver", "ink"]);
const HEADING_ARTS = new Set(["none", "bubble", "neon", "outline", "glitch", "ink", "serif"]);
const IMAGE_FRAMES = new Set(["default", "none", "polaroid", "tape"]);
const SKIN_IDS = new Set(["indigo-night", "sakura-mist", "azure-dawn", "jade-bamboo", "crimson-flame", "silver-ash", "dark-violet"]);
const MARK_ORDER: Record<string, number> = { bold: 0, italic: 1, underline: 2, strike: 3, color: 4, highlight: 5 };
const MONOGRAM_HUES = [350, 20, 45, 150, 190, 220, 260, 300];

export interface RawNode { type?: unknown; attrs?: Record<string, unknown>; content?: unknown; marks?: unknown; text?: unknown }

export type Mark =
  | { type: "bold" | "italic" | "underline" | "strike" }
  | { type: "color"; value: string }
  | { type: "highlight"; bg: string };
export type Inline = { kind: "text"; text: string; marks: Mark[] } | { kind: "hardBreak" };

export type Align = "left" | "center" | "right";
export type Block =
  | { kind: "heading"; level: 2 | 3; align: Align; art: string; content: Inline[] }
  | { kind: "paragraph"; align: Align; content: Inline[] }
  | { kind: "blockquote"; content: Block[] }
  | { kind: "bulletList" | "orderedList"; items: Block[][] }
  | { kind: "dialogueBubble"; name: string; side: "left" | "right"; hue: number; content: Inline[] }
  | { kind: "statCard"; title: string; rows: { k: string; v: string }[] }
  | { kind: "spoiler"; title: string; content: Block[] }
  | { kind: "divider" }
  | { kind: "image"; src: string; width: number; frame: string }
  | { kind: "panel"; tone: string; content: Block[] }
  | { kind: "columns"; columns: Block[][] }
  | { kind: "profileCard"; name: string; subtitle: string; desc: string; avatarSrc: string; bgSrc: string; tags: string[]; hue: number }
  | { kind: "gallery"; items: { src: string }[]; width: number }
  | { kind: "meter"; label: string; value: number; tone: string };

export interface Doc { kind: "doc"; content: Block[] }

interface Ctx { insideContainer?: boolean; insideColumns?: boolean; insideColumn?: boolean }

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const pick = <T extends string>(set: Set<string>, v: unknown, fallback: T): T =>
  typeof v === "string" && set.has(v) ? (v as T) : fallback;

/** 沒頭像的名字給一個穩定色相：同一個名字永遠同一個顏色。 */
export function monogramHue(title: unknown): number {
  const s = str(title).trim();
  if (!s) return MONOGRAM_HUES[0]!;
  let hash = 0;
  for (const ch of s) hash = (hash + (ch.codePointAt(0) ?? 0)) % 100003;
  return MONOGRAM_HUES[hash % MONOGRAM_HUES.length]!;
}
export const monogramLetter = (name: unknown): string => [...str(name).trim()][0] ?? "·";
export const normSkinId = (id: unknown): string => pick(SKIN_IDS, id, "");

function mapMark(raw: unknown): Mark | null {
  const m = raw as RawNode;
  const attrs = m?.attrs ?? {};
  switch (m?.type) {
    case "bold": case "italic": case "underline": case "strike":
      return { type: m.type };
    case "textStyle": {
      const value = COLOR_PALETTE[str(attrs.color)];
      return value ? { type: "color", value } : null;
    }
    case "highlight": {
      const bg = HIGHLIGHT_TONE[str(attrs.tone)];
      return bg ? { type: "highlight", bg } : null;
    }
    default:
      return null;
  }
}

function mapInline(raw: unknown): Inline | null {
  const n = raw as RawNode;
  if (n?.type === "text") {
    const text = str(n.text);
    if (!text) return null;
    const marks = (Array.isArray(n.marks) ? n.marks : []).map(mapMark).filter((x): x is Mark => Boolean(x));
    marks.sort((a, b) => MARK_ORDER[a.type]! - MARK_ORDER[b.type]!);
    return { kind: "text", text, marks };
  }
  if (n?.type === "hardBreak") return { kind: "hardBreak" };
  return null;
}
const inlines = (content: unknown): Inline[] =>
  (Array.isArray(content) ? content : []).map(mapInline).filter((x): x is Inline => Boolean(x));

/** 對話氣泡把多段落壓成一段，段落之間用換行。 */
function bubbleInlines(content: unknown): Inline[] {
  const out: Inline[] = [];
  for (const n of Array.isArray(content) ? content : []) {
    if ((n as RawNode)?.type === "paragraph") {
      const part = inlines((n as RawNode).content);
      if (!part.length) continue;
      if (out.length) out.push({ kind: "hardBreak" });
      out.push(...part);
    } else {
      const one = mapInline(n);
      if (one) out.push(one);
    }
  }
  return out;
}

const withContainer = (c: Ctx): Ctx => ({ ...c, insideContainer: true });
const blocks = (content: unknown, c: Ctx): Block[] =>
  (Array.isArray(content) ? content : []).map((n) => mapBlock(n, c)).filter((x): x is Block => Boolean(x));
const listItems = (content: unknown, c: Ctx): Block[][] =>
  (Array.isArray(content) ? content : [])
    .filter((li) => (li as RawNode)?.type === "listItem")
    .map((li) => blocks((li as RawNode).content, withContainer(c)));

function mapBlock(raw: unknown, c: Ctx): Block | null {
  const n = raw as RawNode;
  if (typeof n?.type !== "string") return null;
  const a = n.attrs ?? {};
  const align = pick<Align>(new Set(["left", "center", "right"]), a.textAlign, "left");
  switch (n.type) {
    case "heading":
      return { kind: "heading", level: a.level === 3 ? 3 : 2, align, art: pick(HEADING_ARTS, a.art, "none"), content: inlines(n.content) };
    case "paragraph":
      return { kind: "paragraph", align, content: inlines(n.content) };
    case "blockquote":
      return { kind: "blockquote", content: blocks(n.content, withContainer(c)) };
    case "bulletList":
      return { kind: "bulletList", items: listItems(n.content, c) };
    case "orderedList":
      return { kind: "orderedList", items: listItems(n.content, c) };
    case "dialogueBubble":
      return { kind: "dialogueBubble", name: str(a.name), side: a.side === "right" ? "right" : "left", hue: monogramHue(a.name), content: bubbleInlines(n.content) };
    case "statCard":
      return {
        kind: "statCard", title: str(a.title),
        rows: (Array.isArray(a.rows) ? a.rows : []).map((r) => ({ k: str((r as RawNode & { k?: unknown })?.k), v: str((r as { v?: unknown })?.v) })),
      };
    case "spoiler":
      return { kind: "spoiler", title: str(a.title), content: blocks(n.content, withContainer(c)) };
    case "divider":
      return { kind: "divider" };
    case "image": {
      const src = str(a.src);
      if (!src) return null;
      const width = c.insideColumn ? 100 : typeof a.width === "number" && IMAGE_WIDTHS.has(a.width) ? a.width : 100;
      return { kind: "image", src, width, frame: pick(IMAGE_FRAMES, a.frame, "default") };
    }
    case "panel":
      if (c.insideContainer) return null;
      return { kind: "panel", tone: pick(PANEL_TONES, a.tone, "gold"), content: blocks(n.content, withContainer(c)) };
    case "columns": {
      if (c.insideContainer || c.insideColumns) return null;
      const inner: Ctx = { insideColumns: true, insideColumn: true, insideContainer: true };
      const columns = (Array.isArray(n.content) ? n.content : [])
        .filter((col) => (col as RawNode)?.type === "column")
        .map((col) => blocks((col as RawNode).content, inner));
      return { kind: "columns", columns };
    }
    case "profileCard":
      return {
        kind: "profileCard", name: str(a.name), subtitle: str(a.subtitle), desc: str(a.desc),
        avatarSrc: str(a.avatarSrc) || str(a.bgSrc), bgSrc: str(a.bgSrc),
        tags: (Array.isArray(a.tags) ? a.tags : []).filter((t): t is string => typeof t === "string" && t !== ""),
        hue: monogramHue(a.name),
      };
    case "gallery":
      return {
        kind: "gallery",
        items: (Array.isArray(a.items) ? a.items : []).map((it) => ({ src: str((it as { src?: unknown })?.src) })).filter((it) => it.src),
        width: typeof a.width === "number" && IMAGE_WIDTHS.has(a.width) ? a.width : 33,
      };
    case "meter": {
      const v = typeof a.value === "number" && Number.isFinite(a.value) ? Math.round(a.value) : 0;
      return { kind: "meter", label: str(a.label), value: Math.min(100, Math.max(0, v)), tone: pick(new Set(Object.keys(HIGHLIGHT_TONE)), a.tone, "gold") };
    }
    default:
      return null;
  }
}

/** 頂層入口。結構不對就丟錯，讓呼叫端回落到預設版面。 */
export function mapDoc(doc: unknown): Doc {
  const d = doc as RawNode;
  if (!d || d.type !== "doc" || !Array.isArray(d.content)) throw new Error("invalid doc");
  return { kind: "doc", content: blocks(d.content, {}) };
}
