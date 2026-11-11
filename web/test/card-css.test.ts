import { describe, expect, it } from 'vitest';
import { ruleSetFromAuthorAsset, ruleSetToAuthorAsset } from '../src/lib/regex-rules';
import { fengyueToDraft } from '../src/lib/fengyue';

const legacy = { id: 'hearthroom-fengyue-inner-css', name: 'CSS', find: '/([\\s\\S])$/', replace: '$1<style>#ai-chat-input{color:red}</style>', enabled: true, cssDialect: 'fengyue' };

describe('card styles are separate from message replacement', () => {
  it('preserves the card-only version through save/export/reimport without accepting it on a display rule', async () => {
    const { ruleSetFromImport, ruleSetToExport, cssDialectFrom } = await import('../src/lib/regex-rules');
    const css = '\uFEFF\r\n#ai-chat-input { border-width: 1px }\r\n';
    const set = ruleSetFromAuthorAsset({ rules: [], cardCss: css, cardCssDialect: 'fengyue-v2' });
    expect(ruleSetToAuthorAsset(set, 2)).toMatchObject({ cardCss: css, cardCssDialect: 'fengyue-v2' });
    expect(ruleSetFromImport(ruleSetToExport(set, ''))?.set).toMatchObject({ cardCss: css, cardCssDialect: 'fengyue-v2' });
    expect(cssDialectFrom('fengyue-v2')).toBeUndefined();
  });
  it('imports Fengyue built-in CSS into the card field without a fake replacement rule', () => {
    const result = fengyueToDraft({ title: 'T', pre_prompt: 'p', ai_variable_prompt: 'v', description: 'd', builtInCss: '#ai-chat-input{color:red}' } as any, { language: 'zh-Hant' });
    expect(result.regex).toMatchObject({ cardCss: '#ai-chat-input{color:red}', cardCssDialect: 'fengyue-v2' });
    expect(result.regex?.rules.some(r => r.id === legacy.id)).toBe(false);
  });

  it('moves only the known enabled legacy carrier to the card field and preserves its hint', () => {
    const set = ruleSetFromAuthorAsset({ rules: [legacy, { id: 'ordinary', find: 'x', replace: 'y', enabled: true }] });
    expect(set).toMatchObject({ cardCss: '#ai-chat-input{color:red}', cardCssDialect: 'fengyue' });
    expect(set.rules.map(r => r.id)).toEqual(['ordinary']);
    expect(ruleSetToAuthorAsset(set, 4)).toMatchObject({ cardCss: '#ai-chat-input{color:red}', cardCssDialect: 'fengyue', version: 4 });
  });

  it('does not enable disabled legacy CSS or consume an edited carrier with extra markup', () => {
    for (const rule of [{ ...legacy, enabled: false }, { ...legacy, replace: legacy.replace + '<p>keep</p>' }]) {
      const set = ruleSetFromAuthorAsset({ rules: [rule] });
      expect(set.rules).toHaveLength(1);
      expect('cardCss' in set).toBe(false);
    }
  });
  it('preserves the original rule order when another enabled style or script may depend on it', () => {
    for (const replace of ['<style>#ai-chat-input{color:blue}</style>', '<script>window.theme=1</script>']) {
      const peer = { id: 'peer', find: 'x', replace, enabled: true, cssDialect: 'fengyue' };
      const set = ruleSetFromAuthorAsset({ rules: [peer, legacy] });
      expect(set.rules.map(r => r.id)).toEqual(['peer', legacy.id]);
      expect('cardCss' in ruleSetToAuthorAsset(set, 2)).toBe(false);
    }
  });

  it('honors an explicit empty field over the legacy rule; a missing field stays omitted on save', () => {
    const cleared = ruleSetFromAuthorAsset({ rules: [legacy], cardCss: '' } as any);
    expect(cleared.rules).toHaveLength(0);
    expect(ruleSetToAuthorAsset(cleared, 1)).toMatchObject({ cardCss: '', cardCssDialect: '' });
    const old = ruleSetToAuthorAsset(ruleSetFromAuthorAsset({ rules: [] }), 1);
    expect('cardCss' in old).toBe(false);
    expect('cardCssDialect' in old).toBe(false);
  });

  it('preserves source bytes and hidden compatibility metadata through round trip', () => {
    const css = '\n/* custom */\n.mes { color: red !important; }\n';
    const out = ruleSetToAuthorAsset(ruleSetFromAuthorAsset({ rules: [], cardCss: css, cardCssDialect: 'mmd' } as any), 2);
    expect(out).toMatchObject({ cardCss: css, cardCssDialect: 'mmd' });
  });
  it('exports and reimports a card stylesheet without requiring any display rules', async () => {
    const { ruleSetFromImport, ruleSetToExport } = await import('../src/lib/regex-rules');
    const set = ruleSetFromAuthorAsset({ rules: [], cardCss: '.x{color:red}', cardCssDialect: 'fengyue' } as any);
    expect(ruleSetFromImport(ruleSetToExport(set, ''))?.set).toMatchObject({ cardCss: '.x{color:red}', cardCssDialect: 'fengyue', rules: [] });
  });
  it('checks the independent UTF-8 stylesheet budget before saving', async () => {
    const { validateRuleSet } = await import('../src/lib/regex-rules');
    const set = ruleSetFromAuthorAsset({ rules: [], cardCss: '界'.repeat(Math.floor(512 * 1024 / 3) + 1) } as any);
    expect(validateRuleSet(set)).toContainEqual(expect.objectContaining({ key: 'editor.cardCss.tooLong' }));
  });
});
