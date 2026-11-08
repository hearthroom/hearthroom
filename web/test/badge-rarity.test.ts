import { it, expect } from 'vitest';
import { badgeRarity } from '../src/lib/badge-rarity';

it('ranks honors by window and placement', () => {
  const r = (key: string) => badgeRarity({ key, category: 'rank' });
  expect(r('rank_clean_month_1')).toBe('legendary');
  expect(r('rank_all_month_1')).toBe('legendary');
  expect(r('rank_all_week_1')).toBe('epic');
  expect(r('rank_clean_month_3')).toBe('epic');
  expect(r('rank_clean_day_1')).toBe('rare');
  expect(r('rank_all_day_10')).toBe('rare');
});

it('maps tiered milestones and falls back by category', () => {
  expect(badgeRarity({ key: 'invite_3', category: 'invite' })).toBe('common');
  expect(badgeRarity({ key: 'invite_100', category: 'invite' })).toBe('legendary');
  expect(badgeRarity({ key: 'spend_3', category: 'spend' })).toBe('epic');
  expect(badgeRarity({ key: 'first_work', category: 'creation' })).toBe('common');
  expect(badgeRarity({ key: 'event_summer', category: 'event' })).toBe('epic');
  expect(badgeRarity({ key: 'something_new', category: 'play' })).toBe('common');
});
