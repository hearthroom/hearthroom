// 主頁數據與作者列表的人數寫法（任務 2026-11-26-profile-stat-numbers ui.md）：
// 未滿一萬寫全數；一萬以上縮寫、一律一位小數、截位不進位（19,999 不能寫成「2萬」，比實際多）；
// 本人看自己的主頁 99,999 以內寫全數。
import { afterEach, expect, it } from 'vitest';
import { i18n } from '../src/lib/i18n';
import { statCount } from '../src/lib/format';

afterEach(() => { i18n.global.locale.value = 'zh-Hant'; });

const table: [number, Record<string, string>][] = [
  [10_000, { 'zh-Hant': '1.0萬', 'zh-Hans': '1.0万', ja: '1.0万', ko: '1.0만', en: '10.0K' }],
  [12_345, { 'zh-Hant': '1.2萬', 'zh-Hans': '1.2万', ja: '1.2万', ko: '1.2만', en: '12.3K' }],
  [19_999, { 'zh-Hant': '1.9萬', 'zh-Hans': '1.9万', ja: '1.9万', ko: '1.9만', en: '19.9K' }],
  [99_999, { 'zh-Hant': '9.9萬', 'zh-Hans': '9.9万', ja: '9.9万', ko: '9.9만', en: '99.9K' }],
  [123_456, { 'zh-Hant': '12.3萬', 'zh-Hans': '12.3万', ja: '12.3万', ko: '12.3만', en: '123.4K' }],
  [999_999, { 'zh-Hant': '99.9萬', 'zh-Hans': '99.9万', ja: '99.9万', ko: '99.9만', en: '999.9K' }],
  [1_234_567, { 'zh-Hant': '123.4萬', 'zh-Hans': '123.4万', ja: '123.4万', ko: '123.4만', en: '1.2M' }],
  [12_345_678, { 'zh-Hant': '1234.5萬', 'zh-Hans': '1234.5万', ja: '1234.5万', ko: '1234.5만', en: '12.3M' }],
  [123_456_789, { 'zh-Hant': '1.2億', 'zh-Hans': '1.2亿', ja: '1.2億', ko: '1.2억', en: '123.4M' }],
];

it.each(['zh-Hant', 'zh-Hans', 'ja', 'ko', 'en'])('%s：一萬以上縮寫一位小數、截位不進位', (locale) => {
  i18n.global.locale.value = locale as never;
  for (const [n, want] of table) expect(statCount(n), `${locale} ${n}`).toBe(want[locale]);
});

it('未滿一萬寫全數（千分位）', () => {
  expect(statCount(0)).toBe('0');
  expect(statCount(3_420)).toBe('3,420');
  expect(statCount(9_999)).toBe('9,999');
});

it('本人看自己：99,999 以內寫全數，之後同他人', () => {
  expect(statCount(12_345, { own: true })).toBe('12,345');
  expect(statCount(99_999, { own: true })).toBe('99,999');
  expect(statCount(100_000, { own: true })).toBe('10.0萬');
  expect(statCount(123_456, { own: true })).toBe('12.3萬');
});
