/** 畫面上有別的蘇綺時桌寵淡出、不擋點擊；從選單叫她時照樣出來（任務 2026-10-30 desk-pet-mobile-overlap 第二班） */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SukiPet } from '../src/pet/pet-ui';

type Pet = { el: HTMLElement; menuEl: HTMLElement; driver: object; updateArt: () => void; openFrom: (o: HTMLElement | null) => void; closeMenu: () => void };
let pet: SukiPet, p: Pet, art = true;
beforeEach(() => {
  vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 844);
  pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 132, line: (k: string) => k, mobile: true, reducedMotion: true, sukiArtInView: () => art } as never);
  p = pet as unknown as Pet;
  p.driver = { state: { talking: false } };
  document.body.append(p.el);
});
afterEach(() => { pet.stop(); art = true; vi.unstubAllGlobals(); });

it('別的蘇綺在視野內：淡出且點擊穿過去；離開視野回來', () => {
  p.updateArt();
  expect(p.el.classList.contains('suki-pet--away')).toBe(true);
  art = false; p.updateArt();
  expect(p.el.classList.contains('suki-pet--away')).toBe(false);
});

it('從帳號選單叫她：選單開著時她出來，關了再淡出', () => {
  p.updateArt();
  p.openFrom(null); p.updateArt();
  expect(p.el.classList.contains('suki-pet--away')).toBe(false);
  expect(p.menuEl.hidden).toBe(false);
  p.closeMenu(); p.updateArt();
  expect(p.el.classList.contains('suki-pet--away')).toBe(true);
});
