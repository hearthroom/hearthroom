import { afterEach, expect, it, vi } from 'vitest';
import { SukiPet, type PetOptions } from '../src/pet/pet-ui';
let pet: SukiPet | undefined;
afterEach(() => { pet?.stop(); vi.restoreAllMocks(); });
function setup(mobile = false) {
  pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 100, line: k => k, mobile } as PetOptions);
  const p = pet as unknown as {
    tucked: boolean; peekS: number; clipped: boolean; drag: object | undefined; canvas: HTMLCanvasElement; touch: HTMLElement;
    rig: { params: Record<string, number> }; driver: { state: object; update: () => void }; view: { draw: () => void; readRect: () => { px: Uint8Array; w: number; h: number } };
    updateClip: (now: number) => void; frame: (dt: number, now: number) => void; playActivity: () => void; brain: () => void;
  };
  const px = new Uint8Array(10 * 10 * 4);
  for (let y = 0; y < 10; y++) for (let x = 4; x < 6; x++) px[(y * 10 + x) * 4 + 3] = 255;
  Object.assign(p.canvas.style, { width: '180px', height: '124px', left: '-40px', top: '-12px' });
  vi.spyOn(p.touch, 'clientWidth', 'get').mockReturnValue(100); vi.spyOn(p.touch, 'clientHeight', 'get').mockReturnValue(100);
  p.tucked = true; p.peekS = mobile ? 0 : 1;
  p.rig = { params: {} }; p.driver = { state: { talking: false }, update: vi.fn() };
  const order: string[] = [];
  p.view = { draw: vi.fn(() => order.push('draw')), readRect: vi.fn(() => { order.push('read'); return { px, w: 10, h: 10 }; }) };
  vi.spyOn(p, 'playActivity').mockImplementation(() => {}); vi.spyOn(p, 'brain').mockImplementation(() => {});
  return { p, order };
}
it('clips a tucked desktop pet even though its mobile peek progress stays at one', () => {
  const { p } = setup(); p.updateClip(performance.now());
  expect(p.view.readRect).toHaveBeenCalledOnce(); expect(p.touch.style.clipPath).toContain('path('); expect(p.clipped).toBe(true);
});
it('refreshes the desktop contour from the rendered frame after drawing', () => {
  const { p, order } = setup(); p.frame(.016, performance.now());
  expect(order).toEqual(['draw', 'read']); expect(p.touch.style.clipPath).toContain('path(');
});
it('preserves the existing mobile peek contour and releases it when standing', () => {
  const { p } = setup(true); p.updateClip(performance.now()); expect(p.touch.style.clipPath).toContain('path(');
  p.tucked = false; p.updateClip(performance.now() + 16); expect(p.touch.style.clipPath).toBe(''); expect(p.clipped).toBe(false);
});
it('does not retain a stale contour while the desktop pet is being dragged', () => {
  const { p } = setup(); p.touch.style.clipPath = 'inset(40%)'; p.clipped = true; p.drag = { moved: true };
  p.updateClip(performance.now()); expect(p.touch.style.clipPath).toBe(''); expect(p.clipped).toBe(false);
});
