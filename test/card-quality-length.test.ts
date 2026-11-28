import { describe, expect, it } from 'vitest';
import { cardQualityLength, roundQualityCharacters } from '../shared/card-quality-length';

describe('public card length', () => {
  it('counts eligible text once across fields and groups split entries by book', () => {
    const shared = '共同'.repeat(600);
    const result = cardQualityLength({
      document: {
        roleDetailDesc: shared,
        customInstructions: '**甲**'.repeat(1100),
        jailbreak: 'legacy alias ignored'.repeat(2000),
        roleOutputContract: '乙'.repeat(1000),
        talkExample: JSON.stringify([{ roleType: 'ai', content: '<b>丙</b>'.repeat(1400) }, { roleType: 'user', content: shared }]),
        roleReadme: 'public introduction ignored'.repeat(1000),
      },
      greetings: { welcome: '丁'.repeat(2200), alternates: [shared, '🙂'], prologue: ['戊'.repeat(1500)] },
      worldbooks: [
        { entries: [
          { content: '己'.repeat(600), matchOptions: { groupId: 'a' } },
          { content: '庚'.repeat(1700), matchOptions: { groupId: 'a' } },
          { content: shared },
          { content: 'ignored'.repeat(2000), isEnabled: false },
          { content: ' ' },
        ] },
        { entries: [{ content: '辛'.repeat(1000), matchOptions: { groupId: 'a' } }] },
        { isActive: false, entries: [{ content: 'inactive'.repeat(1000) }] },
      ],
      authorAsset: {
        openingPage: '<body>excluded</body>'.repeat(10000),
        cardCss: 'excluded'.repeat(10000),
        rules: [{ replace: 'excluded'.repeat(10000) }, { enabled: false }],
        mountTrigger: 'manual',
      },
    });
    expect(result).toEqual({
      total: 12_000,
      setting: 5_000,
      worldbook: { entries: 3, characters: 3_000 },
      openings: { count: 3, characters: 4_000 },
      presentation: { openingPage: true, displayRules: 2, panel: true },
    });
  });

  it('preserves the difference between an empty field and a short field', () => {
    expect(cardQualityLength({ greetings: { welcome: '你好' }, authorAsset: { openingPageBytes: 640_000 } })).toEqual({
      total: 0,
      setting: null,
      worldbook: { entries: 0, characters: 0 },
      openings: { count: 1, characters: 0 },
      presentation: { openingPage: true, displayRules: 0, panel: false },
    });
  });

  it.each([[0, 0], [999, 0], [1000, 1000], [3699, 4000], [9999, 10000], [12_349, 12_000], [99_999, 100_000], [104_999, 100_000], [1_104_999, 1_100_000]])(
    'rounds %i characters to %i', (input, output) => expect(roundQualityCharacters(input)).toBe(output),
  );
});
