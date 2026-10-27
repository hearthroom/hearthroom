import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import ConfirmDialog from '../src/components/ConfirmDialog.vue';
import { clearPublicationDrafts, confirmForm, confirmState, settleConfirm } from '../src/lib/confirm';
import { i18n, loadLocale } from '../src/lib/i18n';

let app: App | undefined;
const tick = async () => { await nextTick(); await Promise.resolve(); await nextTick(); };
afterEach(() => { clearPublicationDrafts(); settleConfirm(false); app?.unmount(); document.body.innerHTML = ''; });
async function open(extra: object = {}) {
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(ConfirmDialog); app.use(i18n); app.mount(root);
  const result = confirmForm({ title: 'Review', message: 'Consent', field: { label: 'Fandom' }, publication: { key: 'fixture', nextMajorUpdateAt: 0 }, ...extra } as any);
  await tick(); return result;
}
it('defaults silent, validates the changelog by code points and clears hidden logs from the submission', async () => {
  const result=open(); await tick();
  const major = document.querySelector<HTMLInputElement>('[data-update-choice="major"]');
  expect(major).not.toBeNull(); major!.click(); await tick();
  const note = document.querySelector<HTMLTextAreaElement>('[data-update-note]')!;
  expect(note).not.toBeNull();
  const confirm = document.querySelector<HTMLButtonElement>('[data-confirm]')!;
  expect(confirm.disabled).toBe(true);
  note.value = '😀'.repeat(10); note.dispatchEvent(new Event('input', { bubbles: true })); await tick();
  expect(confirm.disabled).toBe(false);
  note.value = '字'.repeat(201); note.dispatchEvent(new Event('input', { bubbles: true })); await tick();
  expect(confirm.disabled).toBe(true);
  document.querySelector<HTMLInputElement>('[data-update-choice="minor"]')!.click(); await tick();
  expect(confirm.disabled).toBe(false);
  confirm.click();await tick();expect((await result)?.update).toEqual({updateKind:'minor',updateNote:''});
});
it('reopens an unknown result with the frozen log and queries the same intent',async()=>{
 const send=vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(undefined);
 void open({onConfirm:send});await tick();
 document.querySelector<HTMLInputElement>('[data-update-choice="major"]')!.click();await tick();
 const note=document.querySelector<HTMLTextAreaElement>('[data-update-note]')!;
 note.value='新增第二章劇情和兩條支線';note.dispatchEvent(new Event('input',{bubbles:true}));await tick();
 document.querySelector<HTMLButtonElement>('[data-confirm]')!.click();await tick();
 expect(document.body.textContent).toContain('送審結果仍待確認');settleConfirm(false);await tick();
 const again=confirmForm({message:'Consent',field:{label:'Fandom'},publication:{key:'fixture',nextMajorUpdateAt:0},onConfirm:send});await tick();
 expect(document.body.textContent).toContain('查詢送審結果');
 expect(document.querySelector<HTMLTextAreaElement>('[data-update-note]')?.value).toBe('新增第二章劇情和兩條支線');
 document.querySelector<HTMLButtonElement>('[data-confirm]')!.click();await tick();await again;
 expect(send.mock.calls[1][0].update).toEqual(send.mock.calls[0][0].update);
});
it('keeps the notify option unavailable during the cooldown and retains the silent option', async () => {
  void open({ publication: { key: 'cooldown', nextMajorUpdateAt: Date.now() + 100000 } }); await tick();
  expect(document.querySelector<HTMLInputElement>('[data-update-choice="major"]')?.disabled).toBe(true);
  expect(document.querySelector<HTMLInputElement>('[data-update-choice="minor"]')?.disabled).toBe(false);
});
it('retains the form on a definite submission failure', async () => {
  void open({ onConfirm: async () => { throw new Error('Try again'); } }); await tick();
  document.querySelector<HTMLButtonElement>('[data-confirm]')!.click(); await tick();
  expect(confirmState.current).not.toBeNull();
  expect(document.body.textContent).toContain('Try again');
});

it('keeps the first-review dialog and its field when recovered acceptance differs from the current input',async()=>{
 const message=i18n.global.t('workspace.submitPreviousAccepted');
 void open({publication:undefined,cancelText:i18n.global.t('cardUpdate.update.back'),onConfirm:async()=>{throw Object.assign(new Error(message),{status:409,code:'publication_completed_different_intent'});}});await tick();
 const field=document.querySelector<HTMLInputElement>('[data-field]')!;
 field.value='New synthetic fandom';field.dispatchEvent(new Event('input',{bubbles:true}));await tick();
 document.querySelector<HTMLButtonElement>('[data-confirm]')!.click();await tick();
 expect(confirmState.current).not.toBeNull();expect(document.querySelector<HTMLInputElement>('[data-field]')!.value).toBe('New synthetic fandom');
 expect(document.body.textContent).toContain(message);
 expect(document.querySelector('[data-cancel]')?.textContent).toContain(i18n.global.t('cardUpdate.update.back'));
});

it.each(['zh-Hant','zh-Hans','en','ja','ko'] as const)('shows the three-day interval in %s',async locale=>{
  await loadLocale(locale);
  i18n.global.locale.value=locale;
  try {
    void open();await tick();
    expect(document.querySelector('.publication-fields')?.textContent).toContain(i18n.global.t('cardUpdate.update.intervalHint',{days:3},3));
  } finally { i18n.global.locale.value='zh-Hant'; }
});
