import { describe, expect, it } from 'vitest';
import { coverHonors, fitWorn, honorKey, parseHonorKey, periodLabel as label, sortHonors, timesLabel, type Honor } from '../src/lib/honors';

const h = (zone: Honor['zone'], window: Honor['window'], band: Honor['band']): Honor => ({ zone, window, band });

describe('honor keys', () => {
  it('reads every board honor key and nothing else', () => {
    expect(parseHonorKey('rank_clean_day_1')).toEqual(h('clean', 'day', 1));
    expect(parseHonorKey('rank_all_month_10')).toEqual(h('all', 'month', 10));
    for (const key of ['rank_clean_day_2', 'rank_mixed_day_1', 'rank_all_year_1', 'creator_featured', 'rank_clean_day_1_x']) expect(parseHonorKey(key)).toBeNull();
  });
  it('writes the same key it reads', () => {
    expect(honorKey(h('all', 'week', 3))).toBe('rank_all_week_3');
    expect(parseHonorKey(honorKey(h('clean', 'month', 10)))).toEqual(h('clean', 'month', 10));
  });
});

describe('cover honors', () => {
  it('keeps the best band per period, ordered day, week, month', () => {
    const list = [h('all', 'month', 10), h('clean', 'day', 3), h('clean', 'day', 1), h('all', 'week', 3), h('clean', 'week', 10)];
    expect(coverHonors(list)).toEqual([h('clean', 'day', 1), h('all', 'week', 3), h('all', 'month', 10)]);
  });
  it('prefers the clean board when both boards gave the same band', () => {
    expect(coverHonors([h('all', 'day', 1), h('clean', 'day', 1)])).toEqual([h('clean', 'day', 1)]);
  });
  it('shows nothing for a card without honors and keeps only the badge fields', () => {
    expect(coverHonors([])).toEqual([]);
    expect(coverHonors([{ ...h('all', 'week', 1), period: '2026-11-02', at: 5 } as Honor])).toEqual([h('all', 'week', 1)]);
  });
});

describe('badge page order', () => {
  it('lists clean before overall, then day, week, month, then first, top three, top ten', () => {
    const sorted = sortHonors([h('all', 'day', 1), h('clean', 'month', 1), h('clean', 'day', 10), h('clean', 'day', 1)]);
    expect(sorted.map(honorKey)).toEqual(['rank_clean_day_1', 'rank_clean_day_10', 'rank_clean_month_1', 'rank_all_day_1']);
  });
});

describe('times label', () => {
  it('only counts repeats and caps at 99+', () => {
    expect(timesLabel(undefined)).toBe('');
    expect(timesLabel(1)).toBe('');
    expect(timesLabel(2)).toBe('×2');
    expect(timesLabel(99)).toBe('×99');
    expect(timesLabel(100)).toBe('×99+');
  });
});

describe('worn row fitting', () => {
  const plus = () => 30;
  it('shows everything when the row has room', () => {
    expect(fitWorn([60, 60, 60], 200, 8, plus)).toBe(3);
  });
  it('hides from the end until the shown labels and the +N chip fit on one row', () => {
    // 60+8+60 = 128, +8+30 = 166 ≤ 170; a third label would need 60+8 more
    expect(fitWorn([60, 60, 60, 60, 60], 170, 8, plus)).toBe(2);
  });
  it('always keeps one label even when nothing fits', () => {
    expect(fitWorn([300, 60], 100, 8, plus)).toBe(1);
  });
  it('does not reserve room for +N when the last label fits exactly', () => {
    expect(fitWorn([60, 60], 128, 8, plus)).toBe(2);
  });
  it('returns zero for an empty row', () => {
    expect(fitWorn([], 100, 8, plus)).toBe(0);
  });
});

describe('period label', () => {
  // Intl 在區間兩側用窄空白（U+2009），比對時換成一般空白
  const periodLabel = (...a: Parameters<typeof label>) => label(...a).replace(/\s/g, ' ');
  it('names the day, the Monday-to-Sunday week, or the month the honor belongs to', () => {
    expect(periodLabel('day', '2026-11-03', 'en')).toBe('Nov 3');
    expect(periodLabel('week', '2026-11-02', 'en')).toBe('Nov 2 – 8');
    expect(periodLabel('week', '2026-10-26', 'en')).toBe('Oct 26 – Nov 1');
    expect(periodLabel('month', '2026-11-01', 'en')).toBe('November 2026');
    expect(periodLabel('day', '2026-11-03', 'zh-Hant')).toBe('11月3日');
  });
  it('falls back to the raw text for a malformed period', () => {
    expect(periodLabel('day', 'soon', 'en')).toBe('soon');
  });
});
