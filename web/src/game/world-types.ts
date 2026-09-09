/**
 * 世界層（world.ts）吃的執行期規格：由 specs.ts 從作者配置（shared/game-spec 的 v2）轉來。
 * 跟配置的差別只有兩處：地點的 match 已編成 RegExp、光照預設的顏色仍是字串由世界層解析。
 * 拆成獨立檔案是為了讓頁面、specs 與世界層各自引用型別，不必把 three.js 拉進測試。
 */
import type { Accessory, CameraJson, HairStyle, LightPresetJson, LookJson, ModelJson, PropJson, BuildingJson, XZ } from "../../../shared/game-spec";

export type { Accessory, HairStyle, LookJson, ModelJson, PropJson, BuildingJson, LightPresetJson, XZ };

export interface NpcSpec {
  name: string;
  /** 主色：頭頂標籤、光環、補光 */
  color: string;
  look: LookJson;
  accessory: Accessory;
  pos: XZ;
  face: number;
  /** 閒逛半徑；0 = 站著不動 */
  wander: number;
  model?: ModelJson;
}
export interface PlaceSpec { key: string; match: RegExp; pos: XZ; label: string }

export interface EnvironmentSpec {
  /** campus＝程序化校園套件（道路、廣場、草坪、樹籬、長椅、屋頂設備、天際線、全息終端）；none＝只有地面與擺設 */
  kit: "campus" | "none";
  ground: { color: string; texture: "grid" | "plaza" | "plain" | string; size: number };
  sky?: string;
  skyline: boolean;
  clouds: boolean;
  buildings: BuildingJson[];
  trees: XZ[];
  lamps: XZ[];
  props: PropJson[];
}

export interface WorldSpec {
  npcs: NpcSpec[];
  places: PlaceSpec[];
  environment: EnvironmentSpec;
  /** 光照預設（至少一套）與預設 id；世界層 setTint(id) 只認這裡的 id */
  lighting: { presets: LightPresetJson[]; default: string };
  player: { spawn: XZ; speed: number; look: LookJson; model?: ModelJson };
  camera: CameraJson;
}

export interface WorldEvents {
  /** 玩家走進／離開某個 NPC 的對話距離（null = 離開） */
  onNear(name: string | null): void;
  /** 玩家每走一步（配腳步聲） */
  onFootstep?(): void;
}

/** 頁面每輪推給世界的角色狀態：主數值（0..1 已正規化）、心情、是否跟目標有關 */
export interface NpcState { meter?: number | null; mood?: string; quest?: boolean }
