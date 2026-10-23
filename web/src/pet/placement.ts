/**
 * 手機上她能站在哪裡（docs/studio/tasks/2026-10-23-pet-curved-screen/ui-v3.md）。
 *
 * 曲面（瀑布）屏會把畫面最外側約 20–30px 的觸控吃掉，直式時 safe-area 多半是 0，系統不會告訴我們。
 * 原本手機預設「貼著右邊只露 33px」，那條整條落在吃掉的範圍裡：點不到、拖不動（玩家 2026-10-23 回報）。
 * 所以左右一律留一條邊距帶（牆）。收起時她還是靠在側邊，但改成從牆後面探出來：
 * 外框貼著螢幕邊，帶外露出 56px 整塊都接點擊，帶內那段被側邊頁籤蓋住。
 * 這裡全是純函式（不碰 DOM），探出、拉出、放下、走路、讀回舊位置、轉向都走同一套夾邊。桌機不用這份。
 */

export interface Inset { top: number; right: number; bottom: number; left: number }
/** 視窗大小與四邊 safe-area */
export interface Frame { w: number; h: number; inset: Inset }
export interface Size { w: number; h: number }
export interface Point { x: number; y: number }
export type Side = "left" | "right";

/** 左右邊距帶：曲面屏邊緣拒觸常見 16～30dp，再留一點餘量（--s-6） */
export const BAND = 32;
/** 探出時帶外露出、可點的寬度（過 44pt 最小點擊目標） */
export const PEEK_OUT = 56;
/** 往內拉多少 px 算整個拉出來 */
export const PULL_FULL = 52;
/** 站著時離底邊至少這麼遠 */
const FOOT = 16;
/** 探出時離頂端至少這麼遠（頁首的高度） */
const HEAD = 52;
/** 推進邊上：身體中線離螢幕邊在這麼近以內（邊距帶再往內 14px） */
const PUSH = 14;
/** 沒存過位置時探出的高度：原型 760 高的畫面放在 430（右手拇指好按，離底部的提示與儲存列遠） */
const DEFAULT_TOP = 430 / 760;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function bands(f: Frame) {
  return { left: Math.max(f.inset.left, BAND), right: Math.max(f.inset.right, BAND) };
}

/** 站著時她左上角可以在的範圍 */
export function standRange(f: Frame, s: Size) {
  const b = bands(f);
  const minX = b.left, maxX = Math.max(minX, f.w - b.right - s.w);
  const minY = f.inset.top, maxY = Math.max(minY, f.h - s.h - Math.max(f.inset.bottom, FOOT));
  return { minX, maxX, minY, maxY };
}

export function clampStand(f: Frame, s: Size, p: Point): Point {
  const r = standRange(f, s);
  return { x: clamp(p.x, r.minX, r.maxX), y: clamp(p.y, r.minY, r.maxY) };
}

/** 探出時的高度範圍：頁首下方到底邊之上 */
export function peekRange(f: Frame, s: Size) {
  const minY = f.inset.top + HEAD;
  return { minY, maxY: Math.max(minY, f.h - s.h - Math.max(f.inset.bottom, FOOT)) };
}

/** 靠在 side 那一側探出：牆外露出 PEEK_OUT */
export function peekPos(f: Frame, s: Size, side: Side, y: number): Point {
  const b = bands(f), r = peekRange(f, s);
  const x = side === "right" ? f.w - b.right - PEEK_OUT : b.left + PEEK_OUT - s.w;
  return { x, y: clamp(y, r.minY, r.maxY) };
}

export function defaultPeek(f: Frame, s: Size): { pos: Point; side: Side } {
  return { pos: peekPos(f, s, "right", Math.round(f.h * DEFAULT_TOP)), side: "right" };
}

/** 從 side 那一側拉出來：站到那一側的邊距帶上，高度不變 */
export function standOutPos(f: Frame, s: Size, side: Side, y: number): Point {
  const r = standRange(f, s);
  return clampStand(f, s, { x: side === "right" ? r.maxX : r.minX, y });
}

/** 外框在 x 時有多寬被 side 那一側的牆擋住（要裁掉不畫） */
export function wallHide(f: Frame, s: Size, side: Side, x: number) {
  const b = bands(f);
  return side === "right" ? Math.max(0, x + s.w - (f.w - b.right)) : Math.max(0, b.left - x);
}

/**
 * 探出時手指移動了 (dx, dy)：往內（離開牆）超過 8px 且大於垂直＝把她拉出來，其他＝沿邊上下拖。
 * 6px 以內還不算移動。不靠「從邊緣往內滑」：那是系統的返回手勢。
 */
export function pullMode(side: Side, dx: number, dy: number): "pull" | "slide" | null {
  if (Math.hypot(dx, dy) < 6) return null;
  const inward = side === "right" ? -dx : dx;
  return inward > 8 && inward > Math.abs(dy) ? "pull" : "slide";
}

/** 站著拖到 x 放開：身體中線進到邊上就縮回那一側 */
export function pushedIn(f: Frame, s: Size, x: number): Side | null {
  const b = bands(f), cx = x + s.w / 2;
  if (cx < b.left + PUSH) return "left";
  if (cx > f.w - b.right - PUSH) return "right";
  return null;
}

/** 比較近的那一側 */
export function sideOf(f: Frame, s: Size, x: number): Side { return x + s.w / 2 < f.w / 2 ? "left" : "right"; }

/**
 * 存在瀏覽器裡的位置：比例座標，探出時多一個 dock（哪一側）。
 * 舊版存的 x = -1 / 2 是「貼左／右邊收起」，研發版存過 dock: "bottom"，讀回時都改成探出。
 */
export interface Saved { x: number; y: number; dock?: Side | "bottom" }

export function toSaved(f: Frame, p: Point, side: Side | null): Saved {
  const v: Saved = { x: p.x / f.w, y: p.y / f.h };
  if (side) v.dock = side;
  return v;
}

/** 讀回存的位置，夾進現在的視窗；side 不是 null 就是探出（探出的時候會照新格式存回去，舊格式就此改寫） */
export function fromSaved(f: Frame, s: Size, v: Saved): { pos: Point; side: Side | null } {
  if (v.dock === "bottom") return defaultPeek(f, s);
  const side: Side | null = v.x < 0 ? "left" : v.x > 1 ? "right" : v.dock ?? null;
  if (side) return { pos: peekPos(f, s, side, v.y * f.h), side };
  return { pos: clampStand(f, s, { x: v.x * f.w, y: v.y * f.h }), side: null };
}

/**
 * 新手提示卡掛在她頭上（手機）：卡片外緣離螢幕邊至少一個邊距帶（曲面屏邊上點不到），放不下就往內收；
 * 尖角（14px 寬）指著她露出來那一段的中間：探出時只有牆外那 56px，站著時是整個外框。回傳的都是離右緣的距離。
 */
export function nudgeAnchor(vw: number, pet: { left: number; right: number }, cardW: number) {
  const width = Math.min(cardW, vw - BAND * 2);
  const right = Math.min(Math.max(BAND, vw - pet.right), vw - BAND - width);
  const head = (Math.max(pet.left, BAND) + Math.min(pet.right, vw - BAND)) / 2;
  return { right, tail: clamp(vw - right - head - 7, 16, width - 30) };
}

/** 泡泡與選單左緣在視窗裡的位置是 left、寬 width：要往右挪多少才整個落在邊距帶內（放不下就靠左） */
export function fitShift(f: Frame, left: number, width: number) {
  const b = bands(f);
  const lo = b.left, hi = f.w - b.right;
  const to = Math.max(lo, Math.min(left, hi - width));
  return to - left;
}
