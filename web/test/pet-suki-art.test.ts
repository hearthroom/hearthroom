/**
 * 一個畫面只有一個蘇綺（設定書 2026-10-19；任務 2026-10-30 desk-pet-mobile-overlap 第二班）：
 * 頁面上的蘇綺插圖進到視野裡，桌寵就淡出；捲走了回來。啾啾、站名旁的小頭像、安裝提示的圖示，
 * 以及 owner 說過她不必躲的首頁面板、歡迎橫幅、新手引導（標 data-pet-stays）都不算。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sukiArtInView } from '../src/pet/suki-art';

const at = (sel: string, r: DOMRect) => { for (const el of document.querySelectorAll<HTMLElement>(sel)) el.getBoundingClientRect = () => r; };
let clock = 0;
beforeEach(() => { vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 844); vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1000)); });
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('404 的蘇綺插圖、我的頁簽到卡的頭像在視野內：算', () => {
  document.body.innerHTML = '<img class="fail" src="/mascot/suki-fail.webp">';
  at('.fail', new DOMRect(95, 100, 200, 200));
  expect(sukiArtInView()).toBe(true);
  document.body.innerHTML = '<article class="ck"><img class="ck__suki" src="/mascot/suki-avatar.webp"></article>';
  at('.ck__suki', new DOMRect(32, 600, 56, 56));
  expect(sukiArtInView()).toBe(true);
});

it('捲出視野、沒有大小、被藏起來：不算', () => {
  document.body.innerHTML = '<img class="a" src="/mascot/suki-fail.webp"><img class="b" src="/mascot/suki-hoard.webp"><img class="c" style="visibility:hidden" src="/mascot/suki-wave.webp">';
  at('.a', new DOMRect(95, 900, 200, 200));
  at('.b', new DOMRect(0, 0, 0, 0));
  at('.c', new DOMRect(95, 100, 200, 200));
  expect(sukiArtInView()).toBe(false);
});

it('啾啾、站名旁的小頭像、她自己、標了 data-pet-stays 的區塊：不算', () => {
  document.body.innerHTML = `<img class="x" src="/mascot/chuchu-heart.webp"><img class="x" src="/mascot/suki-mark.webp">
    <div class="suki-pet"><img class="x" src="/mascot/suki-avatar.webp"></div><button class="suki-pet__idle"><img class="x" src="/mascot/suki-avatar.webp"></button>
    <section data-pet-stays><img class="x" src="/mascot/home/pose-wave.webp"></section><img class="x" data-pet-stays src="/mascot/suki-avatar.webp">`;
  at('.x', new DOMRect(95, 100, 200, 200));
  expect(sukiArtInView()).toBe(false);
});
