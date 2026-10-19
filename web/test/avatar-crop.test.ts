import { describe, expect, it } from 'vitest';
import { clampPan, cropRect, isAnimatedImage } from '../src/lib/avatar-crop';

describe('頭像裁切的取景框', () => {
  it('沒拖也沒放大：直式圖取正中間那塊正方形', () => {
    expect(cropRect({ width: 400, height: 600, viewport: 200, zoom: 1, x: 0, y: 0 })).toEqual({ sx: 0, sy: 100, size: 400 });
  });
  it('往下拖等於看圖的上半部；放大兩倍取一半大的範圍', () => {
    const r = cropRect({ width: 400, height: 600, viewport: 200, zoom: 2, x: 0, y: 50 });
    expect(r.size).toBe(200);
    expect(r.sx).toBe(100);
    expect(r.sy).toBe(150);
  });
  it('拖過頭會被擋在圖片邊緣，取景框不會露出空白', () => {
    const pan = clampPan({ width: 400, height: 600, viewport: 200, zoom: 1, x: 999, y: -999 });
    expect(pan).toEqual({ x: 0, y: -50 });
    const r = cropRect({ width: 400, height: 600, viewport: 200, zoom: 1, ...pan });
    expect(r.sy + r.size).toBe(600);
  });
});

describe('動圖不裁切（裁了會變成靜態圖）', () => {
  const file = (bytes: number[], type: string) => new File([new Uint8Array(bytes)], 'a', { type });
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  it('GIF 一律當動圖', async () => {
    expect(await isAnimatedImage(file(ascii('GIF89a'), 'image/gif'))).toBe(true);
  });
  it('PNG 有 acTL 才是 APNG', async () => {
    expect(await isAnimatedImage(file([...ascii('\x89PNG'), ...ascii('acTL'), ...ascii('IDAT')], 'image/png'))).toBe(true);
    expect(await isAnimatedImage(file([...ascii('\x89PNG'), ...ascii('IDAT')], 'image/png'))).toBe(false);
  });
  it('WebP 有 ANIM 才是動圖；JPEG 不是', async () => {
    expect(await isAnimatedImage(file(ascii('RIFF....WEBPVP8XANIM'), 'image/webp'))).toBe(true);
    expect(await isAnimatedImage(file(ascii('RIFF....WEBPVP8 '), 'image/webp'))).toBe(false);
    expect(await isAnimatedImage(file([0xff, 0xd8, 0xff], 'image/jpeg'))).toBe(false);
  });
});
