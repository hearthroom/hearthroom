import { afterEach, expect, it, vi } from 'vitest';
import { SukiPet, type PetOptions } from '../src/pet/pet-ui';
import type { SidebarRect } from '../src/lib/sidebar-clearance';
let pet: SukiPet;
afterEach(() => { pet?.stop(); vi.restoreAllMocks(); });
function setup(mobile = false) {
  let bounds: SidebarRect | null = { left: 792, right: 1056, top: 428, bottom: 568 };
  pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 220, line: key => key, mobile, sidebarBounds: () => bounds } as PetOptions);
  const p = pet as unknown as { updateSidebar: () => void; box: () => object; place: (p: object) => void; fitPopups: () => void; driver: object; el: HTMLElement; bubble: HTMLElement; idleButton: HTMLButtonElement };
  vi.spyOn(p, 'box').mockReturnValue({ left: 909, top: 372, width: 146, height: 220, right: 1055 });
  vi.spyOn(p, 'place').mockImplementation(() => {});
  vi.spyOn(p, 'fitPopups').mockImplementation(() => {});
  p.driver = { state: { talking: false } };
  return { p, leave: () => { bounds = null; } };
}
it('starts as a silent corner avatar when the homepage sidebar has no clear operation row', () => {
  const { p } = setup(); p.updateSidebar();
  expect(p.idleButton.hidden).toBe(false);
  expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(true);
  pet.on({ type: 'say', text: 'automatic greeting' });
  expect(p.bubble.hidden).toBe(true);
});
it('expands only on the avatar action and restores ordinary behavior after leaving the sidebar page', () => {
  const { p, leave } = setup(); p.updateSidebar(); p.idleButton.click();
  expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);
  expect(p.idleButton.getAttribute('aria-expanded')).toBe('true');
  expect(p.place).toHaveBeenCalled();
  leave(); p.updateSidebar();
  expect(p.idleButton.hidden).toBe(true);
  expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);
});
it('does not introduce the desktop avatar fallback on phone pages', () => {
  const { p } = setup(true); p.updateSidebar();
  expect(p.idleButton.hidden).toBe(true);
  expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);
});

it('docks for partial rail overlap even when another operation row remains clear',()=>{
 const {p}=setup();vi.mocked(p.box).mockReturnValue({left:909,right:1055,top:500,width:146,height:220});
 p.updateSidebar();expect(p.idleButton.hidden).toBe(false);expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(true);
});
