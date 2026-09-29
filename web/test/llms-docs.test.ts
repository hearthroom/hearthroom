import { describe, expect, it } from 'vitest';
import { llmsDocs, LLMS_DOC_PATHS } from '../build/llms-docs';
import llms from '../public/llms.txt?raw';
import guideEn from '../../docs/guide/card-authoring.en.md?raw';
import guideZhHant from '../../docs/guide/card-authoring.zh-Hant.md?raw';
import developersEn from '../../docs/developers.md?raw';
import developersJa from '../../docs/developers/ja.md?raw';
import community from '../../docs/community-openapi.json';

/**
 * 站上的 /guide 與 /developers 把文件打包進前端程式，agent 抓不到原文。建置時另外產一份
 * Markdown 孿生檔（同一條路徑加 .md，語言跟著前綴走）、兩份 OpenAPI 原檔、以及一份把英文
 * 文件接起來的 /llms-full.txt。這裡守的是「產出哪些路徑、每一份裝的是哪個語言的哪份文件」。
 */
const docs = new Map(llmsDocs().map(d => [d.path, d]));

describe('llms docs emitted at build', () => {
  it('emits one Markdown twin per documentation page and locale, following the URL prefix rule', () => {
    // 預設語言（繁中）不帶前綴，其餘帶；跟 router 的網址規則一致
    for (const p of ['guide.md', 'developers.md', 'zh-Hans/guide.md', 'en/guide.md', 'ja/guide.md', 'ko/guide.md', 'zh-Hans/developers.md', 'en/developers.md', 'ja/developers.md', 'ko/developers.md']) {
      expect(docs.has(p), p).toBe(true);
    }
    expect(docs.get('guide.md')!.content).toBe(guideZhHant);
    expect(docs.get('en/guide.md')!.content).toBe(guideEn);
    expect(docs.get('ja/developers.md')!.content.startsWith(developersJa)).toBe(true);
    expect(docs.get('en/developers.md')!.content.startsWith(developersEn)).toBe(true);
    // 開發者文件的孿生檔要告訴讀者 OpenAPI 原檔在哪（頁面上有展開的端點，Markdown 裡沒有）
    expect(docs.get('en/developers.md')!.content).toContain('/developers/community-openapi.json');
    expect(docs.get('en/developers.md')!.content).toContain('/developers/integration-openapi.json');
    for (const d of docs.values()) if (d.path.endsWith('.md')) expect(d.contentType).toBe('text/markdown; charset=utf-8');
  });

  it('serves both OpenAPI sources from the site unchanged', () => {
    expect(JSON.parse(docs.get('developers/community-openapi.json')!.content)).toEqual(community);
    expect(docs.get('developers/integration-openapi.json')!.contentType).toBe('application/json; charset=utf-8');
  });

  it('assembles llms-full.txt from llms.txt and the English documentation', () => {
    const full = docs.get('llms-full.txt')!;
    expect(full.contentType).toBe('text/plain; charset=utf-8');
    expect(full.content.startsWith(llms.trimEnd())).toBe(true);
    expect(full.content).toContain(developersEn.trimEnd());
    expect(full.content).toContain(guideEn.trimEnd());
    expect(full.content.indexOf(developersEn.trimEnd())).toBeLessThan(full.content.indexOf(guideEn.trimEnd()));
  });

  it('exposes the emitted paths so llms.txt can link to them', () => {
    expect(new Set(LLMS_DOC_PATHS)).toEqual(new Set(docs.keys()));
    for (const p of LLMS_DOC_PATHS) expect(p, p).not.toMatch(/^\//);
  });
});
