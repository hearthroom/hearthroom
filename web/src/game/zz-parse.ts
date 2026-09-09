/**
 * 把一則 AI 回覆拆成「敘事」與「遊戲狀態」。
 *
 * 卡片約定 AI 每一輪吐三個區塊（標籤名、INI 節名、欄位名全部由作者配置的 protocol 決定，程式只認語義）：
 *   <title>a|b|c</title>                        這一輪的標題碎片
 *   <hud>[hero]…[scene]…[actions]…</hud>          INI 形狀的 HUD：主角欄位、場景欄位、可選行動
 *   <roles>[角色1]…[角色2]…</roles>               台上每個角色的欄位（數值、心情…）
 * 對話頁靠作者的正則規則把它們換成版面；遊戲頁不換版面，直接讀成資料去驅動舞台。
 *
 * 敘事 = 去掉這三個區塊、去掉作者的開局面板觸發字（【开局配置N】等）、去掉非標準標籤後剩下的文字。
 * 串流途中區塊還沒收尾也要能讀：從最後一個沒閉合的開標籤開始截掉，敘事不會被半截的 key=value 汙染。
 */
import { DEFAULT_GAME_SPEC, type MeterJson, type ProtocolJson } from "../../../shared/game-spec";

export interface GameAction { short: string; full: string }
/** meters：協定裡宣告的每一條數值（key → 數字或 null＝這一輪沒給） */
export interface GameRole { name: string; meters: Record<string, number | null>; fields: Record<string, string> }
export interface GameTurn {
  title: string[];
  prose: string;
  hero: Record<string, string>;
  scene: Record<string, string>;
  actions: GameAction[];
  roles: GameRole[];
}

/** 解析器要的那一小撮設定；預設＝現行 zz 協定與好感度一條數值 */
export interface ParseOptions { protocol: ProtocolJson; meters: MeterJson[] }
export const DEFAULT_PARSE: ParseOptions = { protocol: DEFAULT_GAME_SPEC.protocol, meters: DEFAULT_GAME_SPEC.hud.meters };

// i18n-ignore：開局面板觸發字是酒館卡的慣例（資料），照原文比對。
const OPENING_TOKENS = /【开局(?:配置|样式|引擎)\d*】/g;
const UNKNOWN_TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?>/gi;
const KNOWN_INLINE = new Set(["b", "i", "em", "strong", "br", "u", "s", "span"]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** INI：`[节]` 開節、`key=value` 一行一欄；value 裡的 = 保留。 */
function parseIni(text: string): { name: string; fields: Record<string, string> }[] {
  const sections: { name: string; fields: Record<string, string> }[] = [];
  let cur: { name: string; fields: Record<string, string> } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sec = line.match(/^\[(.+?)\]$/);
    if (sec) { cur = { name: sec[1].trim(), fields: {} }; sections.push(cur); continue; }
    const eq = line.indexOf("=");
    if (eq < 0 || !cur) continue;
    cur.fields[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
}

function actionsOf(fields: Record<string, string>, p: ProtocolJson): GameAction[] {
  const out: GameAction[] = [];
  for (let i = 1; i <= 9; i++) {
    const full = fields[p.actions.full.replace("{n}", String(i))];
    const short = fields[p.actions.short.replace("{n}", String(i))];
    if (!full && !short) continue;
    out.push({ short: short || full, full: full || short });
  }
  return out;
}

function stripProse(text: string): string {
  return text
    .replace(OPENING_TOKENS, "")
    .replace(UNKNOWN_TAG, (m) => (KNOWN_INLINE.has(m.replace(/^<\/?|[\s>].*$/gs, "").toLowerCase()) ? m : ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const numOf = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number(String(v).replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) && /\d/.test(v) ? n : null;
};

export function parseTurn(text: string, opts: ParseOptions = DEFAULT_PARSE): GameTurn {
  const p = opts.protocol;
  const turn: GameTurn = { title: [], prose: "", hero: {}, scene: {}, actions: [], roles: [] };
  const tags = [p.blocks.title, p.blocks.hud, p.blocks.roles].map(esc).join("|");
  const block = new RegExp(`<(${tags})>([\\s\\S]*?)<\\/\\1>`, "g");
  // 還在串流的半截區塊：從最後一個沒閉合的開標籤截掉。標籤名可能只送到一半（<zzro），
  // 所以比對的是協定裡三個標籤名的每一個前綴（長的先試），不是任意 <字母
  const openTail = new RegExp(`<(?:${tagPrefixes([p.blocks.title, p.blocks.hud, p.blocks.roles])})(?:>[\\s\\S]*)?$`);
  let rest = String(text || "");
  rest = rest.replace(block, (_m, tag: string, body: string) => {
    if (tag === p.blocks.title) {
      turn.title = body.split(p.titleSeparator).map((s) => s.trim()).filter(Boolean);
    } else if (tag === p.blocks.hud) {
      for (const s of parseIni(body)) {
        if (s.name === p.sections.hero) turn.hero = s.fields;
        else if (s.name === p.sections.scene) turn.scene = s.fields;
        else if (s.name === p.sections.actions) turn.actions = actionsOf(s.fields, p);
      }
    } else {
      turn.roles = parseIni(body)
        .filter((s) => s.fields[p.fields.name])
        .map((s) => ({
          name: s.fields[p.fields.name],
          meters: Object.fromEntries(opts.meters.map((m) => [m.key, numOf(s.fields[m.key])])),
          fields: s.fields,
        }));
    }
    return "";
  });
  rest = rest.replace(openTail, "");
  turn.prose = stripProse(rest);
  return turn;
}

function tagPrefixes(tags: string[]): string {
  const set = new Set<string>();
  for (const t of tags) for (let i = 1; i <= t.length; i++) set.add(t.slice(0, i));
  return [...set].sort((a, b) => b.length - a.length).map(esc).join("|");
}

/** 新一輪沒提到的欄位沿用上一輪：AI 常只回有變化的部分。 */
export function mergeTurn(prev: GameTurn, next: GameTurn): GameTurn {
  const roles = prev.roles.map((r) => ({ ...r, meters: { ...r.meters }, fields: { ...r.fields } }));
  for (const nr of next.roles) {
    const hit = roles.find((r) => r.name === nr.name);
    if (!hit) { roles.push(nr); continue; }
    hit.fields = { ...hit.fields, ...nr.fields };
    for (const [k, v] of Object.entries(nr.meters)) if (v !== null) hit.meters[k] = v;
  }
  return {
    title: next.title.length ? next.title : prev.title,
    prose: next.prose,
    hero: { ...prev.hero, ...next.hero },
    scene: { ...prev.scene, ...next.scene },
    actions: next.actions.length ? next.actions : prev.actions,
    roles,
  };
}

/** 協定裡「還沒有值」的寫法（作者用正則宣告，例如 未登记|未设定）。 */
export function isUnset(v: string | undefined, p: ProtocolJson = DEFAULT_PARSE.protocol): boolean {
  if (!v) return true;
  if (!p.fields.unset) return false;
  try { return new RegExp(p.fields.unset).test(v); } catch { return false; }
}

/** 敘事裡最後被點到名的角色，當成這一刻的說話者。 */
export function speakerOf(prose: string, names: string[]): string {
  let best = "";
  let at = -1;
  for (const n of names) {
    const i = prose.lastIndexOf(n);
    if (i > at) { at = i; best = n; }
  }
  return best;
}

/**
 * 一段敘事切成台詞／心理／旁白三種片段，畫面用不同顏色區分。
 * 台詞＝成對引號（“ ” " " 「 」『 』）；心理＝成對括號（（ ）( )）或 *…*；其餘是旁白。
 * 只認成對的記號，落單的引號當普通文字，不會把後半段全吃進去。
 */
export type SpeechKind = "say" | "thought" | "narr";
export interface SpeechSegment { kind: SpeechKind; text: string }
const SPEECH = /(“[^”]{1,400}”|"[^"\n]{1,400}"|「[^」]{1,400}」|『[^』]{1,400}』)|(（[^）]{1,400}）|\([^)\n]{1,400}\)|\*[^*\n]{1,400}\*)/g;
export function splitSpeech(text: string): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(SPEECH)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "narr", text: text.slice(last, at) });
    out.push({ kind: m[1] ? "say" : "thought", text: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "narr", text: text.slice(last) });
  return out;
}
