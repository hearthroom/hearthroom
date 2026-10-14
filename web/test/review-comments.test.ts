/**
 * 社群管理的留言分頁與運營設定：移除要填原因、送失敗重按沿用同一個操作編號；AI 審核帳號只看得到放行；
 * 設定留空送 null，不是應用管理員整頁唯讀。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { i18n } from '../src/lib/i18n';

const held = { id: 'c1', target: { kind: 'card', id: '12', title: '雨夜書店', cardNumber: 3 }, author: { handle: 'rainy', displayName: '小雨' }, content: 'buy now', status: 'held', holdReason: 'keyword', reports: { total: 0, byReason: {} }, createdAt: 1, moderatedAt: 1, moderationReason: null, suggestedBy: null };
const mocks = vi.hoisted(() => ({
  ApiError: null as unknown as new (s: number, m: string, c: string) => Error,
  decide: vi.fn(),
  keywords: vi.fn(),
  settings: vi.fn(),
  save: vi.fn(),
}));
vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: { accountNumId: 7 }, profile: {}, ready: true, accessToken: async () => 'synthetic' }) }));
vi.mock('../src/lib/api', async (original) => {
  const real = await original<typeof import('../src/lib/api')>();
  mocks.ApiError = real.ApiError;
  return {
    ...real,
    fetchReviewMe: async () => ({ reviewer: true, pending: 0, reviews: 0, cases: 0, comments: 4, role: 'reviewer' }),
    fetchCommentQueue: async () => ({ total: 1, items: [held] }),
    fetchCommentStats: async () => ({ held: 4, openReports: 1, removed7d: 2, medianHandleMs7d: 30 * 60_000, holdReasons7d: {} }),
    fetchKeywords: mocks.keywords,
    decideComment: mocks.decide,
    fetchSettings: mocks.settings,
    saveSettings: mocks.save,
  };
});
import { router as siteRouter } from '../src/router';

let app: App, host: HTMLElement;
async function mount(path: string) {
  host = document.body.appendChild(document.createElement('div'));
  const router = createRouter({ history: createMemoryHistory(), routes: siteRouter.options.routes });
  await router.push(path);
  app = createApp({ render: () => h(RouterView) }).use(createPinia()).use(router).use(i18n);
  app.mount(host);
}
const t = (k: string, p?: Record<string, unknown>) => i18n.global.t(k, p ?? {});
beforeEach(() => {
  i18n.global.locale.value = 'zh-Hant';
  mocks.keywords.mockReset().mockResolvedValue({ items: [{ id: 'k1', pattern: 'buy now', createdAt: 1 }] });
  mocks.decide.mockReset();
});
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; });

it('removes a held comment only with a reason, and a retry reuses the same operation id', async () => {
  await mount('/review/comments');
  await vi.waitFor(() => expect(host.querySelector('[data-comment="c1"]')).not.toBeNull());
  expect(host.querySelector('.management-nav a[href="/review/comments"] .review-badge')?.textContent).toBe('4');
  expect(host.querySelector('[data-comment="c1"]')!.textContent).toContain(t('moderation.comments.holdReason.keyword'));
  expect(host.textContent).toContain(t('moderation.comments.stats.median'));
  await vi.waitFor(() => expect(host.querySelector('[data-keyword="k1"]')).not.toBeNull());

  host.querySelector<HTMLButtonElement>('[data-action="remove"]')!.click(); await nextTick();
  const dialog = document.querySelector<HTMLFormElement>('[role=dialog]')!;
  const submit = dialog.querySelector<HTMLButtonElement>('button[type=submit]')!;
  expect(submit.disabled).toBe(true);
  const reason = dialog.querySelector('textarea')!; reason.value = 'Spam link'; reason.dispatchEvent(new Event('input')); await nextTick();
  mocks.decide.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'c1', status: 'removed' });
  dialog.requestSubmit();
  await vi.waitFor(() => expect(dialog.textContent).toContain('offline'));
  dialog.requestSubmit();
  await vi.waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(2));
  const [first, second] = mocks.decide.mock.calls;
  expect(first![1]).toEqual({ action: 'remove', reason: 'Spam link', operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(second![1].operationId).toBe(first![1].operationId);
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
});

it('returns focus to the button that opened the reason dialog, whichever way it closes', async () => {
  await mount('/review/comments');
  await vi.waitFor(() => expect(host.querySelector('[data-action="remove"]')).not.toBeNull());
  const opener = host.querySelector<HTMLButtonElement>('[data-action="remove"]')!;
  const openIt = async () => { opener.focus(); opener.click(); await nextTick(); await nextTick(); expect(document.activeElement).not.toBe(opener); };
  await openIt();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  expect(document.querySelector('[role=dialog]')).toBeNull();
  await openIt();
  [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find(b => b.textContent === t('dialog.cancel'))!.click();
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  await openIt();
  document.querySelector<HTMLElement>('.modal-backdrop')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  // 框內 Tab 也繞回來：最後一個（取消；原因還沒填，確認鍵停用）往下回到原因欄
  await openIt();
  const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
  const cancel = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === t('dialog.cancel'))!;
  cancel.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(dialog.querySelector('textarea'));
});

it('shows an AI reviewer only the release action', async () => {
  mocks.keywords.mockRejectedValue(new mocks.ApiError(403, 'no', 'agent_not_allowed'));
  mocks.decide.mockResolvedValue({ id: 'c1', status: 'visible' });
  await mount('/review/comments');
  await vi.waitFor(() => expect(host.querySelector('[data-comment="c1"]')).not.toBeNull());
  await vi.waitFor(() => expect(host.querySelector('[data-action="remove"]')).toBeNull());
  expect(host.querySelector('[data-action="mute"]')).toBeNull();
  expect(host.querySelector('[data-keyword]')).toBeNull();
  host.querySelector<HTMLButtonElement>('[data-action="release"]')!.click();
  await vi.waitFor(() => expect(mocks.decide).toHaveBeenCalledWith('c1', { action: 'release', reason: '', operationId: expect.any(String) }, 'synthetic'));
});

it('saves blank settings as off and keeps the page read-only for non-admins', async () => {
  mocks.settings.mockResolvedValueOnce({ settings: { commentNewAccountDays: 3, commentMaxLinks: null, commentReportFoldThreshold: 5 }, canEdit: true });
  mocks.save.mockImplementation(async (settings) => ({ settings, canEdit: true }));
  await mount('/review/settings');
  const days = () => host.querySelector<HTMLInputElement>('#setting-commentNewAccountDays')!;
  await vi.waitFor(() => expect(days().value).toBe('3'));
  days().value = ''; days().dispatchEvent(new Event('input')); await nextTick();
  host.querySelector('form')!.requestSubmit();
  await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ commentNewAccountDays: null, commentMaxLinks: null, commentReportFoldThreshold: 5 }, expect.stringMatching(/^[0-9a-f-]{36}$/), 'synthetic'));
  await vi.waitFor(() => expect(host.querySelector('[role=status]')?.textContent).toBe(t('moderation.settings.saved')));
  app.unmount(); host.remove();

  mocks.settings.mockResolvedValueOnce({ settings: { commentNewAccountDays: 3, commentMaxLinks: null, commentReportFoldThreshold: 5 }, canEdit: false });
  await mount('/review/settings');
  await vi.waitFor(() => expect(host.querySelector('[data-read-only]')?.textContent).toBe(t('moderation.settings.readOnly')));
  expect(days().disabled).toBe(true);
  expect(host.querySelector('button.settings-save')).toBeNull();
});
