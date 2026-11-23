import { describe, expect, it } from 'vitest';
import { diffSettings, lineDelta, summarizeOnly } from '../src/review-diff';

type Entry = { name: string; content: string; keywords?: string[]; isEnabled?: boolean; isConstant?: boolean };
const entry = (e: Entry, i = 0) => ({
  entryId: String(i), name: e.name, content: e.content, keywords: e.keywords ?? [], secondaryKeywords: [],
  category: '', isEnabled: e.isEnabled ?? true, isConstant: e.isConstant ?? false, triggerRegion: '',
});
const rule = (id: string, name: string, find: string, replace = '') => ({ id, name, find, replace, enabled: true });

function settings(over: {
  document?: Record<string, unknown>; greetings?: Record<string, unknown>; entries?: Entry[]; bookId?: string;
  rules?: unknown[]; asset?: Record<string, unknown>;
} = {}) {
  return {
    document: {
      roleName: '綺夢', userName: '旅人', roleDesc: '一句簡介', roleAvatar: 'https://cdn.test/a1.png', roleBackground: 'https://cdn.test/b1.png',
      roleDetailDesc: '第一段設定\n第二段設定', roleTag: '["奇幻","日常"]', roleType: 'single', roleSex: 'female', roleSpeech: '""',
      language: 'zh-Hant', customInstructions: '', talkExample: '[]', roleOutputContract: '',
      ...over.document,
    },
    greetings: { welcome: '歡迎光臨', alternates: [], prologue: [], ...over.greetings },
    worldbooks: [{ worldbookId: over.bookId ?? 'wb-1', name: '書', description: '', format: '', entries: (over.entries ?? baseEntries).map(entry) }],
    authorAsset: { rules: over.rules ?? [], mountTrigger: '', mountLayer: '', pageMode: 'classic', status: 'approved', version: 3, ...over.asset },
    hashes: { card: '', welcome: '', worldbook: '', authorAsset: '', content: '' },
  };
}
const baseEntries: Entry[] = [
  { name: '城鎮', content: '港口城鎮，霧很重。', keywords: ['港口'] },
  { name: '酒館', content: '老闆娘是退休的冒險者。', keywords: ['酒館'] },
  { name: '神殿', content: '供奉月之女神。', keywords: ['神殿'] },
];

describe('diffSettings', () => {
  it('reports identical settings as unchanged', () => {
    const d = diffSettings(settings(), settings());
    expect(d.summary.unchanged).toBe(true);
    expect(d.fields).toEqual([]);
    expect(d.summary.changedFields).toEqual([]);
    expect(d.summary.totalChanged).toBe(0);
  });

  it('ignores re-seal noise: worldbook ids, media URLs, asset version and status', () => {
    const resealed = settings({
      bookId: 'wb-999',
      document: { roleAvatar: 'https://cdn.test/a2.png', roleBackground: 'https://cdn.test/b2.png', roleBackgroundLandscape: 'https://cdn.test/l.png', roleShareImage: 'https://cdn.test/s.png' },
      asset: { status: 'pending', version: 9 },
    });
    const d = diffSettings(settings(), resealed);
    expect(d.summary.unchanged).toBe(true);
    expect(d.fields).toEqual([]);
  });

  it('treats an entry inserted at the top as one addition, not a cascade of modifications', () => {
    const d = diffSettings(settings(), settings({ entries: [{ name: '序章', content: '一切從這裡開始。' }, ...baseEntries] }));
    expect(d.summary.worldbook).toEqual({ added: 1, removed: 0, modified: 0 });
    expect(d.worldbook.added.map((e) => e.name)).toEqual(['序章']);
    expect(d.summary.unchanged).toBe(false);
  });

  it('matches entries across books regardless of which book holds them', () => {
    const base = settings();
    const split = { ...settings(), worldbooks: [
      { ...base.worldbooks[0]!, worldbookId: 'x', entries: base.worldbooks[0]!.entries.slice(0, 1) },
      { ...base.worldbooks[0]!, worldbookId: 'y', entries: base.worldbooks[0]!.entries.slice(1) },
    ] };
    expect(diffSettings(base, split).summary.unchanged).toBe(true);
  });

  it('pairs an edited entry by name as modified', () => {
    const edited = baseEntries.map((e) => (e.name === '酒館' ? { ...e, content: '老闆娘是退休的冒險者。\n她左手有舊傷。' } : e));
    const d = diffSettings(settings(), settings({ entries: edited }));
    expect(d.summary.worldbook).toEqual({ added: 0, removed: 0, modified: 1 });
    expect(d.worldbook.modified[0]!.before.content).toBe('老闆娘是退休的冒險者。');
    expect(d.worldbook.modified[0]!.after.content).toContain('舊傷');
    expect(d.summary.totalChanged).toBe(6); // 她左手有舊傷
  });

  it('pairs a renamed entry with identical content as modified', () => {
    const renamed = baseEntries.map((e) => (e.name === '神殿' ? { ...e, name: '月神殿' } : e));
    const d = diffSettings(settings(), settings({ entries: renamed }));
    expect(d.summary.worldbook).toEqual({ added: 0, removed: 0, modified: 1 });
    expect(d.worldbook.modified[0]!.after.name).toBe('月神殿');
  });

  it('counts an added or removed entry content toward totalChanged', () => {
    const d = summarizeOnly(settings(), settings({ entries: baseEntries.slice(0, 2) }));
    expect(d.worldbook).toEqual({ added: 0, removed: 1, modified: 0 });
    expect(d.totalChanged).toBe(6); // 供奉月之女神
  });

  it('counts appended setting text with effective characters', () => {
    const d = diffSettings(settings(), settings({ document: { roleDetailDesc: '第一段設定\n第二段設定\n**第三段** 加了 ABC！' } }));
    expect(d.summary.changedFields).toEqual(['setting']);
    expect(d.summary.setting).toEqual({ charsAdded: 8, charsRemoved: 0 }); // 第三段加了ABC
    expect(d.fields).toEqual([{ key: 'setting', before: '第一段設定\n第二段設定', after: '第一段設定\n第二段設定\n**第三段** 加了 ABC！' }]);
  });

  it('flags an opening change with effective character counts on both sides', () => {
    const d = diffSettings(settings(), settings({ greetings: { welcome: '歡迎回來，旅人。' } }));
    expect(d.summary.opening).toEqual({ changed: true, charsBefore: 4, charsAfter: 6 });
    expect(d.summary.changedFields).toEqual(['opening']);
    expect(diffSettings(settings(), settings()).summary.opening.changed).toBe(false);
  });

  it('compares tags as sets, accepting JSON strings, arrays and plain strings', () => {
    const d = diffSettings(settings(), settings({ document: { roleTag: ['日常', '懸疑', '校園'] } }));
    expect(d.summary.tags).toEqual({ added: 2, removed: 1 });
    expect(d.summary.changedFields).toEqual(['tags']);
    expect(diffSettings(settings(), settings({ document: { roleTag: '["日常","奇幻"]' } })).summary.unchanged).toBe(true);
    expect(diffSettings(settings(), settings({ document: { roleTag: '奇幻,日常' } })).summary.unchanged).toBe(true);
  });

  it('counts rules added, removed and modified', () => {
    const base = [rule('r1', '去除旁白', '\\(.*?\\)'), rule('r2', '粗體', '\\*\\*(.+?)\\*\\*', '<b>$1</b>'), rule('r3', '刪除', 'x')];
    const cur = [
      { enabled: true, replace: '', find: '\\(.*?\\)', name: '去除旁白', id: 'r1' }, // same rule, different key order
      rule('r2', '粗體', '\\*\\*(.+?)\\*\\*', '<strong>$1</strong>'),
      rule('r4', '', 'y'.repeat(100)),
    ];
    const d = diffSettings(settings({ rules: base }), settings({ rules: cur }));
    expect(d.summary.rules).toEqual({ added: 1, removed: 1, modified: 1 });
    expect(d.rules.items).toEqual([
      { change: 'modified', label: '粗體' },
      { change: 'added', label: 'y'.repeat(80) },
      { change: 'removed', label: '刪除' },
    ]);
  });

  it('joins alternates and prologue for comparison', () => {
    const d = diffSettings(settings({ greetings: { alternates: ['甲'] } }), settings({ greetings: { alternates: ['甲', '乙'], prologue: ['序'] } }));
    expect(d.summary.changedFields).toEqual(['alternates', 'prologue']);
    expect(d.fields[0]).toEqual({ key: 'alternates', before: '甲', after: '甲\n\n---\n\n乙' });
  });

  it('keeps changedFields in the declared order', () => {
    const d = diffSettings(settings(), settings({ document: { language: 'en', roleName: '新名', customInstructions: '指示' }, greetings: { welcome: '嗨' } }));
    expect(d.summary.changedFields).toEqual(['name', 'instructions', 'language', 'opening']);
  });

  it('does not report unchanged when only markup changes and no characters count', () => {
    const d = diffSettings(settings(), settings({ document: { roleDetailDesc: '第一段設定\n第二段設定\n<hr>' } }));
    expect(d.summary.unchanged).toBe(false);
    expect(d.summary.changedFields).toEqual(['setting']);
  });

  it('reports author asset presentation changes outside the rules', () => {
    const d = diffSettings(settings(), settings({ asset: { openingPage: '<div>新的開場網頁</div>' } }));
    expect(d.summary.unchanged).toBe(false);
    expect(d.summary.changedFields).toEqual(['asset.openingPage']);
  });

  it('summarizeOnly returns the same numbers as diffSettings', () => {
    const a = settings({ rules: [rule('r1', 'a', 'b')] });
    const b = settings({
      document: { roleDetailDesc: '改寫的設定', roleTag: '["奇幻"]' }, greetings: { welcome: '新開場' },
      entries: [{ name: '新', content: '新條目' }, ...baseEntries.slice(1)], rules: [rule('r1', 'a', 'c')],
    });
    expect(summarizeOnly(a, b)).toEqual(diffSettings(a, b).summary);
  });
});

describe('lineDelta', () => {
  it('falls back to whole-middle replacement beyond 2000 lines', () => {
    const big = Array.from({ length: 2500 }, (_, i) => `行${i}`);
    const changed = [...big];
    changed[1000] = '改';
    changed[2000] = '動';
    const d = lineDelta(big.join('\n'), changed.join('\n'));
    // prefix/suffix trimmed first; the 1001-line middle is still under the cap, so LCS keeps it exact
    expect(d).toEqual({ added: 2, removed: 10 });
    const huge = Array.from({ length: 5000 }, (_, i) => `x${i}`);
    const shifted = ['A', ...huge.slice(0, 2500), 'B', ...huge.slice(2500), 'C'];
    expect(lineDelta(huge.join('\n'), shifted.join('\n')).added).toBeGreaterThan(0);
  });
});
