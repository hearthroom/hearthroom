/**
 * 手機上她能站在哪裡（docs/studio/tasks/2026-10-23-pet-curved-screen/ui-v3.md）。
 *
 * 曲面（瀑布）屏會把畫面最外側約 20–30px 的觸控吃掉，直式時 safe-area 多半是 0，系統不會告訴我們。
 * 原本手機預設「貼著右邊只露 33px」，那條整條落在吃掉的範圍裡：點不到、拖不動（玩家 2026-10-23 回報）。
 * 所以站著時左右一律留一條邊距帶。收起時她還是靠在側邊探出頭，身體直接貼著螢幕邊、伸到螢幕外
 * （owner 2026-10-24：她和螢幕邊之間不能露出一條底色）；探出時另有一塊透明接觸區（貼螢幕邊、帶外 CATCH_OUT，
 * 高度跟她一樣），落在邊距帶裡的手指也算點到、拖到（owner 2026-10-23：使用者不在乎是不是真的按在她身上；
 * 曲面屏只吃左右，所以只加寬、不加高）。
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
/**
 * 探出時她的外框留在螢幕裡的寬度（外框 88 寬，其餘伸到螢幕外）。她身上最寬約 60px、靠牆那側不是直線：
 * 48 時 119 列裡有 116 列碰到螢幕邊、露出約 40px；56 只剩 64 列碰到、露出約 48；82 一列都碰不到
 * （2026-10-24 白天造型探頭姿勢實量）。owner 要的是不露底色，所以取 48；要露多一點就改這個數字，代價是更多列離開螢幕邊。
 */
export const PEEK_IN = 48;
/**
 * 探出時的接觸區：從螢幕邊算起蓋住邊距帶，再往內 CATCH_OUT；高度跟她的外框一樣。
 * owner 2026-10-23 試過 96、48，定 32（整塊寬 64）；要再調只改這一個數字。64 以外只接她畫出來的不透明處。
 */
export const CATCH_OUT = 32;
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

/** 探出在 y 時的接觸區（貼著 side 那一側的螢幕邊） */
export function peekCatch(f: Frame, s: Size, side: Side, y: number) {
  const b = bands(f), w = (side === "right" ? b.right : b.left) + CATCH_OUT;
  return { x: side === "right" ? f.w - w : 0, y, w, h: s.h };
}

/** 靠在 side 那一側探出：外框留 PEEK_IN 在螢幕裡，其餘伸到螢幕外（貼的是螢幕邊，不是邊距帶） */
export function peekPos(f: Frame, s: Size, side: Side, y: number): Point {
  const r = peekRange(f, s);
  const x = side === "right" ? f.w - PEEK_IN : PEEK_IN - s.w;
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
 * 尖角（14px 寬）指著她留在螢幕裡那一段的中間（探出時她伸到螢幕外），卡片邊上至少留 16。回傳的都是離右緣的距離。
 */
export function nudgeAnchor(vw: number, pet: { left: number; right: number }, cardW: number) {
  const width = Math.min(cardW, vw - BAND * 2);
  const right = Math.min(Math.max(BAND, vw - pet.right), vw - BAND - width);
  const head = (Math.max(pet.left, 0) + Math.min(pet.right, vw)) / 2;
  return { right, tail: clamp(vw - right - head - 7, 16, width - 30) };
}

/**
 * 她畫出來的輪廓，轉成 CSS `clip-path: path()`：探出時她外框的透明處裁掉，那裡的點擊就落到底下的網頁
 * （瀏覽器判定點到誰時會照 clip-path 算）。每 step 列一條，不透明的連續段各成一個長方形，洞留空；
 * 比 gap 欄還窄的縫併起來。px 是 RGBA、由上到下逐列；sx／sy 是每個像素在元素裡多寬多高；mirror 時左右鏡射。
 */
export function silhouettePath(px: Uint8Array, w: number, h: number, o: { sx: number; sy: number; mirror: boolean; step: number; gap: number }) {
  const out: string[] = [];
  const r = (v: number) => Math.round(v * 10) / 10;
  for (let y0 = 0; y0 < h; y0 += o.step) {
    const rows = Math.min(o.step, h - y0);
    const runs: [number, number][] = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      let opaque = false;
      if (x < w) for (let y = y0; y < y0 + rows && !opaque; y++) opaque = px[(y * w + x) * 4 + 3] > 25;
      if (opaque && start < 0) start = x;
      if (!opaque && start >= 0) {
        const last = runs[runs.length - 1];
        if (last && start - last[1] <= o.gap) last[1] = x; else runs.push([start, x]);
        start = -1;
      }
    }
    for (const [a, b] of runs) {
      const left = o.mirror ? (w - b) * o.sx : a * o.sx;
      out.push(`M${r(left)} ${r(y0 * o.sy)} h${r((b - a) * o.sx)} v${r(rows * o.sy)} h${-r((b - a) * o.sx)} z`);
    }
  }
  return out.join(" ");
}

/** 泡泡與選單左緣在視窗裡的位置是 left、寬 width：要往右挪多少才整個落在邊距帶內（放不下就靠左） */
export function fitShift(f: Frame, left: number, width: number) {
  const b = bands(f);
  const lo = b.left, hi = f.w - b.right;
  const to = Math.max(lo, Math.min(left, hi - width));
  return to - left;
}
