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
  let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
  space = { top: 60, bottom: 900, obstacles: [row(0, 1280)] };
  p.updateDesk();
  expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(true);
  expect(p.el.inert).toBe(true);
  space = { top: 60, bottom: 900, obstacles: [] };
  p.updateDesk(); now += 300; p.updateDesk();
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

it('只是點她、長按（沒拖動）：原位不變，讓開後照樣回去', () => {
  space = { top: 60, bottom: 900, obstacles: [row(1060, 1132)] };
  p.updateDesk(); expect(p.deskX).toBe(1110);
  p.drag = { moved: false }; p.updateDesk();
  expect(p.deskX).toBe(1110);
  p.drag = null; space = { top: 60, bottom: 900, obstacles: [] }; p.updateDesk();
  expect(p.pos.x).toBe(1110);
});

it('設定頁「叫她出來」：回預設位置，不再滑回之前讓開前的位置', () => {
  space = { top: 60, bottom: 900, obstacles: [row(1060, 1132)] };
  p.updateDesk(); expect(p.deskX).toBe(1110);
  (p as unknown as { summon: () => void }).summon();
  expect(p.deskX).toBeNull();
});

it('放在螢幕最邊上、底下沒東西：不動', () => {
  space = { top: 60, bottom: 900, obstacles: [] };
  p.pos = { x: 0, y: 672 }; p.updateDesk(); expect(p.pos.x).toBe(0);
  p.pos = { x: 1280 - 146, y: 672 }; p.updateDesk(); expect(p.pos.x).toBe(1134);
});

it('卡片頁的版面避讓接手時，桌機讓路的淡出狀態一起放掉', () => {
  pet.stop();
  let clearance: PhoneClearance | null = null;
  pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 220, line: (k: string) => k, mobile: false, reducedMotion: true, phoneClearance: () => clearance } as never);
  p = pet as unknown as Pet; p.driver = { state: { talking: false } }; document.body.append(p.el); Object.assign(p, { rig: {} });
  vi.spyOn(p, 'box').mockImplementation(() => ({ left: p.pos.x, top: p.pos.y, width: 146, height: 220, right: p.pos.x + 146 }));
  p.pos = { x: 1110, y: 672 };
  space = { top: 60, bottom: 900, obstacles: [row(0, 1280)] };
  const q = p as unknown as { updateClearance: () => void; deskAway: boolean };
  q.updateClearance(); expect(q.deskAway).toBe(true);
  clearance = { top: 60, bottom: 900, obstacles: [] }; q.updateClearance();
  expect(q.deskAway).toBe(false);
});

it('桌機招呼泡泡蓋到關鍵數字：泡泡在視窗內左右挪開；挪不開就不說', () => {
  vi.stubGlobal('innerWidth', 1440);
  document.body.insertAdjacentHTML('beforeend', '<strong id="amt" data-pet-avoid>處理中：3,000 積分</strong>');
  const amt = document.getElementById('amt')!;
  let key = new DOMRect(1099, 500, 113, 18);
  amt.getBoundingClientRect = () => key;
  vi.spyOn(document, 'createRange').mockImplementation(() => ({ selectNodeContents: () => {}, getBoundingClientRect: () => key }) as unknown as Range);
  const q = p as unknown as { bubble: HTMLElement; fitPopups: () => void };
  q.bubble.hidden = false;
  q.bubble.getBoundingClientRect = () => new DOMRect(1045, 430, 217, 79);
  q.fitPopups();
  expect(q.bubble.style.translate).toBe('-171px 0px');
  expect(q.bubble.hidden).toBe(false);
  key = new DOMRect(0, 500, 1440, 18);
  q.bubble.style.translate = '';
  q.fitPopups();
  expect(q.bubble.hidden).toBe(true);
  amt.remove();
});

it('捲過卡片列之間的短空隙不閃：淡出後要空出 300ms 才回來', () => {
  let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
  space = { top: 60, bottom: 900, obstacles: [row(0, 1280)] };
  p.updateDesk(); expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(true);
  space = { top: 60, bottom: 900, obstacles: [] };
  now = 1100; p.updateDesk(); expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(true);
  space = { top: 60, bottom: 900, obstacles: [row(0, 1280)] };
  now = 1200; p.updateDesk();
  space = { top: 60, bottom: 900, obstacles: [] };
  now = 1300; p.updateDesk(); expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(true);
  now = 1650; p.updateDesk(); expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(false);
});

it('先讓開、再整排淡出、空出來後：回到她自己的位置，不是讓開的那個位置（正式站回讀 2026-10-30）', () => {
  let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
  space = { top: 60, bottom: 900, obstacles: [row(1060, 1132)] };
  p.updateDesk(); expect(p.pos.x).toBe(906);
  space = { top: 60, bottom: 900, obstacles: [row(0, 1280)] };
  now += 16; p.updateDesk(); expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(true);
  space = { top: 60, bottom: 900, obstacles: [] };
  for (let i = 0; i < 30; i++) { now += 16; p.updateDesk(); }
  expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(false);
  expect(p.pos.x).toBe(1110);
  expect(p.deskX).toBeNull();
});
