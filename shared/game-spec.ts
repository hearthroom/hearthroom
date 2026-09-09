/**
 * 遊戲模式的卡片配置 v2（作者在編輯器裡存的那份 JSON）。
 *
 * 設計原則（owner 2026-09-09）：**全部資料驅動**。換一個題材（酒館、飛船、地牢、宮鬥）不改程式，
 * 只改這份配置。所以協定欄位名、面板要顯示哪些欄位與數值條、光照預設、世界套件與擺設、角色外觀、
 * 鏡頭與移動、音效事件，都在這裡宣告；程式只認語義（哪個欄位是「名字」、哪個是「時間」），不認中文字。
 *
 * Worker 存讀時驗它，前端編輯器存之前也驗它——同一份規則，兩邊不會漂。驗過的結果是**補滿預設值**
 * 的完整配置（預設＝通用校園），作者只寫他在乎的部分。
 *
 * 只收 version 2。v1 已在 0007 遷移一次性換掉（線上只有兩筆），不再相容。
 *
 * 資源一律用網址：站台自己的路徑（/game/...）或 https。作者資源庫能放圖片與音訊，3D 模型目前用外部網址。
 */

export type XZ = [number, number];
export type HairStyle = "short" | "long" | "twin" | "bob";
export type Accessory = "none" | "halo-hex" | "halo-ring" | "halo-arc";
export type PropShape = "box" | "cylinder" | "sphere" | "model";
export type EnvironmentKit = "campus" | "none";
export type QuestMode = "objective-mentions-name" | "field-truthy" | "none";
export type DialogueCamera = "two-shot" | "follow";
export type GateBlock = "roles" | "hud" | "none";

export interface ModelJson {
  url: string;
  /** 目標身高（世界單位，人偶約 2.2） */
  height?: number;
  /** 模型原生朝向相對 +z 的偏轉（弧度） */
  yaw?: number;
  clips?: { idle?: string; walk?: string; talk?: string };
}

/** AI 回覆裡的三個區塊怎麼寫：標籤名、INI 節名、各語義對應的欄位名。程式只認左邊的語義，不認右邊的字。 */
export interface ProtocolJson {
  blocks: { title: string; hud: string; roles: string };
  sections: { hero: string; scene: string; actions: string };
  fields: {
    /** 角色區塊裡「這一節是誰」的欄位（必填） */
    name: string;
    mood?: string;
    time?: string;
    place?: string;
    objective?: string;
    round?: string;
    note?: string;
    /** 「還沒有值」的寫法（正則），例如 未登记|未设定 */
    unset?: string;
  };
  /** 行動欄位名樣式，{n} 是序號：選項{n}／選項{n}短 */
  actions: { full: string; short: string };
  titleSeparator: string;
  /** 開場白裡要有哪個區塊才算「這張卡能開遊戲」 */
  gate: GateBlock;
}

export interface FieldRef { key: string; label?: string }
export interface MeterJson { key: string; label?: string; min: number; max: number; color?: string }
export interface HudJson {
  /** 主角欄位（左側面板） */
  hero: FieldRef[];
  /** 場景欄位（頂欄） */
  scene: FieldRef[];
  /** 角色卡上除數值條外還要顯示的欄位 */
  role: FieldRef[];
  /** 數值條；第一條是主數值（頭頂標籤與音效事件用它） */
  meters: MeterJson[];
  /** 「這個角色跟當前目標有關」的判定 */
  questRule: { mode: QuestMode; field?: string };
}

export interface LightPresetJson {
  id: string;
  /** 場景「時間」欄位符合這個正則就用這套；沒 match 的只能當 default */
  match?: string;
  skyTop: string; skyBottom: string;
  /** 地面色的乘數（#ffffff＝原色；夜晚壓暗、黃昏偏暖），乘在 environment.ground.color 上 */
  ground: string;
  sun: string; sunIntensity: number; sunPos: [number, number, number];
  hemi: number; fog: string; fogNear: number; fogFar: number;
  /** 燈與窗的自發光強度、Bloom 強度 */
  lamp: number; bloom: number;
}
export interface LightingJson { presets: LightPresetJson[]; default: string }

export interface PlaceJson { match: string; pos: XZ; label: string }
export interface BuildingJson { pos: XZ; size: [number, number, number]; color?: string; label?: string }
export interface PropJson {
  shape: PropShape;
  /** shape=model 時的 GLB 網址 */
  url?: string;
  pos: XZ;
  /** 底部離地高度 */
  y?: number;
  size: [number, number, number];
  /** 繞 y 軸（弧度） */
  rotation?: number;
  color?: string;
  /** 自發光顏色（燈、螢幕、火光） */
  emissive?: string;
  label?: string;
  /** 擋路（預設 true） */
  solid?: boolean;
}
export interface EnvironmentJson {
  /** campus＝程序化校園（道路、廣場、樹籬、天際線、全息終端）；none＝只有地面與你放的東西 */
  kit: EnvironmentKit;
  ground: { color: string; texture: "grid" | "plaza" | "plain" | string; size: number };
  /** 地平線全景板 */
  sky?: string;
  skyline: boolean;
  clouds: boolean;
  buildings: BuildingJson[];
  trees: XZ[];
  lamps: XZ[];
  places: PlaceJson[];
  props: PropJson[];
}

export interface LookJson { skin?: string; hair: string; hairStyle: HairStyle; top?: string; bottom?: string; accent?: string }
export interface CharacterJson {
  /** 要跟 AI 回覆角色區塊裡的「名字」一致 */
  name: string;
  /** 主色：頭頂標籤、光環、補光 */
  color: string;
  look: LookJson;
  accessory: Accessory;
  pos: XZ;
  face: number;
  wander: number;
  model?: ModelJson;
}
export interface PlayerJson { spawn: XZ; speed: number; look: LookJson; model?: ModelJson }
/** height 是在 distance 那個距離時鏡頭的高度；拉近拉遠時俯角不變 */
export interface CameraJson { distance: number; minDistance: number; maxDistance: number; height: number; dialogue: DialogueCamera }
export interface AudioJson {
  /** 鍵名自由，網址 */
  sources: Record<string, string>;
  /** 事件 → sources 的鍵 */
  events: { footstep?: string; uiOpen?: string; uiClose?: string; meterUp?: string; meterDown?: string; travel?: string; quest?: string };
  /** 光照預設 id → 環境音鍵 */
  ambience: Record<string, string>;
}

export interface GameSpecJson {
  version: 2;
  enabled: boolean;
  protocol: ProtocolJson;
  hud: HudJson;
  lighting: LightingJson;
  environment: EnvironmentJson;
  characters: CharacterJson[];
  player: PlayerJson;
  camera: CameraJson;
  audio: AudioJson;
}
/** 作者寫的那份：每一層都可省略，驗證時補預設 */
export type GameSpecInput = { version: 2; enabled?: boolean } & DeepPartial<Omit<GameSpecJson, "version" | "enabled">>;
type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const GAME_SPEC_MAX_BYTES = 96 * 1024;
export const AUDIO_EVENTS = ["footstep", "uiOpen", "uiClose", "meterUp", "meterDown", "travel", "quest"] as const;
export const HAIR_STYLES: HairStyle[] = ["short", "long", "twin", "bob"];
export const ACCESSORIES: Accessory[] = ["none", "halo-hex", "halo-ring", "halo-arc"];
export const PROP_SHAPES: PropShape[] = ["box", "cylinder", "sphere", "model"];
const LIMITS = { characters: 12, places: 20, buildings: 40, trees: 80, lamps: 40, props: 120, presets: 12, meters: 6, fields: 12, str: 200, coord: 200, size: 60, sources: 40 };

// i18n-ignore：預設值裡的中文是卡片協定的欄位名（資料），不是介面文案。
/** 預設配置＝通用校園＋現行的 zz 協定。作者省略的每一層都從這裡補。 */
export const DEFAULT_GAME_SPEC: GameSpecJson = {
  version: 2,
  enabled: true,
  protocol: {
    blocks: { title: "zzt", hud: "zzhud", roles: "zzroles" },
    sections: { hero: "主角", scene: "场景", actions: "行动" },
    fields: { name: "名字", mood: "心理活动", time: "时间", place: "地点", objective: "当前目标", round: "当前轮次", note: "便签", unset: "未登记|未设定" },
    actions: { full: "选项{n}", short: "选项{n}短" },
    titleSeparator: "|",
    gate: "roles",
  },
  hud: {
    hero: [{ key: "名字" }, { key: "身份" }, { key: "外貌" }, { key: "能力" }],
    scene: [{ key: "时间" }, { key: "地点" }],
    role: [{ key: "身份" }],
    meters: [{ key: "好感度", min: 0, max: 100, color: "#ff6b8a" }],
    questRule: { mode: "objective-mentions-name" },
  },
  lighting: {
    default: "day",
    presets: [
      { id: "day", skyTop: "#2f6fe0", skyBottom: "#d6e9ff", ground: "#ffffff", sun: "#fff1d6", sunIntensity: 2.6, sunPos: [22, 34, 10], hemi: 0.95, fog: "#c8dcf6", fogNear: 80, fogFar: 175, lamp: 0.1, bloom: 0.18 },
      { id: "dusk", match: "黄昏|傍晚|夕|日落", skyTop: "#3b2470", skyBottom: "#ff9e66", ground: "#ffcaa8", sun: "#ff9a55", sunIntensity: 1.7, sunPos: [-30, 9, 6], hemi: 0.5, fog: "#e6a58a", fogNear: 80, fogFar: 175, lamp: 0.8, bloom: 0.32 },
      { id: "night", match: "夜|晚|凌晨|深更", skyTop: "#03061a", skyBottom: "#1a2550", ground: "#3a405c", sun: "#8fa8ff", sunIntensity: 0.5, sunPos: [-10, 26, -16], hemi: 0.22, fog: "#0f1838", fogNear: 80, fogFar: 175, lamp: 1.1, bloom: 0.42 },
    ],
  },
  environment: {
    kit: "campus",
    ground: { color: "#b9cfe0", texture: "grid", size: 220 },
    skyline: true,
    clouds: true,
    buildings: [
      { pos: [0, -14], size: [14, 8, 10] },
      { pos: [-18, -10], size: [10, 6, 8], color: "#eef3fb" },
      { pos: [18, -10], size: [10, 6, 8], color: "#fff4ea" },
      { pos: [-20, 14], size: [7, 5, 7], color: "#f3f7ff" },
      { pos: [20, 14], size: [7, 5, 7], color: "#f6ecff" },
    ],
    trees: [[-8, 12], [8, 12], [-8, 20], [8, 20], [-26, 0], [26, 0], [-14, 22], [14, 22], [-30, -14], [30, -14]],
    lamps: [[-4, 6], [4, 6], [-4, 16], [4, 16], [-10, -4], [10, -4]],
    places: [
      { match: "西|左", pos: [-12, 3], label: "西侧" },
      { match: "东|右|教室|课堂", pos: [12, 3], label: "东侧" },
      { match: "北|大厅|办公室|会议", pos: [0, -6], label: "主楼前" },
      { match: "南|门|广场|入口|街", pos: [0, 20], label: "广场" },
    ],
    props: [],
  },
  characters: [],
  player: { spawn: [0, 8], speed: 4, look: { hair: "#3a2a22", hairStyle: "short", top: "#2b2f45", bottom: "#2b2f45" } },
  camera: { distance: 9.5, minDistance: 5, maxDistance: 18, height: 4.6, dialogue: "two-shot" },
  audio: { sources: {}, events: {}, ambience: {} },
};

export type ValidateResult = { ok: true; spec: GameSpecJson; errors: [] } | { ok: false; spec: null; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isUrl = (v: unknown): v is string => typeof v === "string" && v.length <= 500 && (/^https:\/\/[^\s]+$/.test(v) || /^\/[^\s]*$/.test(v));
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const xz = (v: unknown): v is XZ => Array.isArray(v) && v.length === 2 && num(v[0], -LIMITS.coord, LIMITS.coord) && num(v[1], -LIMITS.coord, LIMITS.coord);
const str = (v: unknown, max = LIMITS.str): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const color = (v: unknown): v is string => typeof v === "string" && /^(#[0-9a-fA-F]{3,8}|hsl\([^)]{1,40}\)|rgb\([^)]{1,40}\))$/.test(v);
const regexOk = (v: string): boolean => { try { new RegExp(v); return true; } catch { return false; } };
const oneOf = <T extends string>(v: unknown, set: readonly T[]): v is T => typeof v === "string" && (set as readonly string[]).includes(v);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * 「補預設」的讀法：作者給了就驗，沒給就用預設。每個 reader 回最終值並把問題推進 errors。
 */
class Ctx {
  errors: string[] = [];
  bad(path: string, why: string) { this.errors.push(`${path} ${why}`); }
}

function readModel(v: unknown, path: string, c: Ctx): ModelJson | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v) || !isUrl(v.url)) { c.bad(`${path}.url`, "must be a site path or https url"); return undefined; }
  const out: ModelJson = { url: v.url };
  if (v.height !== undefined) { if (num(v.height, 0.5, 10)) out.height = v.height; else c.bad(`${path}.height`, "must be 0.5-10"); }
  if (v.yaw !== undefined) { if (num(v.yaw, -7, 7)) out.yaw = v.yaw; else c.bad(`${path}.yaw`, "must be radians"); }
  if (v.clips !== undefined) {
    if (!isObj(v.clips)) c.bad(`${path}.clips`, "must be an object");
    else {
      out.clips = {};
      for (const k of ["idle", "walk", "talk"] as const) {
        const s = v.clips[k];
        if (s === undefined) continue;
        if (str(s, 60)) out.clips[k] = s; else c.bad(`${path}.clips.${k}`, "invalid");
      }
    }
  }
  return out;
}

function readStr(v: unknown, d: string, path: string, c: Ctx, max = LIMITS.str): string {
  if (v === undefined) return d;
  if (str(v, max)) return v;
  c.bad(path, `must be 1-${max} chars`); return d;
}
function readOptStr(v: unknown, d: string | undefined, path: string, c: Ctx): string | undefined {
  if (v === undefined) return d;
  if (v === "" || v === null) return undefined;
  if (str(v)) return v;
  c.bad(path, "invalid"); return d;
}
function readNum(v: unknown, d: number, lo: number, hi: number, path: string, c: Ctx): number {
  if (v === undefined) return d;
  if (num(v, lo, hi)) return v;
  c.bad(path, `must be ${lo}-${hi}`); return d;
}
function readBool(v: unknown, d: boolean, path: string, c: Ctx): boolean {
  if (v === undefined) return d;
  if (typeof v === "boolean") return v;
  c.bad(path, "must be true or false"); return d;
}
function readColor(v: unknown, d: string, path: string, c: Ctx): string {
  if (v === undefined) return d;
  if (color(v)) return v;
  c.bad(path, "must be a css color (#rgb, hsl(), rgb())"); return d;
}
function readOptColor(v: unknown, d: string | undefined, path: string, c: Ctx): string | undefined {
  if (v === undefined) return d;
  if (v === "" || v === null) return undefined;
  if (color(v)) return v;
  c.bad(path, "must be a css color"); return d;
}
function readXZ(v: unknown, d: XZ, path: string, c: Ctx): XZ {
  if (v === undefined) return d;
  if (xz(v)) return [v[0], v[1]];
  c.bad(path, "must be [x, z]"); return d;
}
function readXZList(v: unknown, d: XZ[], path: string, max: number, c: Ctx): XZ[] {
  if (v === undefined) return clone(d);
  if (!Array.isArray(v)) { c.bad(path, "must be a list"); return clone(d); }
  if (v.length > max) c.bad(path, `at most ${max}`);
  const out: XZ[] = [];
  v.slice(0, max).forEach((p, i) => { if (xz(p)) out.push([p[0], p[1]]); else c.bad(`${path}[${i}]`, "must be [x, z]"); });
  return out;
}
function readFields(v: unknown, d: FieldRef[], path: string, c: Ctx): FieldRef[] {
  if (v === undefined) return clone(d);
  if (!Array.isArray(v)) { c.bad(path, "must be a list"); return clone(d); }
  if (v.length > LIMITS.fields) c.bad(path, `at most ${LIMITS.fields}`);
  const out: FieldRef[] = [];
  v.slice(0, LIMITS.fields).forEach((f, i) => {
    if (!isObj(f) || !str(f.key, 60)) { c.bad(`${path}[${i}].key`, "required"); return; }
    const r: FieldRef = { key: f.key };
    const label = readOptStr(f.label, undefined, `${path}[${i}].label`, c); if (label) r.label = label;
    out.push(r);
  });
  return out;
}

function readProtocol(v: unknown, c: Ctx): ProtocolJson {
  const d = DEFAULT_GAME_SPEC.protocol;
  if (v === undefined) return clone(d);
  if (!isObj(v)) { c.bad("protocol", "must be an object"); return clone(d); }
  const b = isObj(v.blocks) ? v.blocks : {}, s = isObj(v.sections) ? v.sections : {}, f = isObj(v.fields) ? v.fields : {}, a = isObj(v.actions) ? v.actions : {};
  const tag = (x: unknown, dd: string, p: string) => { const t = readStr(x, dd, p, c, 40); if (!/^[a-z][a-z0-9-]*$/.test(t)) { c.bad(p, "must be a lowercase tag name"); return dd; } return t; };
  const out: ProtocolJson = {
    blocks: { title: tag(b.title, d.blocks.title, "protocol.blocks.title"), hud: tag(b.hud, d.blocks.hud, "protocol.blocks.hud"), roles: tag(b.roles, d.blocks.roles, "protocol.blocks.roles") },
    sections: { hero: readStr(s.hero, d.sections.hero, "protocol.sections.hero", c, 40), scene: readStr(s.scene, d.sections.scene, "protocol.sections.scene", c, 40), actions: readStr(s.actions, d.sections.actions, "protocol.sections.actions", c, 40) },
    fields: { name: readStr(f.name, d.fields.name, "protocol.fields.name", c, 60) },
    actions: { full: readStr(a.full, d.actions.full, "protocol.actions.full", c, 60), short: readStr(a.short, d.actions.short, "protocol.actions.short", c, 60) },
    titleSeparator: readStr(v.titleSeparator, d.titleSeparator, "protocol.titleSeparator", c, 4),
    gate: oneOf(v.gate, ["roles", "hud", "none"] as const) ? v.gate : v.gate === undefined ? d.gate : (c.bad("protocol.gate", "must be roles, hud or none"), d.gate),
  };
  for (const k of ["mood", "time", "place", "objective", "round", "note", "unset"] as const) {
    const val = readOptStr(f[k], d.fields[k], `protocol.fields.${k}`, c);
    if (val !== undefined) out.fields[k] = val;
  }
  if (out.fields.unset && !regexOk(out.fields.unset)) { c.bad("protocol.fields.unset", "is not a valid regular expression"); out.fields.unset = d.fields.unset; }
  if (!out.actions.full.includes("{n}") || !out.actions.short.includes("{n}")) c.bad("protocol.actions", "patterns must contain {n}");
  return out;
}

function readHud(v: unknown, c: Ctx): HudJson {
  const d = DEFAULT_GAME_SPEC.hud;
  if (v === undefined) return clone(d);
  if (!isObj(v)) { c.bad("hud", "must be an object"); return clone(d); }
  const meters: MeterJson[] = [];
  if (v.meters === undefined) meters.push(...clone(d.meters));
  else if (!Array.isArray(v.meters)) c.bad("hud.meters", "must be a list");
  else {
    if (v.meters.length > LIMITS.meters) c.bad("hud.meters", `at most ${LIMITS.meters}`);
    v.meters.slice(0, LIMITS.meters).forEach((m, i) => {
      const p = `hud.meters[${i}]`;
      if (!isObj(m) || !str(m.key, 60)) { c.bad(`${p}.key`, "required"); return; }
      const min = readNum(m.min, 0, -1e6, 1e6, `${p}.min`, c), max = readNum(m.max, 100, -1e6, 1e6, `${p}.max`, c);
      if (max <= min) c.bad(p, "max must be greater than min");
      const r: MeterJson = { key: m.key, min, max };
      const label = readOptStr(m.label, undefined, `${p}.label`, c); if (label) r.label = label;
      const col = readOptColor(m.color, undefined, `${p}.color`, c); if (col) r.color = col;
      meters.push(r);
    });
  }
  const q = isObj(v.questRule) ? v.questRule : undefined;
  const questRule: HudJson["questRule"] = q
    ? { mode: oneOf(q.mode, ["objective-mentions-name", "field-truthy", "none"] as const) ? q.mode : (c.bad("hud.questRule.mode", "invalid"), d.questRule.mode) }
    : clone(d.questRule);
  if (q) { const field = readOptStr(q.field, undefined, "hud.questRule.field", c); if (field) questRule.field = field; }
  if (questRule.mode === "field-truthy" && !questRule.field) c.bad("hud.questRule.field", "required for field-truthy");
  return {
    hero: readFields(v.hero, d.hero, "hud.hero", c),
    scene: readFields(v.scene, d.scene, "hud.scene", c),
    role: readFields(v.role, d.role, "hud.role", c),
    meters,
    questRule,
  };
}

function readLighting(v: unknown, c: Ctx): LightingJson {
  const d = DEFAULT_GAME_SPEC.lighting;
  if (v === undefined) return clone(d);
  if (!isObj(v)) { c.bad("lighting", "must be an object"); return clone(d); }
  let presets: LightPresetJson[];
  if (v.presets === undefined) presets = clone(d.presets);
  else if (!Array.isArray(v.presets) || !v.presets.length) { c.bad("lighting.presets", "must be a non-empty list"); presets = clone(d.presets); }
  else {
    if (v.presets.length > LIMITS.presets) c.bad("lighting.presets", `at most ${LIMITS.presets}`);
    presets = [];
    const seen = new Set<string>();
    v.presets.slice(0, LIMITS.presets).forEach((p, i) => {
      const path = `lighting.presets[${i}]`;
      if (!isObj(p) || !str(p.id, 40)) { c.bad(`${path}.id`, "required"); return; }
      if (seen.has(p.id)) c.bad(`${path}.id`, "duplicated"); seen.add(p.id);
      const base = d.presets.find((x) => x.id === p.id) || d.presets[0];
      const r: LightPresetJson = {
        id: p.id,
        skyTop: readColor(p.skyTop, base.skyTop, `${path}.skyTop`, c), skyBottom: readColor(p.skyBottom, base.skyBottom, `${path}.skyBottom`, c),
        ground: readColor(p.ground, base.ground, `${path}.ground`, c), sun: readColor(p.sun, base.sun, `${path}.sun`, c),
        sunIntensity: readNum(p.sunIntensity, base.sunIntensity, 0, 10, `${path}.sunIntensity`, c),
        sunPos: base.sunPos, hemi: readNum(p.hemi, base.hemi, 0, 5, `${path}.hemi`, c),
        fog: readColor(p.fog, base.fog, `${path}.fog`, c), fogNear: readNum(p.fogNear, base.fogNear, 1, 1000, `${path}.fogNear`, c), fogFar: readNum(p.fogFar, base.fogFar, 2, 2000, `${path}.fogFar`, c),
        lamp: readNum(p.lamp, base.lamp, 0, 5, `${path}.lamp`, c), bloom: readNum(p.bloom, base.bloom, 0, 2, `${path}.bloom`, c),
      };
      if (p.sunPos !== undefined) { if (Array.isArray(p.sunPos) && p.sunPos.length === 3 && p.sunPos.every((n) => num(n, -200, 200))) r.sunPos = [p.sunPos[0], p.sunPos[1], p.sunPos[2]]; else c.bad(`${path}.sunPos`, "must be [x, y, z]"); }
      const match = readOptStr(p.match, undefined, `${path}.match`, c);
      if (match) { if (regexOk(match)) r.match = match; else c.bad(`${path}.match`, "is not a valid regular expression"); }
      presets.push(r);
    });
    if (!presets.length) presets = clone(d.presets);
  }
  let def = v.default === undefined ? (presets.find((p) => p.id === d.default) ? d.default : presets[0].id) : String(v.default);
  if (!presets.find((p) => p.id === def)) { c.bad("lighting.default", "must be one of the preset ids"); def = presets[0].id; }
  return { presets, default: def };
}

function readEnvironment(v: unknown, c: Ctx): EnvironmentJson {
  const d = DEFAULT_GAME_SPEC.environment;
  if (v === undefined) return clone(d);
  if (!isObj(v)) { c.bad("environment", "must be an object"); return clone(d); }
  const g = isObj(v.ground) ? v.ground : {};
  let texture = d.ground.texture;
  if (g.texture !== undefined) {
    if (oneOf(g.texture, ["grid", "plaza", "plain"] as const) || isUrl(g.texture)) texture = g.texture; else c.bad("environment.ground.texture", "must be grid, plaza, plain or a url");
  }
  const out: EnvironmentJson = {
    kit: oneOf(v.kit, ["campus", "none"] as const) ? v.kit : v.kit === undefined ? d.kit : (c.bad("environment.kit", "must be campus or none"), d.kit),
    ground: { color: readColor(g.color, d.ground.color, "environment.ground.color", c), texture, size: readNum(g.size, d.ground.size, 20, 600, "environment.ground.size", c) },
    skyline: readBool(v.skyline, d.skyline, "environment.skyline", c),
    clouds: readBool(v.clouds, d.clouds, "environment.clouds", c),
    buildings: [], trees: readXZList(v.trees, d.trees, "environment.trees", LIMITS.trees, c), lamps: readXZList(v.lamps, d.lamps, "environment.lamps", LIMITS.lamps, c), places: [], props: [],
  };
  if (v.sky !== undefined && v.sky !== "" && v.sky !== null) { if (isUrl(v.sky)) out.sky = v.sky; else c.bad("environment.sky", "must be a url"); }
  if (v.buildings === undefined) out.buildings = clone(d.buildings);
  else if (!Array.isArray(v.buildings)) c.bad("environment.buildings", "must be a list");
  else {
    if (v.buildings.length > LIMITS.buildings) c.bad("environment.buildings", `at most ${LIMITS.buildings}`);
    v.buildings.slice(0, LIMITS.buildings).forEach((b, i) => {
      const p = `environment.buildings[${i}]`;
      if (!isObj(b) || !xz(b.pos) || !Array.isArray(b.size) || b.size.length !== 3 || !b.size.every((n) => num(n, 0.5, LIMITS.size))) { c.bad(p, "needs pos [x, z] and size [w, h, d] (0.5-60)"); return; }
      const r: BuildingJson = { pos: [b.pos[0], b.pos[1]], size: [b.size[0], b.size[1], b.size[2]] };
      const col = readOptColor(b.color, undefined, `${p}.color`, c); if (col) r.color = col;
      const label = readOptStr(b.label, undefined, `${p}.label`, c); if (label) r.label = label;
      out.buildings.push(r);
    });
  }
  if (v.places === undefined) out.places = clone(d.places);
  else if (!Array.isArray(v.places)) c.bad("environment.places", "must be a list");
  else {
    if (v.places.length > LIMITS.places) c.bad("environment.places", `at most ${LIMITS.places}`);
    v.places.slice(0, LIMITS.places).forEach((pl, i) => {
      const p = `environment.places[${i}]`;
      if (!isObj(pl) || !str(pl.match) || !xz(pl.pos) || !str(pl.label, 60)) { c.bad(p, "needs match, pos [x, z] and label"); return; }
      if (!regexOk(pl.match)) { c.bad(`${p}.match`, "is not a valid regular expression"); return; }
      out.places.push({ match: pl.match, pos: [pl.pos[0], pl.pos[1]], label: pl.label });
    });
  }
  if (v.props !== undefined) {
    if (!Array.isArray(v.props)) c.bad("environment.props", "must be a list");
    else {
      if (v.props.length > LIMITS.props) c.bad("environment.props", `at most ${LIMITS.props}`);
      v.props.slice(0, LIMITS.props).forEach((pr, i) => {
        const p = `environment.props[${i}]`;
        if (!isObj(pr) || !oneOf(pr.shape, PROP_SHAPES)) { c.bad(`${p}.shape`, "must be box, cylinder, sphere or model"); return; }
        if (!xz(pr.pos) || !Array.isArray(pr.size) || pr.size.length !== 3 || !pr.size.every((n) => num(n, 0.05, LIMITS.size))) { c.bad(p, "needs pos [x, z] and size [w, h, d]"); return; }
        const r: PropJson = { shape: pr.shape, pos: [pr.pos[0], pr.pos[1]], size: [pr.size[0], pr.size[1], pr.size[2]] };
        if (pr.shape === "model") { if (isUrl(pr.url)) r.url = pr.url; else { c.bad(`${p}.url`, "required for shape=model"); return; } }
        if (pr.y !== undefined) r.y = readNum(pr.y, 0, -50, 100, `${p}.y`, c);
        if (pr.rotation !== undefined) r.rotation = readNum(pr.rotation, 0, -7, 7, `${p}.rotation`, c);
        const col = readOptColor(pr.color, undefined, `${p}.color`, c); if (col) r.color = col;
        const em = readOptColor(pr.emissive, undefined, `${p}.emissive`, c); if (em) r.emissive = em;
        const label = readOptStr(pr.label, undefined, `${p}.label`, c); if (label) r.label = label;
        if (pr.solid !== undefined) r.solid = readBool(pr.solid, true, `${p}.solid`, c);
        out.props.push(r);
      });
    }
  }
  return out;
}

function readLook(v: unknown, d: LookJson, path: string, c: Ctx): LookJson {
  if (v === undefined) return clone(d);
  if (!isObj(v)) { c.bad(path, "must be an object"); return clone(d); }
  const out: LookJson = {
    hair: readColor(v.hair, d.hair, `${path}.hair`, c),
    hairStyle: oneOf(v.hairStyle, HAIR_STYLES) ? v.hairStyle : v.hairStyle === undefined ? d.hairStyle : (c.bad(`${path}.hairStyle`, "invalid"), d.hairStyle),
  };
  for (const k of ["skin", "top", "bottom", "accent"] as const) { const col = readOptColor(v[k], d[k], `${path}.${k}`, c); if (col) out[k] = col; }
  return out;
}

function readCharacters(v: unknown, c: Ctx): CharacterJson[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) { c.bad("characters", "must be a list"); return []; }
  if (v.length > LIMITS.characters) c.bad("characters", `at most ${LIMITS.characters}`);
  const out: CharacterJson[] = []; const seen = new Set<string>();
  v.slice(0, LIMITS.characters).forEach((ch, i) => {
    const p = `characters[${i}]`;
    if (!isObj(ch) || !str(ch.name, 60)) { c.bad(`${p}.name`, "required"); return; }
    if (seen.has(ch.name)) c.bad(`${p}.name`, "duplicated"); seen.add(ch.name);
    const r: CharacterJson = {
      name: ch.name,
      color: readColor(ch.color, "#8fb3ff", `${p}.color`, c),
      look: readLook(ch.look, { hair: "#3a2a22", hairStyle: "short" }, `${p}.look`, c),
      accessory: oneOf(ch.accessory, ACCESSORIES) ? ch.accessory : ch.accessory === undefined ? "none" : (c.bad(`${p}.accessory`, "invalid"), "none"),
      pos: readXZ(ch.pos, [0, 0], `${p}.pos`, c),
      face: readNum(ch.face, Math.PI, -7, 7, `${p}.face`, c),
      wander: readNum(ch.wander, 2.5, 0, 20, `${p}.wander`, c),
    };
    const model = readModel(ch.model, `${p}.model`, c); if (model) r.model = model;
    out.push(r);
  });
  return out;
}

function readPlayer(v: unknown, c: Ctx): PlayerJson {
  const d = DEFAULT_GAME_SPEC.player;
  if (v === undefined) return clone(d);
  if (!isObj(v)) { c.bad("player", "must be an object"); return clone(d); }
  const out: PlayerJson = { spawn: readXZ(v.spawn, d.spawn, "player.spawn", c), speed: readNum(v.speed, d.speed, 1, 12, "player.speed", c), look: readLook(v.look, d.look, "player.look", c) };
  const model = readModel(v.model, "player.model", c); if (model) out.model = model;
  return out;
}

function readCamera(v: unknown, c: Ctx): CameraJson {
  const d = DEFAULT_GAME_SPEC.camera;
  if (v === undefined) return clone(d);
  if (!isObj(v)) { c.bad("camera", "must be an object"); return clone(d); }
  const out: CameraJson = {
    distance: readNum(v.distance, d.distance, 2, 40, "camera.distance", c),
    minDistance: readNum(v.minDistance, d.minDistance, 1, 40, "camera.minDistance", c),
    maxDistance: readNum(v.maxDistance, d.maxDistance, 2, 80, "camera.maxDistance", c),
    height: readNum(v.height, d.height, 0.5, 40, "camera.height", c),
    dialogue: oneOf(v.dialogue, ["two-shot", "follow"] as const) ? v.dialogue : v.dialogue === undefined ? d.dialogue : (c.bad("camera.dialogue", "must be two-shot or follow"), d.dialogue),
  };
  if (out.minDistance > out.maxDistance) c.bad("camera.minDistance", "must not exceed maxDistance");
  return out;
}

function readAudio(v: unknown, lighting: LightingJson, c: Ctx): AudioJson {
  const out: AudioJson = { sources: {}, events: {}, ambience: {} };
  if (v === undefined) return out;
  if (!isObj(v)) { c.bad("audio", "must be an object"); return out; }
  if (v.sources !== undefined) {
    if (!isObj(v.sources)) c.bad("audio.sources", "must be an object of key → url");
    else {
      const keys = Object.keys(v.sources); if (keys.length > LIMITS.sources) c.bad("audio.sources", `at most ${LIMITS.sources}`);
      for (const k of keys.slice(0, LIMITS.sources)) {
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(k)) { c.bad(`audio.sources.${k}`, "key must be letters, digits, _ or -"); continue; }
        const u = v.sources[k]; if (isUrl(u)) out.sources[k] = u; else c.bad(`audio.sources.${k}`, "must be a url");
      }
    }
  }
  const known = (k: unknown, p: string): string | undefined => { if (k === undefined || k === "" || k === null) return undefined; if (typeof k === "string" && out.sources[k]) return k; c.bad(p, "must be a key of audio.sources"); return undefined; };
  if (v.events !== undefined) {
    if (!isObj(v.events)) c.bad("audio.events", "must be an object");
    else for (const e of AUDIO_EVENTS) { const k = known(v.events[e], `audio.events.${e}`); if (k) out.events[e] = k; }
  }
  if (v.ambience !== undefined) {
    if (!isObj(v.ambience)) c.bad("audio.ambience", "must be an object of preset id → source key");
    else for (const id of Object.keys(v.ambience)) {
      if (!lighting.presets.find((p) => p.id === id)) { c.bad(`audio.ambience.${id}`, "is not a lighting preset id"); continue; }
      const k = known(v.ambience[id], `audio.ambience.${id}`); if (k) out.ambience[id] = k;
    }
  }
  return out;
}

export function validateGameSpec(input: unknown): ValidateResult {
  let raw: unknown = input;
  if (typeof raw === "string") {
    if (raw.length > GAME_SPEC_MAX_BYTES * 2) return { ok: false, spec: null, errors: [`config is larger than ${GAME_SPEC_MAX_BYTES / 1024} KB`] };
    try { raw = JSON.parse(raw); } catch { return { ok: false, spec: null, errors: ["config is not valid JSON"] }; }
  }
  if (!isObj(raw)) return { ok: false, spec: null, errors: ["config must be a JSON object"] };
  if (raw.version !== 2) return { ok: false, spec: null, errors: ["version must be 2"] };
  const c = new Ctx();
  const lighting = readLighting(raw.lighting, c);
  const spec: GameSpecJson = {
    version: 2,
    enabled: readBool(raw.enabled, true, "enabled", c),
    protocol: readProtocol(raw.protocol, c),
    hud: readHud(raw.hud, c),
    lighting,
    environment: readEnvironment(raw.environment, c),
    characters: readCharacters(raw.characters, c),
    player: readPlayer(raw.player, c),
    camera: readCamera(raw.camera, c),
    audio: readAudio(raw.audio, lighting, c),
  };
  for (const k of Object.keys(raw)) if (!(k in spec)) c.bad(k, "is not a known section");
  if (c.errors.length) return { ok: false, spec: null, errors: c.errors };
  const bytes = new TextEncoder().encode(JSON.stringify(spec)).length;
  if (bytes > GAME_SPEC_MAX_BYTES) return { ok: false, spec: null, errors: [`config is larger than ${GAME_SPEC_MAX_BYTES / 1024} KB`] };
  return { ok: true, spec, errors: [] };
}
