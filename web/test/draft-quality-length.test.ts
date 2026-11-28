import { expect, it } from 'vitest';
import { draftQualityLength } from '../src/lib/draft-quality-length';
import type { WorldbookEntryDraft } from '../src/lib/role-draft';

const text = (n: number, ch = '字') => ch.repeat(n);
const entry = (content: string, isEnabled = true) => ({ name: '', content, keywords: [], secondaryKeywords: [], isEnabled, isConstant: false } as WorldbookEntryDraft);
const draft = (over: Record<string, unknown> = {}) => ({
  roleDetailDesc: text(1200), jailbreak: '', roleOutputContract: '', talkExample: [], roleWelcome: text(600, '開'),
  alternates: [], prologue: [], world: null, ...over,
}) as never;

it('counts the draft the way the public list will: enabled entries, repeated text once, rounded', () => {
  // 1,200 設定 + 600 開場 + 900 世界書（停用與重複的不算）= 2,700 → 取整 3,000
  const entries = [entry(text(900, '書')), entry(text(900, '書')), entry(text(5000, '停'), false)];
  expect(draftQualityLength(draft(), entries)).toBe(3000);
});

it('reports under 1,000 as zero, the same as the tile', () => {
  expect(draftQualityLength(draft({ roleDetailDesc: text(300), roleWelcome: '' }), [])).toBe(0);
});

it('counts world members the editor holds in draft.world', () => {
  // 1,200 設定 + 600 開場 + 成員資料 500 + 描述 1,700 = 4,000
  const world = { maxSpeakers: 2, strictness: 'balanced', characters: [{ id: '', name: '甲', avatar: '', sex: '', profile: text(500, '甲'), description: text(1700, '乙'), lorebookId: '' }] };
  expect(draftQualityLength(draft({ world }), [])).toBe(4000);
});
