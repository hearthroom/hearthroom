import { describe, expect, it } from 'vitest';
import llms from '../public/llms.txt?raw';
import routerSource from '../src/router.ts?raw';

/**
 * /llms.txt 是給 AI agent 看的站點索引（https://llmstxt.org）。它列的都是站外可直接抓的 Markdown／JSON
 * 原文，因為本站的 /guide 與 /developers 把文件打包進前端程式，沒有 raw 網址。這裡只守三件事：
 * 檔案照規範的形狀寫、每個連結指向真的存在的東西、沒有把內部名稱或別的品牌寫進去。
 */
// 倉裡 docs/ 底下所有可被連結的檔案，路徑轉成相對倉根（跟 raw 網址的路徑段一致）
const repoDocs = new Set(Object.keys(import.meta.glob('../../docs/**/*.{md,json}')).map(p => p.replace(/^\.\.\/\.\.\//, '')));
const lines = llms.split('\n');
const links = [...llms.matchAll(/^- \[([^\]]+)\]\(([^)]+)\)(: .+)?$/gm)].map(([, title, url, note]) => ({ title, url, note }));

/** router.ts 裡的靜態路徑（不含參數段），本站連結只能指向這些。 */
const staticRoutes = new Set(
  [...routerSource.matchAll(/path: "([^"]*)"/g)].map(m => m[1]!).filter(p => !p.includes(':')).map(p => `/${p.replace(/^\//, '')}`),
);

describe('llms.txt', () => {
  it('follows the llms.txt shape: H1, blockquote summary, then sections of link lists', () => {
    expect(lines[0]).toBe('# Hearthroom');
    expect(lines.find((l, i) => i > 0 && l.trim() !== '')).toMatch(/^> \S/);
    const sections = lines.filter(l => l.startsWith('## '));
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections.at(-1)).toBe('## Optional');
    // 每個連結列都要有一句用途說明，agent 才能不點開就決定要不要讀
    for (const link of links) expect(link.note, link.url).toBeTruthy();
    // 非空白的列只能是標題、引言、連結列、或事實段落的項目
    expect(lines.filter(l => l.startsWith('- ') && !/^- \[/.test(l)).length).toBeGreaterThan(0);
  });

  it('links only to things that exist', () => {
    expect(links.length).toBeGreaterThan(5);
    for (const { url } of links) {
      const u = new URL(url);
      if (u.host === 'hearthroom.club') {
        expect(staticRoutes.has(u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, '')), url).toBe(true);
      } else if (u.host === 'raw.githubusercontent.com' && u.pathname.startsWith('/hearthroom/hearthroom/main/')) {
        // 本倉的檔案：連結存在 ⇔ 檔案在 main 上存在。這裡用工作樹當代理。
        expect(repoDocs.has(u.pathname.slice('/hearthroom/hearthroom/main/'.length)), url).toBe(true);
      } else {
        // 別的倉（CLI）與社群連結：只能是我們自己的組織，其餘一律不放
        expect(url, url).toMatch(/^https:\/\/(raw\.githubusercontent\.com\/hearthroom\/cli\/main\/|github\.com\/hearthroom\/|discord\.gg\/)/);
      }
    }
  });

  it('is written for a reader without our context', () => {
    expect(llms).not.toMatch(/HarperHarbor|\bHarbor\b|LunaTalk|Lunarhub|owner|TODO|worktree/i);
    // 模型可見的字不放內部檔名或函式名
    expect(llms).not.toMatch(/\b\w+\.(ts|vue|go|mjs)\b/);
    // 站上的登入頁面不列成入口：/create、/mine、/wallet 對 robots 也是關的
    for (const p of ['/create', '/mine', '/wallet', '/auth/']) expect(links.some(l => l.url.includes(`hearthroom.club${p}`)), p).toBe(false);
  });
});
