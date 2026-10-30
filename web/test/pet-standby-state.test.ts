/** 手機待機讓路的狀態：暫時退場時從選單叫她要看得到；點一下不算換位置；讓開的高度不存（code-review 934c7572） */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PhoneClearance } from '../src/pet/home-clearance';

let space: PhoneClearance | null = null;
vi.mock('../src/pet/standby-clearance', async (orig) => ({ ...(await orig<typeof import('../src/pet/standby-clearance')>()), phoneControls: () => space }));
const { SukiPet } = await import('../src/pet/pet-ui');
type Pet = { el: HTMLElement; tucked: boolean; peekS: number; side: string; pos: { x: number; y: number }; drag: unknown; standbyY: number | null; menuEl: HTMLElement;
  driver: object; updateClearance: () => void; updateStandby: () => void; save: (p: object, peeking?: boolean) => void; openFrom: (o: HTMLElement | null) => void };
let pet: InstanceType<typeof SukiPet>, p: Pet;
const full = (top: number, bottom: number) => ({ left: 16, right: 374, top, bottom });

beforeEach(() => {
  vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 844);
  pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 132, line: (k: string) => k, mobile: true, reducedMotion: true } as never);
  p = pet as unknown as Pet;
  p.driver = { state: { talking: false } };
  document.body.append(p.el);
  Object.assign(p, { tucked: true, rig: {}, peekS: 0, side: 'right' });
  p.pos = { x: 342, y: 478 };
});
afterEach(() => { pet.stop(); space = null; localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('暫時退場時從帳號選單叫她：選單看得到、點得到', () => {
  space = { top: 52, bottom: 844, obstacles: Array.from({ length: 9 }, (_, i) => full(60 + i * 90, 140 + i * 90)) };
  p.updateStandby();
  expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(true);
  expect(p.el.inert).toBe(true);
  p.openFrom(null);
  expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(false);
  expect(p.el.inert).toBe(false);
  expect(p.menuEl.hidden).toBe(false);
});

it('讓開之後點她或往內拉，不會把讓開的高度當成她的位置', () => {
  // 原高度整排滿寬，換到 528
  space = { top: 52, bottom: 844, obstacles: [full(470, 520)] };
  p.updateStandby();
  expect(p.pos.y).toBe(528);
  expect(p.standbyY).toBe(478);
  p.drag = { mode: undefined }; p.updateStandby();
  expect(p.standbyY).toBe(478);
  p.drag = { mode: 'pull' }; p.updateStandby();
  expect(p.standbyY).toBe(478);
  // 拉一半彈回去時會存：存的是她原本的高度
  p.drag = null; p.save(p.pos, true);
  expect(JSON.parse(localStorage.getItem('suki.pet.pos')!).y).toBeCloseTo(478 / 844);
  // 沿邊拖才是換位置
  p.drag = { mode: 'slide' }; p.updateStandby();
  expect(p.standbyY).toBeNull();
});

it('很快的沿邊拖（同一格內放開）也算換位置', () => {
  space = { top: 52, bottom: 844, obstacles: [full(470, 520)] };
  p.updateStandby();
  expect(p.standbyY).toBe(478);
  const d = { ox: 380, oy: 600, s0: 0, y0: p.pos.y, moved: false } as Record<string, unknown>;
  (p as unknown as { peekDrag: (e: object, d: object) => void }).peekDrag({ clientX: 380, clientY: 660 }, d);
  expect(d.mode).toBe('slide');
  expect(p.standbyY).toBeNull();
});
