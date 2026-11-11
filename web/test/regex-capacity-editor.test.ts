import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import RegexRulesEditor from '../src/components/editor/RegexRulesEditor.vue';
import { i18n } from '../src/lib/i18n';
import { emptyRuleSet, makeRule, validateRuleSet, type RegexRuleSet } from '../src/lib/regex-rules';

let app: App | undefined;
let root: HTMLElement;
afterEach(() => { app?.unmount(); app = undefined; root?.remove(); vi.restoreAllMocks(); });

function mount(n: number, configure?: (value: RegexRuleSet) => void) {
  const value = emptyRuleSet();
  value.rules = Array.from({ length: n }, (_, i) => makeRule({ id: `r${i}`, name: `Rule ${i}`, find: `token${i}`, replace: `payload${i}` }));
  configure?.(value);
  let saved: RegexRuleSet | undefined;
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(RegexRulesEditor, { modelValue: value, 'onUpdate:modelValue': (v: RegexRuleSet) => { saved = v; } }) }).use(i18n);
  app.mount(root);
  return { value, saved: () => saved, done: () => root.querySelector<HTMLButtonElement>('.rx__head-acts .btn--primary')! };
}

it('999 → 1000 stays saveable, blocks adding another, and preserves the last rule', async () => {
  const editor = mount(999);
  const add = root.querySelector<HTMLButtonElement>('.rx__list > button')!;
  add.click(); await nextTick();
  const find = root.querySelector<HTMLInputElement>('#rx-find')!;
  find.value = 'last-token'; find.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
  expect(add.disabled).toBe(true);
  expect(editor.done().disabled).toBe(false);
  editor.done().click();
  expect(editor.saved()?.rules).toHaveLength(1000);
  expect(editor.saved()?.rules[999].find).toBe('last-token');
  expect(validateRuleSet(editor.saved()!)).toEqual([]);
  expect(editor.value.rules).toHaveLength(999);
});

it('1001 remains visible and cannot be completed', () => {
  const editor = mount(1001);
  expect(editor.done().disabled).toBe(true);
  expect(root.querySelector('[role=alert]')?.textContent).toContain('1000');
});

it('renaming one rule does not re-encode the other 999 replacement payloads', async () => {
  mount(1000);
  const encode = vi.spyOn(TextEncoder.prototype, 'encode');
  const name = root.querySelector<HTMLInputElement>('#rx-name')!;
  name.value = 'renamed'; name.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
  expect(root.querySelector('.rx__rule-title')?.textContent).toBe('renamed');
  expect(encode.mock.calls.filter(([s]) => typeof s === 'string' && /^payload[1-9]/.test(s))).toHaveLength(0);
});

it('cached validation follows replacement, find and statusbar edits immediately', async () => {
  const editor = mount(2);
  async function input(id: string, value: string) {
    const control = root.querySelector<HTMLInputElement>(id)!;
    control.value = value; control.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
  }
  await input('#rx-replace', 'x'.repeat(512 * 1024 + 1));
  expect(editor.done().disabled).toBe(true);
  expect(root.querySelector('.rx__rule--bad')).not.toBeNull();
  expect(root.querySelector('.rx__head')?.textContent).toContain('0.5');
  await input('#rx-replace', 'small');
  expect(editor.done().disabled).toBe(false);
  await input('#rx-find', '/[/g');
  expect(editor.done().disabled).toBe(true);
  await input('#rx-find', 'valid');
  await input('#rx-statusbar', 'x'.repeat(4001));
  expect(editor.done().disabled).toBe(true);
  await input('#rx-statusbar', 'valid');
  expect(editor.done().disabled).toBe(false);
  editor.done().click();
  expect(validateRuleSet(editor.saved()!)).toEqual([]);
});

it('filtered reorder refreshes movement boundaries and keeps selection on the same rule', async () => {
  mount(3);
  const search = root.querySelector<HTMLInputElement>('[type=search]')!;
  search.value = 'token0'; search.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
  const tools = () => [...root.querySelectorAll<HTMLButtonElement>('.rx__rule-tools button')];
  expect(tools()[0].disabled).toBe(true);
  tools()[1].click(); await nextTick();
  expect(tools()[0].disabled).toBe(false);
  expect(root.querySelector<HTMLInputElement>('#rx-find')?.value).toBe('token0');
  tools()[1].click(); await nextTick();
  expect(tools()[1].disabled).toBe(true);
});

it('an imported duplicate ID cannot hide an invalid rule behind a valid one', () => {
  const editor = mount(2, value => {
    value.rules[1].id = value.rules[0].id;
    value.rules[0].find = '/[/g';
  });
  expect(editor.done().disabled).toBe(true);
  expect(root.querySelector('.rx__rule--bad')).not.toBeNull();
});
