/**
 * 手機待機（探出）時不蓋住可點的東西（任務 2026-10-30 desk-pet-mobile-overlap）：
 *   - 底下沒有可點的東西：照舊探出 48、接觸區 64（owner 定的數字不動）
 *   - 有：先留在原高度、把露出寬度連同接觸區縮到離那個東西 8px；縮到 MIN_REACH 還不夠才換高度；都不行才暫時退場
 */
import { afterEach, expect, it, vi } from "vitest";
import { MIN_REACH, phoneControls, standbySpot } from "../src/pet/standby-clearance";
import { peekCatch, peekPos, type Frame } from "../src/pet/placement";

const rect = (left: number, right: number, top: number, bottom: number) => ({ left, right, top, bottom });
/** 一列一個列尾按鈕：每 100px 一列，按鈕 30 高（預設頁 390 實量：更多操作 328–358） */
const rows = (left: number, right: number) => Array.from({ length: 9 }, (_, i) => rect(left, right, 120 + i * 100, 150 + i * 100));
const at = (w: number, obstacles: ReturnType<typeof rect>[], o: Partial<Parameters<typeof standbySpot>[0]> = {}) =>
  standbySpot({ w, side: "right", top: 60, bottom: 844, obstacles, height: 132, full: 64, original: 478, current: 478, ...o });

it("底下沒有可點的東西：留在原處，照舊的寬度", () => {
  expect(at(390, [])).toEqual({ y: 478, reach: null });
  expect(at(390, [rect(16, 200, 400, 700)])).toEqual({ y: 478, reach: null });
});

for (const w of [390, 320]) {
  it(`寬 ${w}：每列都有列尾按鈕時留在原高度，露出寬度縮到離按鈕 8px`, () => {
    expect(at(w, rows(w - 62, w - 32))).toEqual({ y: 478, reach: 24 });
  });
}

it("整排滿寬的按鈕在她底下、別處有空：換到最近的空位，用原本的寬度", () => {
  const y = at(390, [rect(16, 374, 470, 520)]);
  expect(y).toEqual({ y: 528, reach: null });
});

it("縮到最小還碰到、也沒有空位：暫時退場", () => {
  expect(at(390, Array.from({ length: 9 }, (_, i) => rect(16, 374, 100 + i * 90, 170 + i * 90)))).toBeNull();
});

it("縮窄不夠時改用最近的高度縮窄，也不貼著原本那個按鈕", () => {
  // 上面兩條滿寬的區塊中間只剩 130px，放不下 132＋上下各 8；下面每列都有列尾按鈕
  const spot = at(390, [rect(16, 374, 60, 300), rect(16, 374, 430, 640), ...rows(328, 358).filter(r => r.top > 640)])!;
  expect(spot.reach).toBe(24);
  expect(spot.y >= 648 || spot.y + 132 + 8 <= 430).toBe(true);
});

it("原本選的高度空出來了就回去", () => {
  expect(at(390, [], { current: 700 })).toEqual({ y: 478, reach: null });
  // 原高度只能縮窄、現在的高度不用縮：先不動
  expect(at(390, rows(328, 358).filter(r => r.top < 650), { current: 700 })).toEqual({ y: 700, reach: null });
  expect(at(390, [rect(16, 374, 650, 860)], { current: 700 })).toEqual({ y: 478, reach: null });
});

it("左側鏡像：按鈕左緣在 32，露出 24", () => {
  expect(at(390, rows(32, 62), { side: "left" })).toEqual({ y: 478, reach: 24 });
});

it("露出寬度不小於 MIN_REACH：每列都只剩 19px 時暫時退場", () => {
  expect(at(390, rows(16, 390 - MIN_REACH - 7))).toBeNull();
  expect(at(390, rows(16, 390 - MIN_REACH - 8))).toEqual({ y: 478, reach: MIN_REACH });
});

it("縮窄時身體與接觸區一起縮，從螢幕邊算起", () => {
  const f: Frame = { w: 390, h: 844, inset: { top: 0, right: 0, bottom: 0, left: 0 } }, s = { w: 88, h: 132 };
  expect(peekPos(f, s, "right", 478, 24).x).toBe(366);
  expect(peekCatch(f, s, "right", 478, 24)).toMatchObject({ x: 366, w: 24 });
  expect(peekPos(f, s, "left", 478, 24).x).toBe(24 - 88);
  expect(peekCatch(f, s, "left", 478, 24)).toMatchObject({ x: 0, w: 24 });
  // 不縮時照舊
  expect(peekPos(f, s, "right", 478).x).toBe(342);
  expect(peekCatch(f, s, "right", 478)).toMatchObject({ x: 326, w: 64 });
});

afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });
it("收集畫面上看得到、按得到的控制項；她自己的、停用的、不接點擊的、畫面外的不算", () => {
  vi.stubGlobal("innerHeight", 844);
  document.body.innerHTML = `<header class="header"></header>
    <button id="more"></button><a id="row" href="/x"></a><a id="plain"></a><button id="off" disabled></button>
    <a id="ghost" href="/y" style="pointer-events:none"></a><button id="below"></button><label id="lab"></label>
    <div class="suki-pet"><button id="mine"></button></div><div class="suki-pet__catch"></div>
    <div inert><button id="behind"></button></div><button id="unseen" style="visibility:hidden"></button>
    <article class="card" id="tile"><a href="/c/1" id="title"></a></article>`;
  const box = (id: string, r: DOMRect) => { document.getElementById(id)!.getBoundingClientRect = () => r; };
  document.querySelector<HTMLElement>(".header")!.getBoundingClientRect = () => new DOMRect(0, 0, 390, 52);
  for (const id of ["more", "row", "plain", "off", "ghost", "mine", "lab", "behind", "unseen"]) box(id, new DOMRect(328, 526, 30, 30));
  box("below", new DOMRect(328, 900, 30, 30));
  document.getElementById("lab")!.getBoundingClientRect = () => new DOMRect(16, 300, 200, 40);
  // 整張卡都可點（標題連結用 ::after 撐滿），連結本身只有標題那一小塊：卡片外框也要算
  box("tile", new DOMRect(203, 600, 171, 412)); box("title", new DOMRect(219, 840, 120, 24));
  const got = phoneControls()!;
  expect(got.top).toBe(52);
  expect(got.obstacles).toEqual([rect(328, 358, 526, 556), rect(328, 358, 526, 556), rect(16, 216, 300, 340), rect(203, 374, 600, 1012), rect(219, 339, 840, 864)]);
});

// 第三班（PM 2026-10-30 A）：關鍵數字用 data-pet-avoid 標；桌機站著時沿這一排左右讓
import { deskSpot } from "../src/pet/standby-clearance";
const desk = (obstacles: ReturnType<typeof rect>[], o: Partial<Parameters<typeof deskSpot>[0]> = {}) =>
  deskSpot({ minX: 8, maxX: 1280 - 146 - 8, y: 672, w: 146, h: 220, obstacles, original: 1110, current: 1110, ...o });

it("桌機：底下沒有東西就留在原處", () => {
  expect(desk([])).toBe(1110);
  expect(desk([rect(124, 1156, 100, 600)])).toBe(1110);
});

it("桌機：右對齊的金額壓在她身上，沿這一排挪到最近的空位", () => {
  // 1280 寬，金額在 1060–1132：右邊放不下她（146 寬），往左讓到金額左邊 8px
  expect(desk([rect(1060, 1132, 700, 740)])).toBe(906);
  // 右邊放得下時往右
  expect(desk([rect(1000, 1050, 700, 740)], { original: 1020, current: 1020 })).toBe(1058);
});

it("桌機：這一排滿了就淡出；原位空出來就回去", () => {
  expect(desk([rect(0, 1280, 700, 740)])).toBeNull();
  expect(desk([], { current: 1126 })).toBe(1110);
});

it("關鍵數字只量字本身，量不到時退回元素外框", () => {
  vi.stubGlobal("innerHeight", 844);
  document.body.innerHTML = `<strong id="amt" data-pet-avoid>+1,000 積分</strong>`;
  const el = document.getElementById("amt")!;
  el.getBoundingClientRect = () => new DOMRect(16, 500, 358, 24);
  const range = { selectNodeContents: () => {}, getBoundingClientRect: () => new DOMRect(290, 500, 84, 24) };
  vi.spyOn(document, "createRange").mockReturnValue(range as unknown as Range);
  vi.spyOn(performance, "now").mockReturnValue(1e9);
  expect(phoneControls()!.obstacles).toEqual([rect(290, 374, 500, 524)]);
  range.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  vi.spyOn(performance, "now").mockReturnValue(2e9);
  expect(phoneControls()!.obstacles).toEqual([rect(16, 374, 500, 524)]);
});
