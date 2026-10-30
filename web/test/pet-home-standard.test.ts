/** 首頁的桌寵跟其他頁一樣（owner 2026-10-30）：不縮成角落小頭像、平板寬度不停車，壓到側欄就照全站的讓路規則 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PhoneClearance } from '../src/pet/home-clearance';

let space: PhoneClearance | null = null;
vi.mock('../src/pet/standby-clearance', async (orig) => ({ ...(await orig<typeof import('../src/pet/standby-clearance')>()), phoneControls: () => space }));
const { SukiPet } = await import('../src/pet/pet-ui');
type Pet = { el: HTMLElement; pos: { x: number; y: number }; driver: object; bubble: HTMLElement;
  updateClearance: () => void; box: () => object; save: (p: { x: number; y: number }) => void; on: (e: object) => void };
let pet: InstanceType<typeof SukiPet>, p: Pet;
// 首頁側欄：右側一整欄入口（1280 寬時約 984–1248）
const rail = { left: 984, right: 1248, top: 386, bottom: 800 };

function setup(width: number, homepage: Record<string, unknown>) {
  vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', 800);
  // 舊版首頁專用的選項：現在不認，傳了也跟其他頁一樣
  pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 220, line: (k: string) => k, mobile: false, reducedMotion: true, ...homepage } as never);
  p = pet as unknown as Pet;
  p.driver = { state: { talking: false } };
  document.body.append(p.el);
  Object.assign(p, { rig: {} });
  vi.spyOn(p, 'box').mockImplementation(() => ({ left: p.pos.x, top: p.pos.y, width: 146, height: 220, right: p.pos.x + 146 }));
}
beforeEach(() => localStorage.clear());
afterEach(() => { pet.stop(); space = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('桌機首頁站在側欄上：不變成小頭像，照全站規則沿這一排讓開', () => {
  setup(1280, { sidebarBounds: () => rail });
  p.pos = { x: 1109, y: 572 };
  space = { top: 60, bottom: 800, obstacles: [rail] };
  p.updateClearance();
  expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);
  expect(document.querySelector('.suki-pet__idle')).toBeNull();
  expect(p.pos.x).toBe(984 - 8 - 146);
  // 照常說話（小頭像時她整個不出聲）
  pet.on({ type: 'say', text: 'hi' });
  expect(p.bubble.hidden).toBe(false);
});

it('平板寬度的首頁：不停車，位置照常存', () => {
  setup(900, { parkOnHomepage: () => true, sidebarBounds: () => null });
  p.pos = { x: 600, y: 400 };
  space = { top: 60, bottom: 800, obstacles: [] };
  p.updateClearance();
  expect(p.el.classList.contains('suki-pet--home-parked')).toBe(false);
  expect(p.el.classList.contains('suki-pet--sidebar-avatar')).toBe(false);
  expect(p.pos).toEqual({ x: 600, y: 400 });
  p.save({ x: 600, y: 400 });
  expect(localStorage.getItem('suki.pet.pos')).not.toBeNull();
});
