import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { i18n, applyLocale } from '../src/lib/i18n';
import { confirmState, settleConfirm } from '../src/lib/confirm';
const mock = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), remove: vi.fn(), other: vi.fn() }));
vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: { accountNumId: 1 }, accessToken: async () => 'fixture' }) }));
vi.mock('../src/lib/use-locale', async () => { const { ref } = await import('vue'); return { useLocalePath: () => ({ locale: ref('zh-Hant'), lp: (path: string) => path }) }; });
vi.mock('../src/lib/display-name', () => ({ displayName: (name: string) => name }));
vi.mock('../src/components/CardGrid.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/components/FavoriteGrid.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../src/lib/library', async original => ({ ...await original<object>(), fetchConversations: mock.list, previewConversationDeletion: mock.preview, deleteConversations: mock.remove, libraryRequest: mock.other }));
import LibraryPage from '../src/pages/LibraryPage.vue';
import ConfirmDialog from '../src/components/ConfirmDialog.vue';
import { pageAway } from '../src/pet/enabled';

let app: App, el: HTMLDivElement, router: Router;
const rows = [1, 2, 3, 4].map(n => ({ provider: 'harbor', conversationRoleId: `role-${n}`, conversationId: `conv-${n}`, cardNumber: n, conversationTitle: null, roleName: `合成卡 ${n}`, roleAvatar: '', canGenerate: n !== 4 }));
let current = [...rows];
const settle = async () => { await nextTick(); await new Promise(r => setTimeout(r, 0)); await nextTick(); };
const button = (key: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === i18n.global.t(`library.manage.${key}`))!;
const options = () => [...el.querySelectorAll<HTMLElement>('[role="option"]')];
const selected = () => options().map(e => e.getAttribute('aria-selected'));
beforeEach(async () => {
  vi.clearAllMocks(); await applyLocale('zh-Hant'); current = [...rows];
  mock.list.mockImplementation(async () => ({ conversations: [...current], hasNextPage: true }));
  mock.other.mockResolvedValue({ items: [], hasNext: false });
  mock.preview.mockImplementation(async (_token, chats) => ({ selectionToken: 'frozen', groups: chats.map((c: typeof rows[number]) => ({ roleId: c.conversationRoleId, conversationId: c.conversationId, count: 2 })), total: chats.length * 2 }));
  mock.remove.mockImplementation(async () => ({ results: [{ roleId: 'role-1', conversationId: 'conv-1', status: 'deleted', deletedCount: 2 }], deletedCount: 2 }));
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/library', component: LibraryPage }] });
  await router.push('/library'); el = document.createElement('div'); document.body.append(el);
  app = createApp({ render: () => [h(RouterView), h(ConfirmDialog)] }).use(router).use(i18n); app.mount(el); await settle();
});
afterEach(() => { settleConfirm(false); app?.unmount(); el.remove(); document.body.innerHTML = ''; });

it('toggles, extends and clears page selection without following resume links; hides the pet only while managing', async () => {
  expect(el.querySelectorAll('a.conversation')).toHaveLength(4);
  button('manage').click(); await settle();
  expect(pageAway.value).toBeGreaterThan(0); expect(options()).toHaveLength(4);
  expect(el.querySelector('a.conversation')).toBeNull();
  options()[0].click(); await settle(); options()[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); await settle();
  expect(selected()).toEqual(['true','true','true','false']);
  options()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); await settle();
  expect(selected()).toEqual(['true','false','true','false']);
  options()[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, ctrlKey:true, cancelable:true })); await settle();
  expect(selected()).toEqual(['true','true','true','false']);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true })); await settle();
  expect(selected()).toEqual(['true','true','true','true']);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
  expect(options()).toHaveLength(0); expect(pageAway.value).toBe(0);
});

it('previews the segment count, focuses Keep and cancels without a deletion', async () => {
  button('manage').click(); await settle(); options()[0].click(); await settle();
  el.querySelector<HTMLButtonElement>('[data-delete-selected]')!.click(); await settle();
  expect(mock.preview).toHaveBeenCalledWith('fixture', [rows[0]]);
  expect(document.querySelector('#dlg-title')?.textContent).toContain('2');
  expect(document.querySelector('#dlg-msg')?.textContent).toContain('無法復原');
  expect(document.activeElement?.hasAttribute('data-cancel')).toBe(true);
  expect([...el.querySelectorAll<HTMLButtonElement>('.pager button')].every(b => b.disabled)).toBe(true);
  document.querySelector<HTMLButtonElement>('[data-cancel]')!.click(); await settle();
  expect(mock.remove).not.toHaveBeenCalled(); expect(selected()[0]).toBe('true');
});

it('keeps the confirmation locked while deleting and retains only failed selections with a durable error', async () => {
  button('manage').click(); await settle(); options()[0].click(); await settle(); options()[1].click(); await settle();
  el.querySelector<HTMLButtonElement>('[data-delete-selected]')!.click(); await settle();
  let finish!: (value: unknown) => void;
  mock.remove.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  document.querySelector<HTMLButtonElement>('[data-confirm]')!.click(); await settle();
  expect(mock.remove).toHaveBeenCalledWith('fixture', 'frozen');
  expect(document.querySelector<HTMLButtonElement>('[data-cancel]')!.disabled).toBe(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await settle();
  expect(confirmState.current).not.toBeNull();
  current = current.filter(r => r.conversationId !== 'conv-1');
  finish({ results: [{ roleId:'role-1',conversationId:'conv-1',status:'deleted',deletedCount:2 }, { roleId:'role-2',conversationId:'conv-2',status:'busy',deletedCount:0 }], deletedCount:2 });
  await settle(); await settle();
  expect(confirmState.current).toBeNull();
  expect(options()).toHaveLength(3); expect(selected()).toEqual(['true','false','false']);
  expect(el.querySelector('[role="alert"]')?.textContent).toContain('已保留選取');
  expect(options()[0].textContent).toContain('正在回覆');
  expect(el.querySelector('.toast')?.textContent).toContain('2');
  el.querySelector<HTMLButtonElement>('.library__failure button')!.click(); await settle();
  expect(mock.preview).toHaveBeenCalledTimes(1);
  expect(document.querySelector('#dlg-title')?.textContent).toContain('2');
  mock.remove.mockResolvedValueOnce({ results: [{ roleId:'role-2',conversationId:'conv-2',status:'deleted',deletedCount:2 }], deletedCount:2 });
  current = current.filter(r => r.conversationId !== 'conv-2');
  document.querySelector<HTMLButtonElement>('[data-confirm]')!.click(); await settle();
  expect(mock.remove).toHaveBeenLastCalledWith('fixture','frozen',['conv-2']);
  expect(el.querySelector('[role="alert"]')).toBeNull();
});

it('keeps an uncertain result for an idempotent retry and obtains new consent after a confirmed expiry', async () => {
  button('manage').click(); await settle(); options()[0].click(); await settle();
  mock.remove.mockRejectedValueOnce(new TypeError('offline'));
  el.querySelector<HTMLButtonElement>('[data-delete-selected]')!.click(); await settle();
  document.querySelector<HTMLButtonElement>('[data-confirm]')!.click(); await settle();
  expect(el.querySelector('[role="alert"]')?.textContent).toContain('尚待確認');
  expect(selected()[0]).toBe('true');
  el.querySelector<HTMLButtonElement>('.library__failure button')!.click(); await settle();
  expect(mock.preview).toHaveBeenCalledTimes(1);
  mock.remove.mockRejectedValueOnce({ code:'selection_expired' });
  document.querySelector<HTMLButtonElement>('[data-confirm]')!.click(); await settle();
  el.querySelector<HTMLButtonElement>('.library__failure button')!.click(); await settle();
  expect(mock.preview).toHaveBeenCalledTimes(2);
  expect(confirmState.current).not.toBeNull();
});

it('clears selections on page navigation and offers no management on favorites', async () => {
  button('manage').click(); await settle(); options()[3].click(); await settle();
  await router.push('/library?page=2'); await settle();
  expect(selected()).toEqual(['false','false','false','false']);
  await router.push('/library?tab=favorites'); await settle();
  expect(button('manage')).toBeUndefined(); expect(pageAway.value).toBe(0);
});
