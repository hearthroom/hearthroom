/**
 * 作者配置（shared/game-spec v2）→ 世界層規格，以及頁面要的幾個純函式（能否開遊戲、時間→光照、範本）。
 *
 * 這裡沒有任何題材知識：校園只是 DEFAULT_GAME_SPEC 的預設值，作者把 environment.kit 換成 none、
 * 自己擺 props，就是酒館或飛船。示範卡的精修世界也是一份資料（samples/），不再寫進程式。
 */
import { hueFrom } from "@/lib/format";
import { DEFAULT_GAME_SPEC, validateGameSpec, type CharacterJson, type GameSpecInput, type GameSpecJson, type LightingJson, type ProtocolJson } from "../../../shared/game-spec";
import type { NpcSpec, WorldSpec } from "./world-types";

const HAIRS = ["long", "twin", "bob", "short"] as const;
const ACCESSORIES = ["halo-ring", "halo-hex", "halo-arc"] as const;
/** 沒指定站位的角色：繞著出生點前方一圈，最多八個，再多就疊在外圈 */
const SLOTS: [number, number][] = [[0, -3], [-12, 0], [12, 0], [-8, -14], [8, -14], [-18, 12], [18, 12], [0, -22]];

/** 配置沒提到的角色也要上台：用名字生一組穩定的外觀（同名同色） */
export function defaultCharacter(name: string, i: number, campus: boolean): CharacterJson {
  const h = hueFrom(name);
  const pos = SLOTS[i % SLOTS.length];
  return {
    name,
    color: `hsl(${h} 70% 62%)`,
    look: { hair: `hsl(${(h + 30) % 360} 45% ${i % 2 ? 78 : 32}%)`, hairStyle: HAIRS[i % HAIRS.length] },
    accessory: campus ? ACCESSORIES[i % ACCESSORIES.length] : "none",
    pos,
    face: Math.atan2(0 - pos[0], 8 - pos[1]),
    wander: 2.5,
  };
}

/** 這張卡能不能開遊戲：開場白裡有協定要求的那個區塊（作者可把 gate 設成 none 表示不檢查） */
export function canPlayAsGame(protocol: ProtocolJson | undefined, welcome: string): boolean {
  const p = protocol ?? DEFAULT_GAME_SPEC.protocol;
  if (p.gate === "none") return true;
  const tag = p.gate === "hud" ? p.blocks.hud : p.blocks.roles;
  return new RegExp(`<${tag}>`).test(welcome || "");
}

/** 場景「時間」欄位 → 光照預設 id：依序試每套的 match，都不中用 default */
export function presetFor(time: string, lighting: LightingJson): string {
  for (const p of lighting.presets) {
    if (!p.match) continue;
    try { if (new RegExp(p.match).test(time)) return p.id; } catch { /* 驗證時已擋掉壞正則 */ }
  }
  return lighting.default;
}

/**
 * 驗過的配置 → 世界規格。names 是開場白角色區塊裡的角色名：配置沒提到的角色也要上台，
 * 配置提到但開場白沒有的也留著（作者可能故意放路人）。
 */
export function worldFromSpec(spec: GameSpecJson, names: string[]): WorldSpec {
  const campus = spec.environment.kit === "campus";
  const seen = new Set(spec.characters.map((c) => c.name));
  const extras = names.filter((n) => n && !seen.has(n)).map((n, i) => defaultCharacter(n, spec.characters.length + i, campus));
  const npcs: NpcSpec[] = [...spec.characters, ...extras].map((c) => ({ name: c.name, color: c.color, look: c.look, accessory: c.accessory, pos: c.pos, face: c.face, wander: c.wander, model: c.model }));
  return {
    npcs,
    places: spec.environment.places.map((p) => ({ key: p.label, match: new RegExp(p.match), pos: p.pos, label: p.label })),
    environment: {
      kit: spec.environment.kit, ground: spec.environment.ground, sky: spec.environment.sky, skyline: spec.environment.skyline, clouds: spec.environment.clouds,
      buildings: spec.environment.buildings, trees: spec.environment.trees, lamps: spec.environment.lamps, props: spec.environment.props,
    },
    lighting: spec.lighting,
    player: spec.player,
    camera: spec.camera,
  };
}

/** 沒有作者配置的卡：預設配置（通用校園）＋開場白裡的角色 */
export function defaultSpecFor(names: string[]): GameSpecJson {
  const v = validateGameSpec({ version: 2, characters: names.slice(0, 12).map((n, i) => defaultCharacter(n, i, true)) } satisfies GameSpecInput);
  return v.ok ? v.spec : structuredClone(DEFAULT_GAME_SPEC);
}

/** 給編輯器當「預設範本」：把預設值整份攤開，作者看得到每一個可以改的地方 */
export function specTemplateFor(names: string[]): GameSpecJson {
  return defaultSpecFor(names);
}
