import { beforeEach, describe, expect, it } from 'vitest';
import shell from '../index.html?raw';
import { LLMS_DOC_PATHS } from '../build/llms-docs';
import { MARKDOWN_TWIN_PAGES, updateMarkdownTwin } from '../src/lib/markdown-twin';

/**
 * 讓讀 HTML 的 agent 能從 <head> 找到給它的版本：每一頁都指向 /llms.txt，文件頁另外指向
 * 同路徑加 .md 的 Markdown 孿生檔（web/build/llms-docs.ts 產出的那些）。
 */
const twinLinks = () => [...document.head.querySelectorAll('link[rel="alternate"][type="text/markdown"]')].map(l => l.getAttribute('href'));

describe('llms.txt discovery from the HTML head', () => {
  it('the shell links to /llms.txt on every page', () => {
    expect(shell).toMatch(/<link rel="alternate" type="text\/plain" title="llms\.txt" href="\/llms\.txt" \/>/);
  });

  it('every documentation page has a Markdown twin in every locale that the build actually emits', () => {
    for (const page of MARKDOWN_TWIN_PAGES) {
      for (const prefix of ['', 'zh-Hans/', 'en/', 'ja/', 'ko/']) expect(LLMS_DOC_PATHS, `${prefix}${page}.md`).toContain(`${prefix}${page}.md`);
    }
  });
});

describe('updateMarkdownTwin', () => {
  beforeEach(() => document.head.querySelectorAll('link[rel="alternate"][type="text/markdown"]').forEach(l => l.remove()));

  it('points a documentation page at its Markdown twin, following the locale prefix rule', () => {
    updateMarkdownTwin('/guide', 'en');
    expect(twinLinks()).toEqual([`${location.origin}/en/guide.md`]);
    updateMarkdownTwin('/developers', 'zh-Hant');
    expect(twinLinks()).toEqual([`${location.origin}/developers.md`]);
  });

  it('removes the twin when navigating to a page that has none', () => {
    updateMarkdownTwin('/guide', 'ja');
    updateMarkdownTwin('/', 'ja');
    expect(twinLinks()).toEqual([]);
    updateMarkdownTwin('/cards/abc', 'en');
    expect(twinLinks()).toEqual([]);
  });
});
