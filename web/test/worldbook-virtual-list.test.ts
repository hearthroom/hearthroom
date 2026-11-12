import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import WorldbookEntriesDialog from '../src/components/editor/WorldbookEntriesDialog.vue';
import { i18n } from '../src/lib/i18n';
import type { WorldbookEntryDraft } from '../src/lib/role-draft';
let app: App | undefined;
let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(n = 4001) {
  const entries = ref<WorldbookEntryDraft[]>(Array.from({ length: n }, (_, i) => ({ name: `Entry ${i}`, content: `Content ${i}`, keywords: [`key${i}`], secondaryKeywords: [], isEnabled: true, isConstant: false })));
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(WorldbookEntriesDialog, { modelValue: entries.value, language: 'en', 'onUpdate:modelValue': (next: WorldbookEntryDraft[]) => { entries.value = next; } }) }).use(i18n);
  app.mount(root); return entries;
}
const rows = () => [...document.querySelectorAll<HTMLElement>('.wbd__row')];
const list = () => document.querySelector<HTMLElement>('.wbd__rows')!;
async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('.wbd__list input[type=search]')!;
  input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
}
it('bounds the DOM for 4001 entries and reaches the last entry by scrolling', async () => {
  mount(); expect(rows().length).toBeLessThan(60);
  list().scrollTop = 4001 * 60; list().dispatchEvent(new Event('scroll')); await nextTick();
  expect(rows().some(row => row.textContent?.includes('Entry 4000'))).toBe(true); expect(rows().length).toBeLessThan(60);
});
it('searches the whole book and edits the original index, then adds and reveals the selected entry', async () => {
  const entries = mount(); await search('Content 3999'); expect(rows()).toHaveLength(1);
  rows()[0].querySelector<HTMLButtonElement>('.wbd__row-name')!.click(); await nextTick();
  const name = document.querySelector<HTMLInputElement>('#wbd-name')!;
  name.value = 'Changed'; name.dispatchEvent(new Event('input', { bubbles: true })); await nextTick(); expect(entries.value[3999].name).toBe('Changed');
  document.querySelector<HTMLButtonElement>('.wbd__list > button')!.click(); await nextTick(); await nextTick();
  expect(entries.value).toHaveLength(4002); expect(document.querySelector('.wbd__row--on')).not.toBeNull();
  expect(document.querySelector<HTMLInputElement>('#wbd-name')!.value).toBe(''); expect(rows().length).toBeLessThan(60);
});
it('tabs from the rendered boundary to the next entry without skipping entries', async () => {
  mount(); await nextTick(); const last = rows().at(-1)!; const index = Number(last.dataset.rowIndex);
  const lastControl = [...last.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].at(-1)!;
  lastControl.focus(); lastControl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); await nextTick(); await nextTick();
  expect(document.activeElement?.closest<HTMLElement>('.wbd__row')?.dataset.rowIndex).toBe(String(index + 1));
});
it('reorders and drops using book indices after scrolling', async () => {
  const entries = mount(); list().scrollTop = 48000; list().dispatchEvent(new Event('scroll')); await nextTick();
  const first = rows()[0]; const index = Number(first.dataset.rowIndex); expect(index).toBeGreaterThan(0);
  first.querySelector<HTMLButtonElement>('.wbd__row-name')!.click(); await nextTick(); first.querySelectorAll<HTMLButtonElement>('.wbd__row-tools button')[1].click(); await nextTick();
  expect(entries.value[index + 1].name).toBe(`Entry ${index}`);
  const source = rows().find(row => Number(row.dataset.rowIndex) === index + 1)!; const target = rows().find(row => Number(row.dataset.rowIndex) === index + 3)!;
  source.dispatchEvent(new Event('dragstart', { bubbles: true })); target.dispatchEvent(new Event('drop', { bubbles: true })); await nextTick();
  expect(entries.value[index + 3].name).toBe(`Entry ${index}`); expect(document.querySelector<HTMLInputElement>('#wbd-name')!.value).toBe(`Entry ${index}`);
});

it('shift-tabs across the leading window boundary to the preceding row', async () => {
  mount(); list().scrollTop = 48000; list().dispatchEvent(new Event('scroll')); await nextTick();
  const first = rows()[0]; const index = Number(first.dataset.rowIndex);
  const control = first.querySelector<HTMLInputElement>('input')!;
  control.focus(); control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  await nextTick(); await nextTick();
  expect(document.activeElement?.closest<HTMLElement>('.wbd__row')?.dataset.rowIndex).toBe(String(index - 1));
  expect(document.activeElement?.getAttribute('title')).toBe(i18n.global.t('wb.entry.delete'));
});
it('uses measured row heights when computing the scroll window', async () => {
  let resize!: ResizeObserverCallback;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} disconnect() {} });
  mount(100); await nextTick();
  const first = rows()[0];
  vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ height: 20 } as DOMRect);
  resize([{ target: first } as unknown as ResizeObserverEntry], {} as ResizeObserver); await nextTick();
  list().scrollTop = 280; list().dispatchEvent(new Event('scroll')); await nextTick();
  // 20px first row, 48px estimates thereafter, plus 2px gaps.
  expect(rows()[0].dataset.rowIndex).toBe('2');
  expect((list().firstElementChild as HTMLElement).style.height).toBe('70px');
});

it.each(['move', 'remove', 'drop'])('keeps the viewport when %s affects an unselected distant row', async action => {
  mount(); list().scrollTop = 48000; list().dispatchEvent(new Event('scroll')); await nextTick();
  const first = rows()[0];
  if (action === 'drop') {
    first.dispatchEvent(new Event('dragstart', { bubbles: true }));
    rows()[2].dispatchEvent(new Event('drop', { bubbles: true }));
  } else first.querySelectorAll<HTMLButtonElement>('.wbd__row-tools button')[action === 'move' ? 1 : 2].click();
  await nextTick(); await nextTick();
  expect(document.querySelector<HTMLInputElement>('#wbd-name')!.value).toBe('Entry 0');
  expect(list().scrollTop).toBe(48000);
});
it('keeps the same drag source node mounted across windows without mounting the intervening rows', async () => {
  mount(); const source = rows()[0];
  source.dispatchEvent(new Event('dragstart', { bubbles: true })); await nextTick();
  list().scrollTop = 48000; list().dispatchEvent(new Event('scroll')); await nextTick();
  expect(source.isConnected).toBe(true);
  expect(list().querySelector('[data-row-index="0"]')).toBe(source);
  expect(rows().length).toBeLessThan(60);
  const target = rows().find(row => Number(row.dataset.rowIndex) > 900)!;
  const targetIndex = Number(target.dataset.rowIndex);
  target.dispatchEvent(new Event('drop', { bubbles: true })); await nextTick(); await nextTick();
  expect(document.querySelector<HTMLInputElement>('#wbd-name')!.value).toBe('Entry 0');
  expect(document.querySelector('.wbd__row--on')?.getAttribute('data-row-index')).toBe(String(targetIndex));
});
it('enters the full book at its last and first rows from the external Tab boundaries', async () => {
  mount(); const name = document.querySelector<HTMLInputElement>('#wbd-name')!;
  name.focus(); name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); await nextTick(); await nextTick();
  expect(document.activeElement?.closest<HTMLElement>('.wbd__row')?.dataset.rowIndex).toBe('4000');
  expect(document.activeElement?.getAttribute('title')).toBe(i18n.global.t('wb.entry.delete'));
  const add = document.querySelector<HTMLButtonElement>('.wbd__list > button')!;
  add.focus(); add.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); await nextTick(); await nextTick();
  expect(document.activeElement?.closest<HTMLElement>('.wbd__row')?.dataset.rowIndex).toBe('0');
  expect(document.activeElement?.tagName).toBe('INPUT');
});
