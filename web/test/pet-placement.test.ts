/**
 * 桌寵在手機上站哪裡（任務 2026-10-23 曲面屏點不到，規格 docs/studio/tasks/2026-10-23-pet-curved-screen/ui-v3.md）：
 *   - 左右永遠離邊至少 32px，safe-area 比 32 大就用 safe-area（橫式瀏海）
 *   - 收起＝靠在側邊探出：外框貼著螢幕邊，帶外露出 56px 可點；預設右側
 *   - 往內拖分「拉出來」與「沿邊上下拖」；站著推進邊上放開就縮回那一側
 *   - 舊版存的「貼左／右邊收起」與研發版的「收在底邊」讀回時改成探出；落在邊緣的舊位置往內收
 *   - 泡泡與選單整個落在邊距帶內
 */
import { describe, expect, it } from "vitest";
import {
  BAND, PEEK_OUT, clampStand, defaultPeek, fitShift, fromSaved, peekPos, peekRange, pullMode, pushedIn, sideOf, standOutPos, toSaved, wallHide, type Frame,
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
    it(`寬 ${w}：右側外框貼著螢幕邊，帶外露出 56px，帶內那 32px 被牆擋住`, () => {
      const f = phone(w);
      const p = peekPos(f, pet, "right", 400);
      expect(p.x + pet.w).toBe(w);
      expect(w - BAND - p.x).toBe(PEEK_OUT);
      expect(PEEK_OUT).toBeGreaterThanOrEqual(44);
      expect(wallHide(f, pet, "right", p.x)).toBe(BAND);
    });
  }

  it("左側對稱", () => {
    const f = phone(390);
    const p = peekPos(f, pet, "left", 400);
    expect(p.x).toBe(0);
    expect(p.x + pet.w - BAND).toBe(PEEK_OUT);
    expect(wallHide(f, pet, "left", p.x)).toBe(BAND);
  });

  it("橫式瀏海：牆跟著 safe-area 往內，帶外仍露 56px", () => {
    const f: Frame = { w: 844, h: 390, inset: { top: 0, right: 47, bottom: 21, left: 0 } };
    const p = peekPos(f, pet, "right", 100);
    expect(f.w - 47 - p.x).toBe(PEEK_OUT);
    expect(wallHide(f, pet, "right", p.x)).toBe(pet.w - PEEK_OUT);
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

  it("拉出來：站到同一側的邊距帶上，高度不變；站著時沒有東西被牆擋住", () => {
    const f = phone(390);
    const r = standOutPos(f, pet, "right", 400), l = standOutPos(f, pet, "left", 400);
    expect(390 - (r.x + pet.w)).toBe(BAND);
    expect(l.x).toBe(BAND);
    expect(r.y).toBe(400);
    expect(wallHide(f, pet, "right", r.x)).toBe(0);
    expect(wallHide(f, pet, "left", l.x)).toBe(0);
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
