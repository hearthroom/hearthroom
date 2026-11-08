import { afterEach, expect, it } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import RegexRulesEditor from '../src/components/editor/RegexRulesEditor.vue';
import { i18n } from '../src/lib/i18n';
import { emptyRuleSet, type RegexRuleSet } from '../src/lib/regex-rules';

let app: App;
let root: HTMLElement;
const oldLocale = i18n.global.locale.value;
afterEach(() => { app?.unmount(); root?.remove(); i18n.global.locale.value = oldLocale; });

it('legacy targets display all checked; selection survives save and empty targets remain saveable', async () => {
  const value = emptyRuleSet();
  value.rules.push({ id: 'legacy', name: 'test', find: 'x', replace: 'y', enabled: true });
  let saved: RegexRuleSet | undefined;
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(RegexRulesEditor, { modelValue: value, 'onUpdate:modelValue': (v: RegexRuleSet) => { saved = v; } }) }).use(i18n);
  app.mount(root);
  const targets = [...root.querySelectorAll<HTMLInputElement>('[data-rule-target]')];
  expect(targets).toHaveLength(3);
  expect(targets.every(t => t.checked)).toBe(true);
  for (const target of targets) { target.checked = false; target.dispatchEvent(new Event('change', { bubbles: true })); await nextTick(); }
  expect(root.querySelector('[data-target-warning]')?.textContent).toContain(i18n.global.t('regex.rule.targets.empty'));
  const done = root.querySelector<HTMLButtonElement>('.rx__head-acts .btn--primary')!;
  expect(done.disabled).toBe(false);
  done.click();
  expect(saved?.rules[0].targets).toEqual([]);
  expect(value.rules[0].targets).toBeUndefined();
});
