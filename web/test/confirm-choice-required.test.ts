// 必選項沒選就按確認：不能「按了沒反應」。要說清楚缺什麼，並把焦點帶到選項上。
// （使用者回報「提交審核點了沒反應」：送審框的提交鍵在手機上看起來像能按，其實是停用的。）
import { afterEach, expect, it } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { i18n } from '../src/lib/i18n';
import ConfirmDialog from '../src/components/ConfirmDialog.vue';
import { confirmChoice } from '../src/lib/confirm';
let app: App; let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); document.body.innerHTML = ''; });
const tick = async () => { for (let i = 0; i < 5; i++) await nextTick(); };

it('explains the missing choice instead of ignoring the confirm tap', async () => {
  root = document.createElement('div'); document.body.append(root);
  app = createApp(ConfirmDialog).use(i18n); app.mount(root);
  const result = confirmChoice({ title: 'Submit', message: 'm', confirmText: 'Submit', choiceLabel: 'Content rating', choices: [{ value: 'sfw', label: 'General' }, { value: 'nsfw', label: 'Adult' }] });
  await tick();
  const confirm = document.querySelector<HTMLButtonElement>('[data-confirm]')!;
  expect(confirm.disabled).toBe(false);
  confirm.click(); await tick();
  const alert = document.querySelector('.dlg [role=alert]');
  expect(alert?.textContent).toContain('Content rating');
  expect(document.activeElement).toBe(document.querySelector('[data-choice]'));
  (document.querySelectorAll<HTMLInputElement>('[data-choice]')[0]!).click(); await tick();
  expect(document.querySelector('.dlg [role=alert]')).toBeNull();
  confirm.click();
  expect(await result).toBe('sfw');
});
