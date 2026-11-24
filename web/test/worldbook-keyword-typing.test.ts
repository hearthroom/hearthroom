// 世界書條目的關鍵字欄：用「、」分隔，玩家要打得出分隔號與空格，組字中的字不能被畫面蓋掉。
// 2026-11-24 玩家回報（新注音、電腦 Chrome）：按 Ctrl+'（新注音打「、」）打不出來、游標亂飄、未確認的字消失。
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import WorldbookEntriesDialog from '../src/components/editor/WorldbookEntriesDialog.vue';
import { i18n } from '../src/lib/i18n';
import type { WorldbookEntryDraft } from '../src/lib/role-draft';

let app: App | undefined;
let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); });

const entry = (name: string, keywords: string[]): WorldbookEntryDraft => ({ name, content: '', keywords, secondaryKeywords: [], isEnabled: true, isConstant: false });
async function mount(onClose = vi.fn()) {
  const entries = ref<WorldbookEntryDraft[]>([entry('甲', ['舊']), entry('乙', ['別的', '詞'])]);
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(WorldbookEntriesDialog, { modelValue: entries.value, language: 'zh-Hant', 'onUpdate:modelValue': (next: WorldbookEntryDraft[]) => { entries.value = next; }, onClose }) }).use(i18n);
  app.mount(root); await nextTick();
  document.querySelector<HTMLButtonElement>('.wbd__row-name')!.click(); await nextTick();
  return entries;
}
const field = (id: string) => document.querySelector<HTMLInputElement>(id)!;
async function type(el: HTMLInputElement, value: string, composing = false) {
  el.value = value;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing }));
  await nextTick();
}

it.each(['#wbd-kw', '#wbd-sk'])('%s：打到一半的分隔號與空格留在框裡，條目照樣存成分好的關鍵字', async (id) => {
  const entries = await mount();
  const key = id === '#wbd-kw' ? 'keywords' : 'secondaryKeywords';
  const el = field(id);
  el.focus();
  await type(el, '舊、');
  expect(el.value).toBe('舊、');
  expect(entries.value[0][key]).toEqual(['舊']);
  await type(el, '舊、新 ');
  expect(el.value).toBe('舊、新 ');
  await type(el, '舊、新 年');
  expect(el.value).toBe('舊、新 年');
  expect(entries.value[0][key]).toEqual(['舊', '新 年']);
});

it('組字中（新注音還沒選字）：框裡的字不被改寫', async () => {
  await mount();
  const el = field('#wbd-kw');
  el.focus();
  el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  await type(el, '舊、ㄒㄧㄣ', true);
  expect(el.value).toBe('舊、ㄒㄧㄣ');
  await type(el, '舊、新、', true);
  expect(el.value).toBe('舊、新、');
});

it('離開欄位或換一條條目：框裡顯示整理好的關鍵字', async () => {
  const entries = await mount();
  const el = field('#wbd-kw');
  el.focus();
  await type(el, '舊、 新、');
  el.dispatchEvent(new FocusEvent('blur'));
  el.blur();
  await nextTick();
  expect(entries.value[0].keywords).toEqual(['舊', '新']);
  expect(field('#wbd-kw').value).toBe('舊、新');
  document.querySelectorAll<HTMLButtonElement>('.wbd__row-name')[1].click(); await nextTick();
  expect(field('#wbd-kw').value).toBe('別的、詞');
});

it('組字中按 Esc 是在取消選字，不關掉條目視窗', async () => {
  const onClose = vi.fn();
  await mount(onClose);
  const el = field('#wbd-kw');
  el.focus();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
  await nextTick();
  expect(onClose).not.toHaveBeenCalled();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick();
  expect(onClose).toHaveBeenCalledOnce();
});
