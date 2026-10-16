/**
 * 運營設定的「活動」區塊：只有應用管理員能改，其他審核員唯讀；時間照選的時區換算；存檔撞版本給「載入最新版本」；
 * 啟用缺欄位時把那一格標出來；確認後失敗再按沿用同一個操作編號；平台點數池沒設定時說一聲。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import ConfirmDialog from '../src/components/ConfirmDialog.vue';
import { epochToZoned, zonedToEpoch } from '../src/lib/campaign';

vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: { accountNumId: 7 }, profile: {}, ready: true, accessToken: async () => 'synthetic' }) }));
vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  fetchReviewMe: async () => ({ reviewer: true, pending: 0, reviews: 0, cases: 0, comments: 0, role: 'reviewer' }),
}));
import { router as siteRouter } from '../src/router';

const campaign = (over: Record<string, unknown> = {}) => ({
  id: 'c1', slug: 'launch', title: { 'zh-Hant': '開站分享' }, intro: {}, bannerKey: null, bannerUrl: null,
  startsAt: Date.parse('2026-11-01T12:00Z'), endsAt: Date.parse('2026-11-30T12:00Z'), timezone: 'Asia/Taipei', submitDeadline: null, payoutDeadline: null,
  tiers: { light: 11, original: 22, guide: 33 }, extraPlacementAmount: 4, flagBurstThreshold: null, evidenceRetentionDays: 90, featured: false,
  status: 'draft', version: 2, createdAt: 1, updatedAt: 1, ...over,
});
type Call = { method: string; path: string; body: any };
let calls: Call[];
let handle: (c: Call) => { status: number; body: unknown } | undefined;
let canEdit: boolean;
let pool: unknown;
const ok = (body: unknown) => ({ status: 200, body });

let app: App, host: HTMLElement, router: ReturnType<typeof createRouter>;
async function mount(path = '/review/settings') {
  host = document.body.appendChild(document.createElement('div'));
  router = createRouter({ history: createMemoryHistory(), routes: siteRouter.options.routes });
  await router.push(path);
  app = createApp({ render: () => [h(RouterView), h(ConfirmDialog)] }).use(createPinia()).use(router).use(i18n);
  app.mount(host);
  if (path === '/review/settings') await vi.waitFor(() => expect(host.querySelector('[data-campaign="c1"]')).not.toBeNull());
}
const t = (k: string, p?: Record<string, unknown>) => i18n.global.t(k, p ?? {});
const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T & HTMLElement>(sel)!;
const field = (name: string) => $<HTMLInputElement>(`[data-field="${name}"]`);
function fill(el: HTMLInputElement | HTMLSelectElement, value: string) { el.value = value; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input')); }
const confirm = async () => {
  await vi.waitFor(() => expect(document.querySelector('[role=alertdialog] [data-confirm]')).not.toBeNull());
  document.querySelector<HTMLButtonElement>('[role=alertdialog] [data-confirm]')!.click();
};
const statusCalls = () => calls.filter((c) => c.path === '/v1/moderation/campaigns/c1/status');

beforeEach(() => {
  i18n.global.locale.value = 'zh-Hant';
  calls = [];
  canEdit = true;
  pool = { configured: true, enabled: true, usageScope: 'agent_only', validityDays: null, maxPayout: 5000, balance: 120000, paidTotal: 0, updatedAt: null };
  handle = () => undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = url.split('?')[0]!;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const call = { method, path, body };
    calls.push(call);
    const res = handle(call)
      ?? (path === '/v1/moderation/settings' ? ok({ settings: { commentNewAccountDays: null, commentMaxLinks: null, commentReportFoldThreshold: null }, canEdit })
        : path === '/v1/moderation/campaigns' && method === 'GET' ? ok({ items: [campaign()], canEdit })
          : path === '/v1/moderation/campaign-pool' ? ok(pool)
            : { status: 404, body: { error: 'not_found' } });
    return new Response(JSON.stringify(res.body), { status: res.status });
  }));
});
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('timezone conversion', () => {
  it('reads a datetime-local value in the selected zone, not the browser zone', () => {
    expect(zonedToEpoch('2026-11-01T20:00', 'Asia/Tokyo')).toBe(Date.parse('2026-11-01T11:00Z'));
    expect(zonedToEpoch('2026-11-01T20:00', 'UTC')).toBe(Date.parse('2026-11-01T20:00Z'));
    // 紐約 11/1 那天從夏令時間切回來：當天 20:00 已經是 UTC-5
    expect(zonedToEpoch('2026-11-01T20:00', 'America/New_York')).toBe(Date.parse('2026-11-02T01:00Z'));
    expect(epochToZoned(Date.parse('2026-11-01T11:00Z'), 'Asia/Tokyo')).toBe('2026-11-01T20:00');
    expect(zonedToEpoch('', 'Asia/Tokyo')).toBeNull();
  });
});

it('other reviewers see campaigns read-only, without the new button or the platform settings', async () => {
  canEdit = false;
  await mount();
  expect(host.querySelector('[data-action="new-campaign"]')).toBeNull();
  expect($('[data-campaign-read-only]').textContent).toContain(t('moderation.settings.readOnly'));
  expect($('[data-campaign="c1"]').textContent).toContain('開站分享');
  expect($('[data-campaign="c1"]').textContent).toContain(t('campaign.status.draft'));
  $('[data-campaign="c1"] [data-action="edit"]').click();
  await vi.waitFor(() => expect(host.querySelector('[data-campaign-form]')).not.toBeNull());
  expect(field('slug').disabled).toBe(true);
  expect(field('tiers.light').disabled).toBe(true);
  expect(host.querySelector('[data-action="save-campaign"]')).toBeNull();
  expect(host.querySelector('[data-action="activate"]')).toBeNull();
  expect(host.querySelector('[data-pool]')).toBeNull();
  expect(calls.some((c) => c.path === '/v1/moderation/campaign-pool')).toBe(false);
});

it('a new campaign converts times in the chosen zone and leaves unset amounts unset', async () => {
  handle = (c) => (c.method === 'POST' && c.path === '/v1/moderation/campaigns' ? ok(campaign({ id: 'c2', version: 1 })) : undefined);
  await mount();
  $('[data-action="new-campaign"]').click();
  await vi.waitFor(() => expect(host.querySelector('[data-campaign-form]')).not.toBeNull());
  expect(field<HTMLSelectElement>('timezone').value).toBe('Asia/Taipei');
  fill(field('slug'), 'autumn');
  fill(field('title'), '秋季分享');
  fill(field<HTMLSelectElement>('timezone'), 'Asia/Tokyo');
  fill(field('startsAt'), '2026-11-01T20:00');
  fill(field('tiers.light'), '12');
  await nextTick();
  expect($('[data-zone="startsAt"]').textContent).toContain('日本');
  $('[data-action="save-campaign"]').click();
  await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/moderation/campaigns')).toBe(true));
  const body = calls.find((c) => c.method === 'POST' && c.path === '/v1/moderation/campaigns')!.body;
  expect(body).toMatchObject({ slug: 'autumn', title: { 'zh-Hant': '秋季分享' }, timezone: 'Asia/Tokyo', startsAt: Date.parse('2026-11-01T11:00Z'), endsAt: null, tiers: { light: 12 }, extraPlacementAmount: null, flagBurstThreshold: null, featured: false });
  expect(body).not.toHaveProperty('evidenceRetentionDays');
  expect(body).not.toHaveProperty('expectedVersion');
  expect(typeof body.operationId).toBe('string');
});

it('a new campaign moves to its own address after the first save without reloading', async () => {
  handle = (c) => (c.method === 'POST' && c.path === '/v1/moderation/campaigns' ? ok(campaign({ id: 'c2', version: 1 })) : undefined);
  await mount();
  $('[data-action="new-campaign"]').click();
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/review/settings/campaigns/new'));
  await vi.waitFor(() => expect(host.querySelector('[data-campaign-form]')).not.toBeNull());
  fill(field('slug'), 'autumn');
  fill(field('title'), '秋季分享');
  const lists = () => calls.filter((c) => c.method === 'GET' && c.path === '/v1/moderation/campaigns').length;
  const before = lists();
  await nextTick();
  $('[data-action="save-campaign"]').click();
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/review/settings/campaigns/c2'));
  await nextTick();
  expect(lists()).toBe(before);
  expect(document.querySelector('[role=alertdialog]')).toBeNull();
  expect(host.querySelector('[data-action="activate"]')).not.toBeNull();
});

it('leaving the editor with unsaved changes asks first, and staying keeps the edits', async () => {
  await mount();
  $('[data-campaign="c1"] [data-action="edit"]').click();
  await vi.waitFor(() => expect(field('slug')?.value).toBe('launch'));
  fill(field('title'), '還沒存');
  $('[data-action="back"]').click();
  await vi.waitFor(() => expect(document.querySelector('[role=alertdialog]')).not.toBeNull());
  document.querySelector<HTMLButtonElement>('[role=alertdialog] [data-cancel]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[role=alertdialog]')).toBeNull());
  expect(router.currentRoute.value.path).toBe('/review/settings/campaigns/c1');
  expect(field('title').value).toBe('還沒存');
  $('[data-action="back"]').click();
  await confirm();
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/review/settings'));
});

it('an unknown campaign address says it cannot be found', async () => {
  await mount('/review/settings/campaigns/missing');
  await vi.waitFor(() => expect(host.querySelector('[data-campaign-editor] [role=alert]')?.textContent).toContain(t('state.notFound')));
  expect(host.querySelector('[data-campaign-form]')).toBeNull();
});

it('the recommend-on-home toggle marks the form dirty and goes out with the save', async () => {
  handle = (c) => (c.method === 'PUT' ? ok(campaign({ featured: c.body.featured, version: 3 })) : undefined);
  await mount();
  $('[data-campaign="c1"] [data-action="edit"]').click();
  await vi.waitFor(() => expect(field('slug')?.value).toBe('launch'));
  const box = field('featured');
  expect(box.checked).toBe(false);
  expect(box.closest('label')!.textContent).toContain(t('campaign.field.featured'));
  expect($('[data-action="activate"]').hasAttribute('disabled')).toBe(false);
  box.click();
  await nextTick();
  expect($('[data-action="activate"]').hasAttribute('disabled')).toBe(true);
  $('[data-action="save-campaign"]').click();
  await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ featured: true, expectedVersion: 2 });
  await vi.waitFor(() => expect($('[data-action="activate"]').hasAttribute('disabled')).toBe(false));
  expect(field('featured').checked).toBe(true);
});

it('a save that hits a version conflict keeps my edits and offers load-latest', async () => {
  await mount();
  $('[data-campaign="c1"] [data-action="edit"]').click();
  await vi.waitFor(() => expect(field('slug')?.value).toBe('launch'));
  fill(field('title'), '我改的名字');
  handle = (c) => (c.method === 'PUT' ? { status: 409, body: { error: 'campaign_version_conflict', version: 3 } } : undefined);
  $('[data-action="save-campaign"]').click();
  await vi.waitFor(() => expect(host.querySelector('[data-conflict]')).not.toBeNull());
  expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ expectedVersion: 2, title: { 'zh-Hant': '我改的名字' } });
  expect(field('title').value).toBe('我改的名字');

  handle = (c) => (c.method === 'GET' && c.path === '/v1/moderation/campaigns' ? ok({ items: [campaign({ title: { 'zh-Hant': '別人的名字' }, version: 3 })], canEdit: true }) : undefined);
  $('[data-action="load-latest"]').click();
  await vi.waitFor(() => expect(field('title').value).toBe('別人的名字'));
  expect(host.querySelector('[data-conflict]')).toBeNull();
  handle = (c) => (c.method === 'PUT' ? ok(campaign({ version: 4 })) : undefined);
  $('[data-action="save-campaign"]').click();
  await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
  expect(calls.filter((c) => c.method === 'PUT')[1]!.body.expectedVersion).toBe(3);
});

it('activation that fails on a missing field marks that field', async () => {
  handle = (c) => (c.path === '/v1/moderation/campaigns/c1/status' ? { status: 400, body: { error: 'campaign_invalid', field: 'tiers.video' } } : undefined);
  await mount();
  $('[data-campaign="c1"] [data-action="edit"]').click();
  await vi.waitFor(() => expect(host.querySelector('[data-action="activate"]')).not.toBeNull());
  $('[data-action="activate"]').click();
  await confirm();
  await vi.waitFor(() => expect(field('tiers.video').getAttribute('aria-invalid')).toBe('true'));
  expect(field('tiers.light').getAttribute('aria-invalid')).not.toBe('true');
  expect($('[data-field-error="tiers.video"]').textContent).toContain(t('campaign.tier.video'));
});

it('retrying a confirmed status change after a failure reuses the same operation id; the next action gets a new one', async () => {
  let fail = true;
  handle = (c) => {
    if (c.path !== '/v1/moderation/campaigns/c1/status') return undefined;
    if (fail) { fail = false; return { status: 503, body: { error: 'unavailable' } }; }
    return ok(campaign({ status: c.body.status, version: c.body.status === 'active' ? 3 : 4 }));
  };
  await mount();
  $('[data-campaign="c1"] [data-action="edit"]').click();
  await vi.waitFor(() => expect(host.querySelector('[data-action="activate"]')).not.toBeNull());
  $('[data-action="activate"]').click();
  await confirm();
  await vi.waitFor(() => expect(statusCalls()).toHaveLength(1));
  await vi.waitFor(() => expect(host.querySelector('[data-campaign-form] [role=alert]')).not.toBeNull());
  $('[data-action="activate"]').click();
  await confirm();
  await vi.waitFor(() => expect(host.querySelector('[data-action="end"]')).not.toBeNull());
  const [first, second] = statusCalls();
  expect(second!.body).toEqual({ status: 'active', operationId: first!.body.operationId });

  $('[data-action="end"]').click();
  await confirm();
  await vi.waitFor(() => expect(statusCalls()).toHaveLength(3));
  expect(statusCalls()[2]!.body.status).toBe('ended');
  expect(statusCalls()[2]!.body.operationId).not.toBe(first!.body.operationId);
});

it('shows the platform settings read-only, or says the platform has not opened rewards yet', async () => {
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[data-pool]')).not.toBeNull());
  const shown = $('[data-pool]').textContent!;
  expect(shown).toContain(t('campaign.pool.usage.agent_only'));
  expect(shown).toContain(t('campaign.pool.forever'));
  expect(shown).toContain('5,000');
  expect(shown).toContain('120,000');
  app.unmount(); document.body.innerHTML = '';

  pool = { configured: false };
  await mount();
  await vi.waitFor(() => expect(host.querySelector('[data-pool-missing]')?.textContent).toContain(t('campaign.pool.notConfigured')));
});
