/** 桌機這一排沒有站的地方：縮回邊上探頭，不淡出（PM 2026-10-30 首頁桌寵 A）；探頭也壓到東西才縮窄、再不行才淡出 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PhoneClearance } from '../src/pet/home-clearance';
import { deskPeekReach } from '../src/pet/standby-clearance';

let space: PhoneClearance | null = null;
vi.mock('../src/pet/standby-clearance', async (orig) => ({ ...(await orig<typeof import('../src/pet/standby-clearance')>()), phoneControls: () => space }));
const { SukiPet } = await import('../src/pet/pet-ui');
type Pet = { el: HTMLElement; pos: { x: number; y: number }; tucked: boolean; deskX: number | null; driver: object; menuEl: HTMLElement;
  updateDesk: () => void; box: () => object; refit: () => void; tuck: (side: 'left' | 'right', silent?: boolean) => void; poke: (e: PointerEvent) => void };
let pet: InstanceType<typeof SukiPet>, p: Pet, now = 1000;
const row = (left: number, right: number) => ({ left, right, top: 700, bottom: 740 });
const PEEK = 146 * 0.38;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('innerWidth', 1280); vi.stubGlobal('innerHeight', 900);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 220, line: (k: string) => k, mobile: false, reducedMotion: true, menu: () => [{ label: 'Roll', run: () => {} }] } as never);
  p = pet as unknown as Pet;
  p.driver = { state: { talking: false, look: null } };
  document.body.append(p.el);
  Object.assign(p, { rig: {} });
  vi.spyOn(p, 'box').mockImplementation(() => ({ left: p.pos.x, top: p.pos.y, width: 146, height: 220, right: p.pos.x + 146 }));
  p.pos = { x: 1110, y: 672 };
});
afterEach(() => { pet.stop(); space = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('探頭露多寬：離最近的可點東西 8px，太窄就沒有', () => {
  const f = { vw: 1280, y: 672, h: 220, full: PEEK };
  expect(deskPeekReach({ ...f, side: 'right', obstacles: [] })).toBe(PEEK);
  expect(deskPeekReach({ ...f, side: 'right', obstacles: [row(984, 1232)] })).toBe(40);
  expect(deskPeekReach({ ...f, side: 'right', obstacles: [row(984, 1262)] })).toBeNull();
  expect(deskPeekReach({ ...f, side: 'left', obstacles: [row(36, 400)] })).toBe(28);
  // 別一排的東西不算
  expect(deskPeekReach({ ...f, side: 'right', obstacles: [{ left: 0, right: 1280, top: 100, bottom: 200 }] })).toBe(PEEK);
});

it('這一排都是卡片：縮回比較近的邊上探頭，不存位置；空出來 300ms 後回原位站好', () => {
  space = { top: 60, bottom: 900, obstacles: [row(0, 1232)] };
  p.updateDesk();
  expect(p.tucked).toBe(true);
  expect(p.el.classList.contains('suki-pet--tucked')).toBe(true);
  expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(false);
  expect(p.pos.x).toBe(1280 - 40);
  expect(localStorage.getItem('suki.pet.pos')).toBeNull();
  space = { top: 60, bottom: 900, obstacles: [] };
  p.updateDesk(); expect(p.tucked).toBe(true);
  now += 300; p.updateDesk();
  expect(p.tucked).toBe(false);
  expect(p.el.classList.contains('suki-pet--tucked')).toBe(false);
  expect(p.pos.x).toBe(1110);
  expect(p.deskX).toBeNull();
  expect(localStorage.getItem('suki.pet.pos')).toBeNull();
});

it('探頭的地方也有東西（縮到最窄還碰到）：才淡出', () => {
  space = { top: 60, bottom: 900, obstacles: [row(0, 1264)] };
  p.updateDesk();
  expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(true);
  expect(p.el.inert).toBe(true);
});

it('使用者自己收在邊上：探頭壓到側欄就縮窄，空出來回原本的寬度；不改存的位置', () => {
  p.tuck('right', true);
  const saved = localStorage.getItem('suki.pet.pos');
  space = { top: 60, bottom: 900, obstacles: [row(984, 1232)] };
  p.updateDesk();
  expect(p.pos.x).toBe(1240);
  space = { top: 60, bottom: 900, obstacles: [] };
  p.updateDesk();
  expect(p.pos.x).toBeCloseTo(1280 - PEEK);
  expect(p.tucked).toBe(true);
  expect(localStorage.getItem('suki.pet.pos')).toBe(saved);
});

it('自動探頭時點她：開選單，不站回那一排滿的地方；視窗改大小也不存成收邊', () => {
  space = { top: 60, bottom: 900, obstacles: [row(0, 1232)] };
  p.updateDesk();
  p.refit();
  expect(localStorage.getItem('suki.pet.pos')).toBeNull();
  p.poke({ clientX: 1260, clientY: 700 } as PointerEvent);
  expect(p.tucked).toBe(true);
  expect(p.menuEl.hidden).toBe(false);
});

it('自動探頭時視窗變矮：高度跟著夾回畫面裡，站回去時不會在視窗外', () => {
  const touch = (p as unknown as { touch: HTMLElement }).touch;
  Object.defineProperty(touch, 'clientWidth', { configurable: true, value: 146 }); Object.defineProperty(touch, 'clientHeight', { configurable: true, value: 220 });
  space = { top: 60, bottom: 900, obstacles: [row(0, 1232)] };
  p.updateDesk();
  vi.stubGlobal('innerHeight', 600);
  p.refit();
  expect(p.pos.y + 220).toBeLessThanOrEqual(600);
  expect(localStorage.getItem('suki.pet.pos')).toBeNull();
});

it('自動探頭時進編輯器：照樣收到邊上（使用者點她會站出來，不只開選單）', () => {
  space = { top: 60, bottom: 900, obstacles: [row(0, 1232)] };
  p.updateDesk();
  (p as unknown as { tuckAside: () => void; deskPeeked: boolean }).tuckAside();
  expect((p as unknown as { deskPeeked: boolean }).deskPeeked).toBe(false);
  expect(p.tucked).toBe(true);
});

it('從自動探頭拖她、拖到一半被取消：仍是自動探頭，不變成使用者的收邊', () => {
  space = { top: 60, bottom: 900, obstacles: [row(0, 1232)] };
  p.updateDesk();
  const q = p as unknown as { drag: unknown; deskPeeked: boolean };
  q.drag = { moved: true }; p.updateDesk();
  q.drag = undefined;
  expect(q.deskPeeked).toBe(true);
});
