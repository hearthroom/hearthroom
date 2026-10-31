/**
 * 生圖頁的小工具：技能（常用的角色素材做法）、尺寸與比例、本機記下的描述、存檔與下載的預設名字。
 *
 * 技能是內建的描述範本：選了它，送出時把範本接在作者的描述前面，並預選它建議的構圖與張數。
 * 範本照頁面語言寫（studio.skill.<id>.prompt），模型讀得懂五種語言。
 */
export type Shape = "tall" | "wide" | "square";
export interface Skill {
  id: string;
  shape: Shape;
  /** 建議張數；"max" 是模型能給的上限（表情差分要一次多張才比得出來）。 */
  count: 1 | "max";
  /** 搭一張參考圖效果最好：畫面上提醒作者加。 */
  wantsReference?: boolean;
}
export const SKILLS: Skill[] = [
  { id: "portrait", shape: "tall", count: 1 },
  { id: "banner", shape: "wide", count: 1 },
  { id: "expressions", shape: "square", count: "max", wantsReference: true },
  { id: "avatar", shape: "square", count: 1, wantsReference: true },
  { id: "scene", shape: "wide", count: 1 },
  { id: "moment", shape: "wide", count: 1 },
];

const TARGET: Record<Shape, number> = { tall: 9 / 16, wide: 16 / 9, square: 1 };
const ratioOf = (size: string) => {
  const [w, h] = size.split("x").map(Number);
  return w && h ? w / h : 1;
};
/** 最接近某個構圖的尺寸（取對數比較，太寬太窄一樣算）；認不出的尺寸當正方形。 */
export function fitSize(sizes: string[], shape: Shape) {
  const off = (s: string) => Math.abs(Math.log(ratioOf(s) / TARGET[shape]));
  return sizes.reduce((best, s) => (off(s) < off(best) ? s : best), sizes[0] ?? "");
}

const NAMED: [string, number][] = [["1:1", 1], ["2:3", 2 / 3], ["3:2", 3 / 2], ["3:4", 3 / 4], ["4:3", 4 / 3], ["9:16", 9 / 16], ["16:9", 16 / 9], ["21:9", 21 / 9], ["9:21", 9 / 21]];
/** 尺寸的常見比例名（1024x1536 → 2:3）；差太多就照實寫寬高比。 */
export function ratioLabel(size: string) {
  const r = ratioOf(size);
  const [name, value] = NAMED.reduce((a, b) => (Math.abs(Math.log(b[1] / r)) < Math.abs(Math.log(a[1] / r)) ? b : a));
  return Math.abs(Math.log(value / r)) < 0.03 ? name : `${r.toFixed(2)}:1`;
}
/** 比例圖示的寬高（最長邊 18px）。 */
export function ratioBox(size: string) {
  const r = ratioOf(size);
  return r >= 1 ? { w: 18, h: Math.max(6, Math.round(18 / r)) } : { w: Math.max(6, Math.round(18 * r)), h: 18 };
}

/**
 * 每次生成的描述與參數只記在這台裝置上（Harbor 不保存描述）：快取區照它顯示描述、「再生成一次」照它回填。
 * 只留最近 MAX 筆；讀寫失敗（無痕、存滿）就當沒有。
 */
export interface Recipe {
  prompt: string;
  skill?: string;
  references?: string[];
}
const RECIPES = "hearthroom.studio.recipes";
const MAX = 120;
function readRecipes(): [string, Recipe][] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECIPES) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
export function recipeOf(taskId: string): Recipe | undefined {
  return readRecipes().find(([id]) => id === taskId)?.[1];
}
export function rememberRecipe(taskId: string, recipe: Recipe) {
  try {
    const rest = readRecipes().filter(([id]) => id !== taskId);
    localStorage.setItem(RECIPES, JSON.stringify([[taskId, recipe], ...rest].slice(0, MAX)));
  } catch {}
}

/** 資源庫檔名與下載檔名不能有的字元，連同換行一起換成空白。 */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]+/g;
/** 預設名字：描述的開頭（沒有描述用 fallback），好幾張時後面接第幾張。 */
export function defaultName(prompt: string | undefined, fallback: string, index: number, total: number) {
  const base = (prompt ?? "").replace(UNSAFE, " ").replace(/\s+/g, " ").trim().slice(0, 24).trim() || fallback;
  return total > 1 ? `${base}-${index + 1}` : base;
}
export function cleanName(name: string) {
  return name.replace(UNSAFE, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}
export const extensionOf = (url: string) => /\.(png|jpe?g|webp)(?:$|\?)/i.exec(url)?.[1]?.toLowerCase() ?? "png";
