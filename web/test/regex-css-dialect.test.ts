import { afterEach, expect, it } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import RegexRulesEditor from '../src/components/editor/RegexRulesEditor.vue';
import { i18n } from '../src/lib/i18n';
import { emptyRuleSet, ruleSetFromAuthorAsset, ruleSetToAuthorAsset, type RegexRuleSet } from '../src/lib/regex-rules';
import { fengyueToDraft } from '../src/lib/fengyue';

let app: App | undefined;
let root: HTMLElement | undefined;
afterEach(() => { app?.unmount(); root?.remove(); app = undefined; root = undefined; });

// 規則裡 <style> 的寫法（cssDialect）：讀進來、存回去都要原樣；沒填的不憑空長出來。
it('cssDialect survives the author asset round trip; a rule without it stays without', () => {
  const set = ruleSetFromAuthorAsset({ rules: [
    { id: 'fy', name: 'a', find: 'x', replace: '<style>#ai-chat-input{color:red}</style>', enabled: true, cssDialect: 'fengyue' },
    { id: 'plain', name: 'b', find: 'y', replace: 'z', enabled: true },
    { id: 'junk', name: 'c', find: 'w', replace: 'v', enabled: true, cssDialect: 'nonsense' },
  ] });
  expect(set.rules.map((r) => r.cssDialect)).toEqual(['fengyue', undefined, undefined]);
  const out = ruleSetToAuthorAsset(set, 1).rules;
  expect(out[0]).toMatchObject({ cssDialect: 'fengyue' });
  expect('cssDialect' in out[1]).toBe(false);
  expect('cssDialect' in out[2]).toBe(false);
});

it('the Fengyue importer preserves the hidden compatibility hint on card CSS', () => {
  const result = fengyueToDraft({ title: 'T', pre_prompt: 'p', ai_variable_prompt: 'v', description: 'd', builtInCss: '#ai-chat-input{color:red}' } as any, { language: 'zh-Hant' });
  expect(result.regex?.cardCssDialect).toBe('fengyue-v2');
  expect(result.regex?.cardCss).toContain('#ai-chat-input');
});

it('the editor hides CSS source choices and preserves legacy metadata when saved', async () => {
  const value = emptyRuleSet();
  value.rules.push({ id: 'styled', name: 'styled', find: 'x', replace: '$1<style>#ai-chat-input{color:red}</style>', enabled: true, cssDialect: 'fengyue' });
  let saved: RegexRuleSet | undefined;
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(RegexRulesEditor, { modelValue: value, 'onUpdate:modelValue': (v: RegexRuleSet) => { saved = v; } }) }).use(i18n);
  app.mount(root);
  await nextTick();
  expect(root.querySelector('[data-rule-dialect]')).toBeNull();
  root.querySelector<HTMLButtonElement>('.rx__head-acts .btn--primary')!.click();
  expect(saved?.rules[0].cssDialect).toBe('fengyue');
});

it('legacy ordinary rules retain their CSS hint through export and re-import', async () => {
  const { rulesToTavern, rulesFromTavern } = await import('../src/lib/regex-rules');
  const set = ruleSetFromAuthorAsset({ rules: [{ id: 'ordinary', name: 'css', find: '/([\\s\\S])$/', replace: '$1<style>#ai-chat-input{color:red}</style>', enabled: true, cssDialect: 'fengyue' }] });
  const back = rulesFromTavern(rulesToTavern(set.rules));
  expect(back[0].cssDialect).toBe('fengyue');
});
