/**
 * 桌寵在手機上站哪裡（任務 2026-10-23 曲面屏點不到，規格 docs/studio/tasks/2026-10-23-pet-curved-screen/ui-v3.md）：
 *   - 左右永遠離邊至少 32px，safe-area 比 32 大就用 safe-area（橫式瀏海）
 *   - 收起＝靠在側邊探出：身體貼著牆、外框露出 82px；接觸區寬＝邊距帶＋CATCH_OUT、高跟她一樣，貼著螢幕邊；預設右側
 *   - 往內拖分「拉出來」與「沿邊上下拖」；站著推進邊上放開就縮回那一側
 *   - 舊版存的「貼左／右邊收起」與研發版的「收在底邊」讀回時改成探出；落在邊緣的舊位置往內收
 *   - 泡泡與選單整個落在邊距帶內
 */
import { describe, expect, it } from "vitest";
import {
  BAND, CATCH_OUT, PEEK_IN, clampStand, peekCatch, silhouettePath, nudgeAnchor, defaultPeek, fitShift, fromSaved, peekPos, peekRange, pullMode, pushedIn, sideOf, standOutPos, toSaved, type Frame,
} from "../src/pet/placement";

const pet = { w: 88, h: 132 };
const phone = (w: number, inset: Partial<Frame["inset"]> = {}): Frame => ({ w, h: 780, inset: { top: 0, right: 0, bottom: 0, left: 0, ...inset } });

describe("手機邊距帶", () => {
  for (const w of [360, 390, 412]) {
    it(`寬 ${w}：站著時左右都離邊至少 32px`, () => {
      const f = phone(w);
      expect(clampStand(f, pet, { x: -50, y: 300 }).x).toBe(BAND);
      expect(w - (clampStand(f, pet, { x: w, y: 300 }).x + pet.w)).toBe(BAND);
    });
  }

  it("safe-area 比 32 大時（橫式瀏海）用 safe-area，左右各算各的", () => {
    const f: Frame = { w: 844, h: 390, inset: { top: 0, right: 47, bottom: 21, left: 0 } };
    expect(clampStand(f, pet, { x: 0, y: 0 }).x).toBe(BAND);
    expect(f.w - (clampStand(f, pet, { x: 9999, y: 0 }).x + pet.w)).toBe(47);
  });
});

describe("靠在側邊探出", () => {
  for (const w of [360, 390, 412]) {
    it(`寬 ${w}：右側探出時外框留在螢幕裡 PEEK_IN、其餘伸到螢幕外（身體貼著螢幕邊）；接觸區貼螢幕邊、帶外 CATCH_OUT、高 132`, () => {
      const f = phone(w);
      const p = peekPos(f, pet, "right", 400);
      expect(w - p.x).toBe(PEEK_IN);
      expect(p.x + pet.w).toBeGreaterThan(w);
      const c = peekCatch(f, pet, "right", p.y);
      expect(c).toEqual({ x: w - BAND - CATCH_OUT, y: p.y, w: BAND + CATCH_OUT, h: 132 });
    });
  }

  it("左側對稱", () => {
    const f = phone(390);
    const p = peekPos(f, pet, "left", 400);
    expect(p.x + pet.w).toBe(PEEK_IN);
    expect(p.x).toBeLessThan(0);
    expect(peekCatch(f, pet, "left", p.y)).toEqual({ x: 0, y: p.y, w: BAND + CATCH_OUT, h: 132 });
  });

  it("橫式瀏海：她照樣貼螢幕邊（不貼 safe-area），接觸區跟著 safe-area 加寬", () => {
    const f: Frame = { w: 844, h: 390, inset: { top: 0, right: 47, bottom: 21, left: 0 } };
    const p = peekPos(f, pet, "right", 100);
    expect(f.w - p.x).toBe(PEEK_IN);
    expect(peekCatch(f, pet, "right", p.y).w).toBe(47 + CATCH_OUT);
  });

  it("沒存過位置：右側探出，高度照原型（約螢幕 57% 處）", () => {
    const f = phone(390);
    const p = defaultPeek(f, pet);
    expect(p.side).toBe("right");
    expect(p.pos).toEqual(peekPos(f, pet, "right", Math.round(780 * 430 / 760)));
  });

  it("沿邊上下拖：高度夾在頁首下方與底邊之上", () => {
    const f = phone(390, { top: 47, bottom: 34 });
    const r = peekRange(f, pet);
    expect(peekPos(f, pet, "right", -100).y).toBe(r.minY);
    expect(r.minY).toBe(47 + 52);
    expect(peekPos(f, pet, "right", 9999).y + pet.h).toBe(780 - 34);
  });

  it("拉出來：站到同一側的邊距帶上，高度不變", () => {
    const f = phone(390);
    const r = standOutPos(f, pet, "right", 400), l = standOutPos(f, pet, "left", 400);
    expect(390 - (r.x + pet.w)).toBe(BAND);
    expect(l.x).toBe(BAND);
    expect(r.y).toBe(400);
  });
});

describe("手勢", () => {
  it("探出時：往內（右側是往左）超過 8px 且大於垂直才是拉出來，其餘是沿邊拖，6px 內不算", () => {
    expect(pullMode("right", -4, 2)).toBeNull();
    expect(pullMode("right", -12, 3)).toBe("pull");
    expect(pullMode("right", -7, 1)).toBe("slide");
    expect(pullMode("right", -10, 14)).toBe("slide");
    expect(pullMode("right", 12, 0)).toBe("slide");
    expect(pullMode("left", 12, 3)).toBe("pull");
  });

  it("站著拖：身體中線進到離邊 46px 內才算推進邊上", () => {
    const f = phone(390);
    const cx = (c: number) => c - pet.w / 2;
    expect(pushedIn(f, pet, cx(390 - 45))).toBe("right");
    expect(pushedIn(f, pet, cx(390 - 47))).toBeNull();
    expect(pushedIn(f, pet, cx(45))).toBe("left");
    expect(pushedIn(f, pet, cx(200))).toBeNull();
  });

  it("閒置縮回、選單收起：縮回比較近的那一側", () => {
    const f = phone(390);
    expect(sideOf(f, pet, 40)).toBe("left");
    expect(sideOf(f, pet, 250)).toBe("right");
  });
});

describe("讀回存的位置", () => {
  it("舊版貼右邊收起（x=2）：右側探出，高度照舊", () => {
    const f = phone(390);
    expect(fromSaved(f, pet, { x: 2, y: 0.7 })).toEqual({ pos: peekPos(f, pet, "right", 0.7 * 780), side: "right" });
  });

  it("舊版貼左邊收起（x=-1）：左側探出", () => {
    const f = phone(390);
    expect(fromSaved(f, pet, { x: -1, y: 0.3 })).toEqual({ pos: peekPos(f, pet, "left", 0.3 * 780), side: "left" });
  });

  it("研發版的收在底邊（dock: bottom）：右側預設探出", () => {
    const f = phone(390);
    expect(fromSaved(f, pet, { x: 0.69, y: 0.9, dock: "bottom" })).toEqual({ pos: defaultPeek(f, pet).pos, side: "right" });
  });

  it("落在邊緣不可點帶的舊位置往內收、站著", () => {
    const f = phone(390);
    const got = fromSaved(f, pet, { x: 0.99, y: 0.5 });
    expect(got.side).toBeNull();
    expect(f.w - (got.pos.x + pet.w)).toBe(BAND);
  });

  it("新格式探出：存了再讀回是同一個地方", () => {
    const f = phone(412);
    const p = peekPos(f, pet, "left", 333);
    const got = fromSaved(f, pet, toSaved(f, p, "left"));
    expect(got.side).toBe("left");
    expect(got.pos.x).toBe(p.x);
    expect(got.pos.y).toBeCloseTo(333);
  });

  it("轉成橫式再讀回：照新的視窗重夾", () => {
    const tall = phone(390), wide: Frame = { w: 844, h: 390, inset: { top: 0, right: 47, bottom: 21, left: 47 } };
    const got = fromSaved(wide, pet, toSaved(tall, clampStand(tall, pet, { x: 9999, y: 640 }), null));
    expect(wide.w - (got.pos.x + pet.w)).toBeGreaterThanOrEqual(47);
    expect(got.pos.y + pet.h).toBeLessThanOrEqual(wide.h - 21);
  });
});

describe("泡泡與選單", () => {
  const f = phone(360);
  it("從她身上往左溢出：往右挪回邊距帶", () => { expect(fitShift(f, -30, 260)).toBe(62); });
  it("往右溢出：往左挪", () => { expect(fitShift(f, 120, 260)).toBe(360 - 32 - 260 - 120); });
  it("本來就在帶內：不動", () => { expect(fitShift(f, 40, 200)).toBe(0); });
  it("比可用寬度還寬：靠左邊距帶", () => { expect(fitShift(f, 0, 320)).toBe(32); });
});

describe("新手提示卡掛在她頭上", () => {
  const f = phone(390);
  it("右側探出：卡片離右緣 32，尖角盡量往她那邊靠（卡片邊上留 16）", () => {
    const p = peekPos(f, pet, "right", 400), a = nudgeAnchor(390, { left: p.x, right: p.x + pet.w }, 280);
    expect(a.right).toBe(BAND);
    expect(a.tail).toBe(16);
  });
  it("左側探出：卡片整張留在畫面裡、離左緣 32，尖角靠左邊", () => {
    const p = peekPos(f, pet, "left", 400), a = nudgeAnchor(390, { left: p.x, right: p.x + pet.w }, 280);
    expect(390 - a.right - 280).toBe(BAND);
    expect(a.tail).toBe(280 - 30);
  });
  it("手機的卡只有 195 寬：左右探出時尖角都留在卡片裡", () => {
    for (const side of ["left", "right"] as const) {
      const p = peekPos(f, pet, side, 400), a = nudgeAnchor(390, { left: p.x, right: p.x + pet.w }, 195);
      expect(a.tail).toBeLessThanOrEqual(195 - 30);
      expect(a.tail).toBeGreaterThanOrEqual(16);
    }
  });
  it("站在右邊的邊距帶上：尖角指著她的中線", () => {
    const p = standOutPos(f, pet, "right", 400), a = nudgeAnchor(390, { left: p.x, right: p.x + pet.w }, 280);
    expect(a.right).toBe(BAND);
    expect(390 - a.right - a.tail - 7).toBe(p.x + pet.w / 2);
  });
});

describe("探出時她的輪廓（透明處讓點擊落到網頁）", () => {
  // 6×4 的 RGBA 圖，由上到下：第 0、1 列 x=1..2 不透明；第 2、3 列 x=0 與 x=4..5 不透明（中間是洞）
  const w = 6, h = 4, px = new Uint8Array(w * h * 4);
  const on = (x: number, y: number) => { px[(y * w + x) * 4 + 3] = 255; };
  [[1, 0], [2, 0], [1, 1], [2, 1], [0, 2], [4, 2], [5, 2], [0, 3], [4, 3], [5, 3]].forEach(([x, y]) => on(x, y));
  const rects = (d: string) => [...d.matchAll(/M([\d.]+) ([\d.]+) h([\d.]+) v([\d.]+)/g)].map((m) => m.slice(1).map(Number));

  it("每一段不透明各成一塊，洞留空", () => {
    const d = silhouettePath(px, w, h, { sx: 10, sy: 10, mirror: false, step: 2, gap: 0 });
    expect(rects(d)).toEqual([[10, 0, 20, 20], [0, 20, 10, 20], [40, 20, 20, 20]]);
  });
  it("左側翻面：左右照畫面鏡射", () => {
    const d = silhouettePath(px, w, h, { sx: 10, sy: 10, mirror: true, step: 2, gap: 0 });
    expect(rects(d)).toEqual([[30, 0, 20, 20], [50, 20, 10, 20], [0, 20, 20, 20]]);
  });
  it("很窄的縫併起來（手指本來就點不進去）", () => {
    const d = silhouettePath(px, w, h, { sx: 10, sy: 10, mirror: false, step: 2, gap: 3 });
    expect(rects(d)).toEqual([[10, 0, 20, 20], [0, 20, 60, 20]]);
  });
  it("整片透明：沒有任何一塊", () => {
    expect(silhouettePath(new Uint8Array(w * h * 4), w, h, { sx: 1, sy: 1, mirror: false, step: 2, gap: 0 })).toBe("");
  });
});
