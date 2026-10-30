/** 桌機站著時讓路（PM 2026-10-30 第三班 A）：沿這一排挪到空位、沒有就淡出、原位空出來就回去；拖她、她自己走過去就是新位置 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PhoneClearance } from '../src/pet/home-clearance';

let space: PhoneClearance | null = null;
vi.mock('../src/pet/standby-clearance', async (orig) => ({ ...(await orig<typeof import('../src/pet/standby-clearance')>()), phoneControls: () => space }));
const { SukiPet } = await import('../src/pet/pet-ui');
type Pet = { el: HTMLElement; pos: { x: number; y: number }; drag: unknown; walk: unknown; deskX: number | null; driver: object;
  updateDesk: () => void; box: () => object; place: (p: { x: number; y: number }) => void };
let pet: InstanceType<typeof SukiPet>, p: Pet;
const row = (left: number, right: number) => ({ left, right, top: 700, bottom: 740 });

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1280); vi.stubGlobal('innerHeight', 900);
  pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 220, line: (k: string) => k, mobile: false, reducedMotion: true } as never);
  p = pet as unknown as Pet;
  p.driver = { state: { talking: false } };
  document.body.append(p.el);
  Object.assign(p, { rig: {} });
  vi.spyOn(p, 'box').mockImplementation(() => ({ left: p.pos.x, top: p.pos.y, width: 146, height: 220, right: p.pos.x + 146 }));
  p.pos = { x: 1110, y: 672 };
});
afterEach(() => { pet.stop(); space = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('壓到金額：沿這一排讓開，不存位置；金額捲走了回原位', () => {
  space = { top: 60, bottom: 900, obstacles: [row(1060, 1132)] };
  p.updateDesk();
  expect(p.pos.x).toBe(906);
  expect(localStorage.getItem('suki.pet.pos')).toBeNull();
  space = { top: 60, bottom: 900, obstacles: [] };
  p.updateDesk();
  expect(p.pos.x).toBe(1110);
  expect(p.deskX).toBeNull();
});

it('這一排滿了：淡出、點擊穿過；空出來在原位出現', () => {
  space = { top: 60, bottom: 900, obstacles: [row(0, 1280)] };
  p.updateDesk();
  expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(true);
  expect(p.el.inert).toBe(true);
  space = { top: 60, bottom: 900, obstacles: [] };
  p.updateDesk();
  expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(false);
  expect(p.el.inert).toBe(false);
  expect(p.pos.x).toBe(1110);
});

it('拖她或她自己走動：現在的位置就是新的原位', () => {
  space = { top: 60, bottom: 900, obstacles: [row(1060, 1132)] };
  p.updateDesk(); expect(p.deskX).toBe(1110);
  p.drag = { moved: true }; p.updateDesk();
  expect(p.deskX).toBeNull();
  p.drag = null; p.deskX = 1110; p.walk = { from: 906, to: 500, t: 0, hops: 3 }; p.updateDesk();
  expect(p.deskX).toBeNull();
});

it('淡出時從帳號選單叫她：選單看得到', () => {
  space = { top: 60, bottom: 900, obstacles: [row(0, 1280)] };
  p.updateDesk();
  expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(true);
  (p as unknown as { openFrom: (o: HTMLElement | null) => void; menuEl: HTMLElement }).openFrom(null);
  expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(false);
  expect(p.el.inert).toBe(false);
});
