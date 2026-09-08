/**
 * 遊戲模式的卡片配置（作者在編輯器裡存的那份 JSON）。
 *
 * Worker 存讀時驗它，前端編輯器存之前也驗它——同一份規則，兩邊不會漂。
 * 這裡只管「形狀對不對、有沒有超出合理範圍」，不管美術；世界層拿到後再補預設值。
 *
 * 資源一律用網址：站台自己的路徑（/game/...）或 https。作者資源庫能放圖片與音訊（sky、audio），
 * 3D 模型目前放不進去（上游只收圖／影／音／字型），先用外部網址或站台資源。
 */

export type XZ = [number, number];
export type HaloShape = "hex" | "ring" | "arc";
export type HairStyle = "short" | "long" | "twin" | "bob";
export type AudioKey = "ambience-day" | "ambience-dusk" | "ambience-night" | "ui-open" | "ui-close" | "footstep" | "affection-up" | "affection-down" | "travel" | "quest";

export interface ModelJson {
  url: string;
  height?: number;
  texturesFrom?: string;
  ownClip?: string;
  yaw?: number;
  clips?: { idle?: string; walk?: string; talk?: string };
  extra?: { name: string; url: string }[];
}
export interface NpcJson {
  /** 要跟 AI 回覆 zzroles 裡的「名字」一致，狀態才對得上 */
  name: string;
  color?: string;
  hair?: string;
  hairStyle?: HairStyle;
  halo?: HaloShape;
  pos?: XZ;
  face?: number;
  wander?: number;
  model?: ModelJson;
}
export interface PlaceJson { match: string; pos: XZ; label: string }
export interface BuildingJson { pos: XZ; size: [number, number, number]; color?: string; label?: string }

export interface GameSpecJson {
  version: 1;
  enabled?: boolean;
  spawn?: XZ;
  player?: ModelJson;
  npcs: NpcJson[];
  places?: PlaceJson[];
  buildings?: BuildingJson[];
  trees?: XZ[];
  lamps?: XZ[];
  sky?: string;
  audio?: Partial<Record<AudioKey, string>>;
}

export const GAME_SPEC_MAX_BYTES = 64 * 1024;
export const AUDIO_KEYS: AudioKey[] = ["ambience-day", "ambience-dusk", "ambience-night", "ui-open", "ui-close", "footstep", "affection-up", "affection-down", "travel", "quest"];
const HALOS = new Set<HaloShape>(["hex", "ring", "arc"]);
const HAIRS = new Set<HairStyle>(["short", "long", "twin", "bob"]);
const LIMITS = { npcs: 12, places: 20, buildings: 40, trees: 80, lamps: 40, extra: 6, str: 200, coord: 200, size: 60 };

export type ValidateResult = { ok: true; spec: GameSpecJson; errors: [] } | { ok: false; spec: null; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isUrl = (v: unknown): v is string => typeof v === "string" && v.length <= 500 && (/^https:\/\/[^\s]+$/.test(v) || /^\/[^\s]*$/.test(v));
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const xz = (v: unknown): v is XZ => Array.isArray(v) && v.length === 2 && num(v[0], -LIMITS.coord, LIMITS.coord) && num(v[1], -LIMITS.coord, LIMITS.coord);
const str = (v: unknown, max = LIMITS.str): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const color = (v: unknown): v is string => typeof v === "string" && /^(#[0-9a-fA-F]{3,8}|hsl\([^)]{1,40}\)|rgb\([^)]{1,40}\))$/.test(v);

function model(v: unknown, path: string, errors: string[]): ModelJson | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v) || !isUrl(v.url)) { errors.push(`${path}.url must be a site path or https url`); return undefined; }
  const out: ModelJson = { url: v.url };
  if (v.height !== undefined) { if (num(v.height, 0.5, 10)) out.height = v.height; else errors.push(`${path}.height must be 0.5-10`); }
  if (v.texturesFrom !== undefined) { if (isUrl(v.texturesFrom)) out.texturesFrom = v.texturesFrom; else errors.push(`${path}.texturesFrom must be a url`); }
  if (v.ownClip !== undefined) { if (str(v.ownClip, 60)) out.ownClip = v.ownClip; else errors.push(`${path}.ownClip invalid`); }
  if (v.yaw !== undefined) { if (num(v.yaw, -7, 7)) out.yaw = v.yaw; else errors.push(`${path}.yaw must be radians`); }
  if (v.clips !== undefined) {
    if (!isObj(v.clips)) errors.push(`${path}.clips must be an object`);
    else {
      out.clips = {};
      for (const k of ["idle", "walk", "talk"] as const) if (v.clips[k] !== undefined) { if (str(v.clips[k], 60)) out.clips[k] = v.clips[k] as string; else errors.push(`${path}.clips.${k} invalid`); }
    }
  }
  if (v.extra !== undefined) {
    if (!Array.isArray(v.extra) || v.extra.length > LIMITS.extra) errors.push(`${path}.extra must be an array of at most ${LIMITS.extra}`);
    else out.extra = v.extra.map((e, i) => { if (!isObj(e) || !str(e.name, 60) || !isUrl(e.url)) { errors.push(`${path}.extra[${i}] needs name and url`); return { name: "", url: "" }; } return { name: e.name, url: e.url }; });
  }
  return out;
}

/** 驗證並正規化。錯誤訊息是給作者看的英文短句（編輯器會原樣顯示，五語文案不翻這層）。 */
export function validateGameSpec(input: unknown): ValidateResult {
  const errors: string[] = [];
  const raw = typeof input === "string" ? (() => { try { return JSON.parse(input) as unknown; } catch { errors.push("not valid JSON"); return null; } })() : input;
  if (errors.length) return { ok: false, spec: null, errors };
  if (!isObj(raw)) return { ok: false, spec: null, errors: ["spec must be an object"] };
  if (JSON.stringify(raw).length > GAME_SPEC_MAX_BYTES) return { ok: false, spec: null, errors: [`spec larger than ${GAME_SPEC_MAX_BYTES} bytes`] };
  if (raw.version !== 1) errors.push("version must be 1");
  const spec: GameSpecJson = { version: 1, npcs: [] };
  if (raw.enabled !== undefined) { if (typeof raw.enabled === "boolean") spec.enabled = raw.enabled; else errors.push("enabled must be boolean"); }
  if (raw.spawn !== undefined) { if (xz(raw.spawn)) spec.spawn = raw.spawn; else errors.push("spawn must be [x, z]"); }
  spec.player = model(raw.player, "player", errors);
  if (!Array.isArray(raw.npcs)) errors.push("npcs must be an array");
  else if (raw.npcs.length > LIMITS.npcs) errors.push(`at most ${LIMITS.npcs} npcs`);
  else {
    const seen = new Set<string>();
    raw.npcs.forEach((n, i) => {
      const p = `npcs[${i}]`;
      if (!isObj(n) || !str(n.name, 40)) { errors.push(`${p}.name required`); return; }
      if (seen.has(n.name)) errors.push(`${p}.name duplicated`); seen.add(n.name);
      const o: NpcJson = { name: n.name };
      if (n.color !== undefined) { if (color(n.color)) o.color = n.color; else errors.push(`${p}.color invalid`); }
      if (n.hair !== undefined) { if (color(n.hair)) o.hair = n.hair; else errors.push(`${p}.hair invalid`); }
      if (n.hairStyle !== undefined) { if (HAIRS.has(n.hairStyle as HairStyle)) o.hairStyle = n.hairStyle as HairStyle; else errors.push(`${p}.hairStyle invalid`); }
      if (n.halo !== undefined) { if (HALOS.has(n.halo as HaloShape)) o.halo = n.halo as HaloShape; else errors.push(`${p}.halo invalid`); }
      if (n.pos !== undefined) { if (xz(n.pos)) o.pos = n.pos; else errors.push(`${p}.pos must be [x, z]`); }
      if (n.face !== undefined) { if (num(n.face, -7, 7)) o.face = n.face; else errors.push(`${p}.face must be radians`); }
      if (n.wander !== undefined) { if (num(n.wander, 0, 20)) o.wander = n.wander; else errors.push(`${p}.wander must be 0-20`); }
      o.model = model(n.model, `${p}.model`, errors);
      if (!o.model) delete o.model;
      spec.npcs.push(o);
    });
  }
  if (raw.places !== undefined) {
    if (!Array.isArray(raw.places) || raw.places.length > LIMITS.places) errors.push(`places must be an array of at most ${LIMITS.places}`);
    else spec.places = raw.places.map((pl, i) => {
      const p = `places[${i}]`;
      if (!isObj(pl) || !str(pl.match, 100) || !xz(pl.pos) || !str(pl.label, 40)) { errors.push(`${p} needs match, pos, label`); return { match: "", pos: [0, 0] as XZ, label: "" }; }
      try { new RegExp(pl.match); } catch { errors.push(`${p}.match is not a valid regex`); }
      return { match: pl.match, pos: pl.pos, label: pl.label };
    });
  }
  if (raw.buildings !== undefined) {
    if (!Array.isArray(raw.buildings) || raw.buildings.length > LIMITS.buildings) errors.push(`buildings must be an array of at most ${LIMITS.buildings}`);
    else spec.buildings = raw.buildings.map((b, i) => {
      const p = `buildings[${i}]`;
      const sizeOk = Array.isArray(b?.size) && b.size.length === 3 && b.size.every((s: unknown) => num(s, 0.5, LIMITS.size));
      if (!isObj(b) || !xz(b.pos) || !sizeOk) { errors.push(`${p} needs pos [x, z] and size [w, h, d]`); return { pos: [0, 0] as XZ, size: [1, 1, 1] as [number, number, number] }; }
      const o: BuildingJson = { pos: b.pos, size: b.size as [number, number, number] };
      if (b.color !== undefined) { if (color(b.color)) o.color = b.color; else errors.push(`${p}.color invalid`); }
      if (b.label !== undefined) { if (str(b.label, 40)) o.label = b.label; else errors.push(`${p}.label invalid`); }
      return o;
    });
  }
  for (const key of ["trees", "lamps"] as const) {
    if (raw[key] === undefined) continue;
    const arr = raw[key];
    if (!Array.isArray(arr) || arr.length > LIMITS[key] || !arr.every(xz)) errors.push(`${key} must be an array of [x, z] (at most ${LIMITS[key]})`);
    else spec[key] = arr as XZ[];
  }
  if (raw.sky !== undefined) { if (isUrl(raw.sky)) spec.sky = raw.sky; else errors.push("sky must be a url"); }
  if (raw.audio !== undefined) {
    if (!isObj(raw.audio)) errors.push("audio must be an object");
    else {
      spec.audio = {};
      for (const [k, v] of Object.entries(raw.audio)) {
        if (!AUDIO_KEYS.includes(k as AudioKey)) { errors.push(`audio.${k} is not a known sound`); continue; }
        if (!isUrl(v)) { errors.push(`audio.${k} must be a url`); continue; }
        spec.audio[k as AudioKey] = v;
      }
    }
  }
  if (spec.player === undefined) delete spec.player;
  return errors.length ? { ok: false, spec: null, errors } : { ok: true, spec, errors: [] };
}
