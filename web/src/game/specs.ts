/**
 * 遊戲世界配置：哪張卡能開遊戲模式、它的世界長什麼樣（建築、NPC、地點對照）。
 *
 * 兩層：這裡手寫的世界（作者精修）優先；沒有的卡，只要開場白帶 <zzroles> 協定，就用
 * defaultWorldFor 從角色名單生一座通用校園——任何照協定寫的卡都能直接當 3D 遊戲玩。
 *
 * ponytail: 精修世界目前寫死在站台裡。正式做法是作者在作者資產裡宣告（跟正則規則、pageMode
 * 放一起），遊戲頁讀 author-asset/serve 拿到；那要等上游開欄位。
 */
// i18n-ignore：這個檔裡的中文是卡片協定的欄位名、角色名與地點名（資料），不是介面文案。
import { hueFrom } from "@/lib/format";
import type { HaloShape, HairStyle, NpcSpec, WorldSpec } from "./world";
import type { GameSpecJson } from "../../../shared/game-spec";

/**
 * 千年科技學園：中央是什亭之匣（夏萊辦公室），西側研討會大樓，東側教學樓，東南商業街。
 * 三個角色的模型是 Tripo 文生 3D（v3.1）＋ v1.0 人形綁骨；idle／walk 是 FBX（v1.0 綁骨的 GLB 烘焙會讓四肢塌陷，
 * 見技能 api-notes），本體直接用 idle 的 FBX（FBX 動畫只配 FBX 骨架），PBR 貼圖從同任務的 GLB 搬。檔案在 public/game/models/<name>/。
 */
const MILLENNIUM: WorldSpec = {
  spawn: [0, 8],
  player: { url: "/game/models/sensei/character.glb", height: 2.35 },
  npcs: [
    { name: "阿罗娜", color: "#5ec2f5", hair: "#8fd3ff", hairStyle: "bob", halo: "arc", pos: [0, -3], face: Math.PI, wander: 1.5, model: { url: "/game/models/arona/character.glb", height: 2.2 } },
    { name: "早濑优香", color: "#4f7bea", hair: "#2a4fc7", hairStyle: "twin", halo: "hex", pos: [-15, -2], face: Math.PI * 0.6, wander: 3, model: { url: "/game/models/yuuka/character.glb", height: 2.2 } },
    { name: "生盐诺亚", color: "#b39cf5", hair: "#ece9f8", hairStyle: "long", halo: "ring", pos: [-12, 0], face: Math.PI * 0.5, wander: 3, model: { url: "/game/models/noa/character.glb", height: 2.2 } },
  ],
  places: [
    { key: "seminar", match: /研讨会|会计|书记|千年科技学园|千年/, pos: [-12, 3], label: "研讨会大楼" },
    { key: "classroom", match: /教室|课堂|教学楼/, pos: [14, -2], label: "教学楼" },
    { key: "street", match: /商业街|商店|便利店|咖啡/, pos: [14, 12], label: "商业街" },
    { key: "gate", match: /校门|入口|广场|大门/, pos: [0, 22], label: "中央广场" },
    { key: "schale", match: /什亭之匣|夏莱|办公室|老师/, pos: [0, 4], label: "夏莱办公室" },
  ],
  buildings: [
    { pos: [0, -12], size: [12, 7, 9], label: "夏莱办公室" },
    { pos: [-18, -12], size: [14, 10, 10], label: "研讨会大楼", color: "#eef3fb" },
    { pos: [18, -12], size: [18, 8, 9], label: "教学楼" },
    { pos: [20, 12], size: [5, 4, 5], label: "商业街", color: "#fff4ea" },
    { pos: [26, 12], size: [5, 5, 5], color: "#f6ecff" },
    { pos: [20, 19], size: [5, 4, 5], color: "#eafaf1" },
    { pos: [-22, 10], size: [8, 5, 8], label: "图书馆", color: "#f3f7ff" },
    { pos: [-36, -6], size: [10, 14, 10], color: "#f6f8fc" },
    { pos: [36, -4], size: [9, 12, 9], color: "#f6f8fc" },
  ],
  trees: [[-8, 12], [8, 12], [-8, 20], [8, 20], [-28, -2], [-28, 4], [30, -2], [30, 4], [-14, 16], [14, 24], [-30, 16], [32, 22], [-24, 24], [24, 28], [-40, 12], [40, 14]],
  lamps: [[-4, 6], [4, 6], [-4, 16], [4, 16], [-10, -4], [10, -4], [-4, 26], [4, 26], [-20, 2], [22, 4], [-4, -20], [4, -20]],
  sky: "/game/textures/sky-day.jpg",
  audio: Object.fromEntries(["ambience-day", "ambience-dusk", "ambience-night", "ui-open", "ui-close", "footstep", "affection-up", "affection-down", "travel", "quest"].map((k) => [k, `/game/audio/${k}.mp3`])),
};

export const WORLD_SPECS: Record<string, WorldSpec> = {
  // 酒館測試-碧藍檔案（作者鹿初）
  "a7a2b00b-d8aa-4bbe-8292-5df001dfe65a": MILLENNIUM,
};

export const hasStageSpec = (roleId: string): boolean => roleId in WORLD_SPECS;

/** 這張卡能不能開遊戲：有精修世界，或開場白照 zzroles 協定寫 */
export const canPlayAsGame = (roleId: string, welcome: string): boolean => hasStageSpec(roleId) || /<zzroles>/.test(welcome || "");

const HALOS: HaloShape[] = ["ring", "hex", "arc"];
const HAIRS: HairStyle[] = ["long", "twin", "bob", "short"];
/** NPC 站位：繞著中央廣場一圈，最多八個，再多就疊在外圈 */
const SLOTS: [number, number][] = [[0, -3], [-12, 0], [12, 0], [-8, -14], [8, -14], [-18, 12], [18, 12], [0, -22]];

/** 沒有精修世界的卡：從角色名單生一座通用校園 */
export function defaultWorldFor(names: string[]): WorldSpec {
  const npcs: NpcSpec[] = names.slice(0, 8).map((name, i) => {
    const h = hueFrom(name);
    return {
      name,
      color: `hsl(${h} 70% 62%)`,
      hair: `hsl(${(h + 30) % 360} 45% ${i % 2 ? 78 : 32}%)`,
      hairStyle: HAIRS[i % HAIRS.length],
      halo: HALOS[i % HALOS.length],
      pos: SLOTS[i],
      face: Math.atan2(0 - SLOTS[i][0], 8 - SLOTS[i][1]),
      wander: 2.5,
    };
  });
  return {
    spawn: [0, 8],
    npcs,
    places: [
      { key: "west", match: /西|左/, pos: [-12, 3], label: "西侧" },
      { key: "east", match: /东|右|教室|课堂/, pos: [12, 3], label: "东侧" },
      { key: "north", match: /北|大厅|办公室|会议/, pos: [0, -6], label: "主楼前" },
      { key: "south", match: /南|门|广场|入口|街/, pos: [0, 20], label: "广场" },
    ],
    buildings: [
      { pos: [0, -14], size: [14, 8, 10] },
      { pos: [-18, -10], size: [10, 6, 8], color: "#eef3fb" },
      { pos: [18, -10], size: [10, 6, 8], color: "#fff4ea" },
      { pos: [-20, 14], size: [7, 5, 7], color: "#f3f7ff" },
      { pos: [20, 14], size: [7, 5, 7], color: "#f6ecff" },
    ],
    trees: [[-8, 12], [8, 12], [-8, 20], [8, 20], [-26, 0], [26, 0], [-14, 22], [14, 22], [-30, -14], [30, -14]],
    lamps: [[-4, 6], [4, 6], [-4, 16], [4, 16], [-10, -4], [10, -4]],
  };
}

/** 場景「时间」欄位 → 世界光照 */
export function tintOf(time: string): "day" | "dusk" | "night" {
  if (/夜|晚|凌晨|深更/.test(time)) return "night";
  if (/黄昏|傍晚|夕|日落/.test(time)) return "dusk";
  return "day";
}

/** HUD 主角欄位：卡片協定的 key → 介面文案 key（便签另外畫，不在這裡） */
export const HERO_FIELDS = [
  { key: "名字", label: "game.field.name" },
  { key: "身份", label: "game.field.identity" },
  { key: "外貌", label: "game.field.appearance" },
  { key: "能力", label: "game.field.ability" },
];
/** 頂欄場景欄位（輪次與目標另外畫） */
export const SCENE_FIELDS = [
  { key: "时间", label: "game.field.time" },
  { key: "地点", label: "game.field.place" },
];

/**
 * 作者存的 JSON 配置 → 世界規格。缺的欄位從通用校園補（站位、顏色、光環、建築），
 * 作者只要寫他在乎的部分。names 是開場白 zzroles 裡的角色名：配置沒提到的角色也要上台。
 */
export function worldFromSpec(json: GameSpecJson, names: string[]): WorldSpec {
  const base = defaultWorldFor([...new Set([...json.npcs.map((n) => n.name), ...names])]);
  const npcs: NpcSpec[] = base.npcs.map((d) => {
    const j = json.npcs.find((n) => n.name === d.name);
    if (!j) return d;
    return {
      ...d,
      color: j.color ?? d.color, hair: j.hair ?? d.hair, hairStyle: j.hairStyle ?? d.hairStyle, halo: j.halo ?? d.halo,
      pos: j.pos ?? d.pos, face: j.face ?? d.face, wander: j.wander ?? d.wander,
      model: j.model,
    };
  });
  return {
    spawn: json.spawn ?? base.spawn,
    player: json.player,
    npcs,
    places: json.places ? json.places.map((p) => ({ key: p.label, match: new RegExp(p.match), pos: p.pos, label: p.label })) : base.places,
    buildings: json.buildings ?? base.buildings,
    trees: json.trees ?? base.trees,
    lamps: json.lamps ?? base.lamps,
    sky: json.sky,
    audio: json.audio,
  };
}

const AUDIO_NAMES = ["ambience-day", "ambience-dusk", "ambience-night", "ui-open", "ui-close", "footstep", "affection-up", "affection-down", "travel", "quest"];

/** 給編輯器當「預設範本」：站內精修的示範卡照原樣吐；其他卡從角色名單生通用校園 */
export function specTemplateFor(roleId: string, names: string[]): GameSpecJson {
  const w = WORLD_SPECS[roleId] || defaultWorldFor(names);
  const bundled = !!WORLD_SPECS[roleId];
  return {
    version: 1,
    enabled: true,
    spawn: w.spawn,
    player: w.player,
    npcs: w.npcs.map((n) => ({ name: n.name, color: n.color, hair: n.hair, hairStyle: n.hairStyle, halo: n.halo, pos: n.pos, face: n.face, wander: n.wander, model: n.model })),
    places: w.places.map((p) => ({ match: p.match.source, pos: p.pos, label: p.label })),
    buildings: w.buildings,
    trees: w.trees,
    lamps: w.lamps,
    sky: w.sky ?? (bundled ? "/game/textures/sky-day.jpg" : undefined),
    audio: w.audio ?? (bundled ? Object.fromEntries(AUDIO_NAMES.map((k) => [k, `/game/audio/${k}.mp3`])) : undefined),
  } as GameSpecJson;
}
