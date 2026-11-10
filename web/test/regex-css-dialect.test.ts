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

it('the Fengyue importer marks its built-in CSS rule as Fengyue CSS', () => {
  const result = fengyueToDraft({ title: 'T', pre_prompt: 'p', ai_variable_prompt: 'v', description: 'd', builtInCss: '#ai-chat-input{color:red}' } as any, { language: 'zh-Hant' });
  const rule = result.regex?.rules.find((r) => r.replace.includes('#ai-chat-input'));
  expect(rule?.cssDialect).toBe('fengyue');
});

it('the editor shows the CSS dialect only for rules with styles, and saves the choice', async () => {
  const value = emptyRuleSet();
  value.rules.push({ id: 'plain', name: 'plain', find: 'x', replace: 'y', enabled: true });
  value.rules.push({ id: 'styled', name: 'styled', find: 'x', replace: '$1<style>#ai-chat-input{color:red}</style>', enabled: true });
  let saved: RegexRuleSet | undefined;
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(RegexRulesEditor, { modelValue: value, 'onUpdate:modelValue': (v: RegexRuleSet) => { saved = v; } }) }).use(i18n);
  app.mount(root);
  expect(root.querySelector('[data-rule-dialect]')).toBeNull(); // 第一條沒有樣式
  const names = [...root.querySelectorAll<HTMLButtonElement>('.rx__rule-name')];
  names[1].click(); await nextTick();
  const select = root.querySelector<HTMLSelectElement>('[data-rule-dialect]')!;
  expect(select).not.toBeNull();
  expect(select.value).toBe('');
  select.value = 'fengyue'; select.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
  expect(root.querySelector('.rx__dialect .subtle')?.textContent).toBe(i18n.global.t('regex.rule.dialect.fengyue.hint'));
  select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
  select.value = 'fengyue'; select.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
  root.querySelector<HTMLButtonElement>('.rx__head-acts .btn--primary')!.click();
  expect(saved?.rules[1].cssDialect).toBe('fengyue');
  expect('cssDialect' in (saved?.rules[0] ?? {})).toBe(false);
});
