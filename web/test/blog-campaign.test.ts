/**
 * 部落格的活動資訊：文章關聯了活動時，開頭與文末各一個區塊（狀態、活動期間用活動自己的時區、前往申請），點擊記 blog_cta；
 * 草稿活動不顯示；列表卡片的徽章三種狀態；編輯器的「關聯活動」是選單。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { formatPeriod } from '../src/lib/campaign';

const tracked = vi.hoisted(() => [] as { event: string; data: Record<string, unknown> }[]);
vi.mock('../src/lib/track', () => ({ track: (event: string, data: Record<string, unknown> = {}) => tracked.push({ event, data }), currentSurface: () => 'blog', setSurface: () => {} }));
vi.mock('../src/components/CommentPanel.vue', () => ({ default: defineComponent({ render: () => h('div') }) }));
vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: { accountNumId: 7 }, profile: {}, ready: true, accessToken: async () => 'synthetic' }) }));
vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  fetchReviewMe: async () => ({ reviewer: true, pending: 0, reviews: 0, cases: 0, comments: 0, role: 'manager' }),
}));

import BlogListPage from '../src/pages/BlogListPage.vue';
import BlogPostPage from '../src/pages/BlogPostPage.vue';
import { router as siteRouter } from '../src/router';

const brief = (phase: string) => ({ slug: 'launch', title: { 'zh-Hant': '開站分享', en: 'Launch sharing' }, phase, startsAt: Date.parse('2026-11-01T11:00Z'), endsAt: Date.parse('2026-11-30T14:59Z'), timezone: 'Asia/Tokyo' });
const card = (id: string, campaign: unknown = null) => ({
  id, columnSlug: 'news', slug: `post-${id}`, title: `標題 ${id}`, excerpt: '', coverUrl: null, locale: 'zh-Hant', firstPublishedAt: 1, pinned: false, readMinutes: 1, commentCount: 0, campaign,
});
const page = (campaign: unknown) => ({
  post: { ...card('p9', campaign), slug: 'hello', bodyMd: '內文', status: 'published', publishAt: 1, commentsClosed: false, pinnedCommentId: null, createdAt: 1, updatedAt: 1, contentUpdatedAt: 1, official: true, columnId: 'c1' },
  adjacent: { prev: null, next: null }, related: [],
});
const columns = { items: [{ id: 'c1', slug: 'news', name: { 'zh-Hant': '公告' }, description: {}, sort: 0, enabled: true }] };
type Call = { method: string; path: string; body: any };
let routes: Record<string, unknown>;
let calls: Call[];

let app: App, host: HTMLElement;
const settle = async () => { for (let i = 0; i < 6; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } };
async function mount(component: object, path: string, pattern: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: pattern, component: { render: () => null } }, { path: '/:p(.*)*', component: { render: () => null } }] });
  await router.push(path); await router.isReady();
  host = document.body.appendChild(document.createElement('div'));
  app = createApp(component).use(router).use(i18n);
  app.mount(host);
  await settle();
  return host;
}
const t = (k: string, v: Record<string, unknown> = {}) => i18n.global.t(k, v);

beforeEach(() => {
  i18n.global.locale.value = 'zh-Hant';
  tracked.length = 0;
  calls = [];
  routes = { '/v1/blog/columns': columns };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = url.split('?')[0]!;
    calls.push({ method, path, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    const body = routes[`${method} ${path}`] ?? (method === 'GET' ? routes[path] : undefined);
    return body === undefined ? new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
  }));
});
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

it('a post linked to a campaign shows a block at the top and the end, with the period in the campaign zone and an apply link', async () => {
  routes['/v1/blog/posts/news/hello'] = page(brief('open'));
  const root = await mount(BlogPostPage, '/en/blog/news/hello', '/:locale(en)?/blog/:column/:slug');
  const blocks = [...root.querySelectorAll('[data-campaign-block]')];
  expect(blocks.map((b) => b.getAttribute('data-campaign-block'))).toEqual(['top', 'end']);
  const head = root.querySelector('.blog-post__head')!;
  expect(head.compareDocumentPosition(blocks[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(root.querySelector('.blog-post__body')!.compareDocumentPosition(blocks[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // 期間照網址的語言（/en）排版、照活動的時區（東京）算：UTC 11:00 是東京晚上 8 點
  const period = formatPeriod(brief('open'), 'en');
  expect(period).toContain('Nov 1, 2026, 8:00');
  expect(period).toContain('Japan Standard Time');
  for (const b of blocks) {
    expect(b.textContent).toContain(t('campaign.phase.open'));
    expect(b.textContent).toContain('Launch sharing');
    expect(b.textContent).toContain(t('blog.campaign.period'));
    expect(b.textContent).toContain(period);
    const link = b.querySelector('a')!;
    expect(link.textContent?.trim()).toBe(t('blog.campaign.apply'));
    expect(link.getAttribute('href')).toBe('/en/campaign/launch');
  }
  (blocks[1]!.querySelector('a') as HTMLElement).click();
  await settle();
  expect(tracked.filter((e) => e.event === 'blog_cta')).toEqual([{ event: 'blog_cta', data: { subject: 'hello' } }]);
});

it('shows no block for a post without a campaign, or with a draft one', async () => {
  routes['/v1/blog/posts/news/hello'] = page(null);
  expect((await mount(BlogPostPage, '/blog/news/hello', '/blog/:column/:slug')).querySelector('[data-campaign-block]')).toBeNull();
  app.unmount(); host.remove();
  routes['/v1/blog/posts/news/hello'] = page(brief('draft'));
  const root = await mount(BlogPostPage, '/blog/news/hello', '/blog/:column/:slug');
  expect(root.querySelector('h1')!.textContent).toBe('標題 p9');
  expect(root.querySelector('[data-campaign-block]')).toBeNull();
});

it('list cards badge the campaign as upcoming, open or ended', async () => {
  routes['/v1/blog/posts'] = { total: 4, pinned: [], items: [card('a', brief('upcoming')), card('b', brief('open')), card('c', brief('ended')), card('d')] };
  const root = await mount(BlogListPage, '/blog', '/blog/:column?');
  const badge = (id: string) => root.querySelector(`a[href="/blog/news/post-${id}"] .post-card__badge`)?.textContent?.trim() ?? null;
  expect([badge('a'), badge('b'), badge('c'), badge('d')]).toEqual([t('campaign.phase.upcoming'), t('campaign.phase.open'), t('campaign.phase.ended'), null]);
});

it('the editor picks the linked campaign from a menu of campaigns', async () => {
  const post = {
    id: 'p1', columnId: 'c1', columnSlug: 'news', slug: 'hello', locale: 'zh-Hant', title: '開站了', excerpt: '', coverUrl: null, bodyMd: '內容',
    shareTitle: null, shareDescription: null, shareCoverUrl: null, campaignId: null, status: 'draft', publishAt: null, firstPublishedAt: null,
    pinned: false, commentsClosed: false, pinnedCommentId: null, version: 3, createdAt: 1, updatedAt: 1, coverKey: null, shareCoverKey: null, authorHandle: 'ed',
  };
  routes['/v1/blog/admin/posts/p1'] = post;
  routes['/v1/blog/admin/columns'] = columns;
  routes['/v1/blog/admin/posts/p1/revisions'] = { items: [] };
  routes['/v1/moderation/campaigns'] = { canEdit: false, items: [{ id: 'c-1', slug: 'launch', title: { 'zh-Hant': '開站分享' }, status: 'active' }, { id: 'c-2', slug: 'later', title: { 'zh-Hant': '冬季分享' }, status: 'draft' }] };
  routes['PUT /v1/blog/admin/posts/p1'] = { ...post, campaignId: 'c-1', version: 4 };
  host = document.body.appendChild(document.createElement('div'));
  const router = createRouter({ history: createMemoryHistory(), routes: siteRouter.options.routes });
  await router.push('/review/blog/p1');
  app = createApp({ render: () => h(RouterView) }).use(createPinia()).use(router).use(i18n);
  app.mount(host);
  const select = () => host.querySelector<HTMLSelectElement>('select[data-field="campaign"]');
  await vi.waitFor(() => expect(select()?.options.length).toBe(3));
  expect([...select()!.options].map((o) => o.value)).toEqual(['', 'c-1', 'c-2']);
  expect(select()!.options[0]!.textContent).toBe(t('blog.admin.noCampaign'));
  expect(select()!.options[2]!.textContent).toContain('冬季分享');
  expect(select()!.options[2]!.textContent).toContain(t('campaign.status.draft'));
  select()!.value = 'c-1';
  select()!.dispatchEvent(new Event('change'));
  await nextTick();
  host.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
  await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  expect(calls.find((c) => c.method === 'PUT')!.body.campaignId).toBe('c-1');
});
