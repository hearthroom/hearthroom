/**
 * 社群管理的「部落格」：分頁只給 manager／owner；編輯器存檔撞版本不覆蓋、給兩條路；
 * 有沒存的修改離開會問；貼上圖片上傳後插進 Markdown；發布失敗重按沿用同一個操作編號。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import ConfirmDialog from '../src/components/ConfirmDialog.vue';

const mocks = vi.hoisted(() => ({ role: 'manager' as string }));
vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: { accountNumId: 7 }, profile: {}, ready: true, accessToken: async () => 'synthetic' }) }));
vi.mock('../src/lib/api', async (original) => {
  const real = await original<typeof import('../src/lib/api')>();
  return {
    ...real,
    fetchReviewMe: async () => ({ reviewer: true, pending: 0, reviews: 0, cases: 0, comments: 0, role: mocks.role }),
    fetchCommentQueue: async () => ({ total: 0, items: [] }),
    fetchCommentStats: async () => ({ held: 0, openReports: 0, removed7d: 0, medianHandleMs7d: null, holdReasons7d: {} }),
    fetchKeywords: async () => ({ items: [] }),
  };
});
import { router as siteRouter } from '../src/router';

const post = (over: Record<string, unknown> = {}) => ({
  id: 'p1', columnId: 'c1', columnSlug: 'news', slug: 'hello', locale: 'zh-Hant', title: '開站了', excerpt: '', coverUrl: null, bodyMd: '舊內容',
  shareTitle: null, shareDescription: null, shareCoverUrl: null, campaignId: null, status: 'draft', publishAt: null, firstPublishedAt: null,
  pinned: false, commentsClosed: false, pinnedCommentId: null, version: 3, createdAt: 1, updatedAt: 1, coverKey: null, shareCoverKey: null, authorHandle: 'ed', ...over,
});
type Call = { method: string; path: string; body: any };
let calls: Call[];
let handle: (c: Call) => { status: number; body: unknown } | undefined;
const ok = (body: unknown) => ({ status: 200, body });

let app: App, host: HTMLElement, router: Router;
async function mount(path: string) {
  host = document.body.appendChild(document.createElement('div'));
  router = createRouter({ history: createMemoryHistory(), routes: siteRouter.options.routes });
  await router.push(path);
  app = createApp({ render: () => [h(RouterView), h(ConfirmDialog)] }).use(createPinia()).use(router).use(i18n);
  app.mount(host);
}
const t = (k: string, p?: Record<string, unknown>) => i18n.global.t(k, p ?? {});
const settle = async () => { for (let i = 0; i < 6; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } };
const source = () => host.querySelector<HTMLTextAreaElement>('textarea[data-source]')!;
function type(el: HTMLTextAreaElement, value: string) { el.value = value; el.dispatchEvent(new Event('input')); }
const confirm = () => document.querySelector<HTMLButtonElement>('[role=alertdialog] [data-confirm]')!;

beforeEach(() => {
  i18n.global.locale.value = 'zh-Hant';
  mocks.role = 'manager';
  calls = [];
  handle = () => undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = url.split('?')[0]!;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const call = { method, path, body };
    calls.push(call);
    const custom = handle(call);
    const res = custom
      ?? (path === '/v1/blog/admin/posts/p1' && method === 'GET' ? ok(post())
        : path === '/v1/blog/admin/columns' ? ok({ items: [{ id: 'c1', slug: 'news', name: { 'zh-Hant': '公告' }, description: {}, sort: 0, enabled: true }] })
          : path === '/v1/blog/admin/posts/p1/revisions' ? ok({ items: [] })
            : path === '/v1/blog/admin/posts' ? ok({ total: 0, items: [] })
              : { status: 404, body: { error: 'not_found' } });
    return new Response(JSON.stringify(res.body), { status: res.status });
  }));
});
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

it('shows the blog tab only to managers and owners', async () => {
  mocks.role = 'reviewer';
  await mount('/review/comments');
  await settle();
  expect(host.querySelector('.management-nav a[href="/review/comments"]')).not.toBeNull();
  expect(host.querySelector('.management-nav a[href="/review/blog"]')).toBeNull();
  app.unmount(); document.body.innerHTML = '';

  mocks.role = 'owner';
  await mount('/review/comments');
  await vi.waitFor(() => expect(host.querySelector('.management-nav a[href="/review/blog"]')?.textContent?.trim()).toBe(t('moderation.tab.blog')));
});

it('a save that hits a version conflict keeps my text and offers load-latest or copy-mine', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  type(source(), '我的新內容'); await nextTick();
  handle = (c) => (c.method === 'PUT' ? { status: 409, body: { error: 'blog_version_conflict', version: 4 } } : undefined);
  host.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
  await vi.waitFor(() => expect(host.querySelector('[data-conflict]')).not.toBeNull());
  const put = calls.find((c) => c.method === 'PUT')!;
  expect(put.body).toMatchObject({ expectedVersion: 3, bodyMd: '我的新內容' });
  expect(host.querySelector('[data-conflict]')!.textContent).toContain(t('blog.admin.conflict'));
  expect(source().value).toBe('我的新內容');
  expect(host.querySelector('[data-action="load-latest"]')!.textContent).toContain(t('blog.admin.loadLatest'));

  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  host.querySelector<HTMLButtonElement>('[data-action="copy-mine"]')!.click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('我的新內容'));
  expect(source().value).toBe('我的新內容');

  handle = (c) => (c.method === 'GET' && c.path === '/v1/blog/admin/posts/p1' ? ok(post({ bodyMd: '別人的內容', version: 4 })) : undefined);
  host.querySelector<HTMLButtonElement>('[data-action="load-latest"]')!.click();
  await vi.waitFor(() => expect(source().value).toBe('別人的內容'));
  expect(host.querySelector('[data-conflict]')).toBeNull();
  handle = (c) => (c.method === 'PUT' ? ok(post({ bodyMd: c.body.bodyMd, version: 5 })) : undefined);
  type(source(), '再改一次'); await nextTick();
  host.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
  await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
  expect(calls.filter((c) => c.method === 'PUT')[1]!.body.expectedVersion).toBe(4);
});

it('asks before leaving with unsaved changes, both for in-app navigation and closing the tab', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  const clean = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);

  type(source(), '還沒存'); await nextTick();
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);

  const leaving = router.push('/review/blog');
  await vi.waitFor(() => expect(document.querySelector('[role=alertdialog]')?.textContent).toContain(t('blog.admin.unsaved')));
  document.querySelector<HTMLButtonElement>('[role=alertdialog] [data-cancel]')!.click();
  await leaving;
  expect(router.currentRoute.value.path).toBe('/review/blog/p1');
  expect(source().value).toBe('還沒存');
});

it('pasting an image uploads it and inserts Markdown at the cursor, with a placeholder while uploading', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  let finish: (v: { status: number; body: unknown }) => void = () => {};
  const pending = new Promise<{ status: number; body: unknown }>((r) => { finish = r; });
  vi.mocked(fetch).mockImplementationOnce(async (url, init) => {
    calls.push({ method: (init as RequestInit).method ?? 'GET', path: String(url), body: (init as RequestInit).body });
    const res = await pending;
    return new Response(JSON.stringify(res.body), { status: res.status });
  });
  const el = source();
  el.setSelectionRange(1, 1);
  const file = new File(['png'], 'shot.png', { type: 'image/png' });
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { files: [file], items: [], getData: () => '' } });
  el.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(source().value).toContain(t('blog.admin.uploading')));
  expect(host.querySelector<HTMLButtonElement>('[data-action="save"]')!.disabled).toBe(true);
  const upload = calls.find((c) => c.path === '/v1/blog/admin/images')!;
  expect(upload.method).toBe('POST');
  expect((upload.body as FormData).get('file')).toBeInstanceOf(File);
  finish(ok({ key: 'blog/abc.webp', url: '/v1/blog/images/abc.webp' }));
  await vi.waitFor(() => expect(source().value).toBe('舊![](/v1/blog/images/abc.webp)內容'));
});

it('when one of several pasted images fails, its placeholder goes with its line break', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  let n = 0;
  handle = (c) => (c.path === '/v1/blog/admin/images' ? (++n === 1 ? ok({ key: 'blog/a.webp', url: '/v1/blog/images/a.webp' }) : { status: 400, body: { error: 'blog_image_invalid' } }) : undefined);
  source().setSelectionRange(1, 1);
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  const png = (name: string) => new File(['x'], name, { type: 'image/png' });
  Object.defineProperty(paste, 'clipboardData', { value: { files: [png('a.png'), png('b.png')], items: [], getData: () => '' } });
  source().dispatchEvent(paste);
  await vi.waitFor(() => expect(host.textContent).toContain(t('blog.admin.uploadFailed')));
  await vi.waitFor(() => expect(source().value).toBe('舊![](/v1/blog/images/a.webp)內容'));
  expect(host.querySelector<HTMLButtonElement>('[data-action="save"]')!.disabled).toBe(false);
});

it('a failed image upload removes the placeholder and says so', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  handle = (c) => (c.path === '/v1/blog/admin/images' ? { status: 400, body: { error: 'blog_image_invalid' } } : undefined);
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { files: [new File(['x'], 'a.png', { type: 'image/png' })], items: [], getData: () => '' } });
  source().dispatchEvent(paste);
  await vi.waitFor(() => expect(host.textContent).toContain(t('blog.admin.uploadFailed')));
  expect(source().value).toBe('舊內容');
});

it('a publish retry after a failure reuses the same operation id, and takes the new version', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  let attempts = 0;
  handle = (c) => (c.path === '/v1/blog/admin/posts/p1/state' ? (++attempts === 1 ? { status: 503, body: { error: 'busy' } } : ok(post({ status: 'published', publishAt: 10, version: 4 }))) : undefined);
  const publish = () => host.querySelector<HTMLButtonElement>('[data-action="publish"]')!;
  publish().click();
  await vi.waitFor(() => expect(confirm()).not.toBeNull());
  confirm().click();
  await vi.waitFor(() => expect(attempts).toBe(1));
  await settle();
  publish().click();
  await vi.waitFor(() => expect(confirm()).not.toBeNull());
  confirm().click();
  await vi.waitFor(() => expect(attempts).toBe(2));
  const [first, second] = calls.filter((c) => c.path === '/v1/blog/admin/posts/p1/state');
  expect(first!.body).toEqual({ change: { status: 'published' }, operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(second!.body.operationId).toBe(first!.body.operationId);
  await vi.waitFor(() => expect(host.querySelector('[data-action="unpublish"]')).not.toBeNull());

  handle = (c) => (c.method === 'PUT' ? ok(post({ status: 'published', bodyMd: c.body.bodyMd, version: 5 })) : undefined);
  type(source(), '發布後再改'); await nextTick();
  host.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
  await vi.waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  expect(calls.find((c) => c.method === 'PUT')!.body.expectedVersion).toBe(4);
});

it('a state change that comes back with someone else\'s save does not become my save base', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  type(source(), 'A 的修改'); await nextTick();
  // B 已經存到第 4 版；A 置頂，回來的是第 5 版、內容是 B 的
  handle = (c) => c.path === '/v1/blog/admin/posts/p1/state' ? ok(post({ pinned: true, bodyMd: 'B 的內容', version: 5 }))
    : c.method === 'PUT' ? (c.body.expectedVersion === 5 ? ok(post({ bodyMd: c.body.bodyMd, version: 6 })) : { status: 409, body: { error: 'blog_version_conflict', version: 5 } })
      : undefined;
  host.querySelector<HTMLButtonElement>('[data-action="pin"]')!.click();
  await vi.waitFor(() => expect(confirm()).not.toBeNull());
  confirm().click();
  await vi.waitFor(() => expect(host.querySelector('[data-conflict]')).not.toBeNull());
  expect(host.querySelector('[data-action="pin"]')!.textContent).toContain(t('blog.admin.unpin'));
  expect(source().value).toBe('A 的修改');
  host.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
  await settle();
  expect(calls.filter((c) => c.method === 'PUT').every((c) => c.body.expectedVersion !== 5)).toBe(true);
  expect(host.querySelector('[data-conflict]')).not.toBeNull();
});

it('a replayed save that comes back with someone else\'s newer version does not become my save base while I typed more', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  type(source(), 'A 的第一版'); await nextTick();
  // 重送被認成同一次，回來的卻是 B 存的第 5 版；回應前 A 又打了字
  handle = (c) => {
    if (c.method !== 'PUT') return undefined;
    if (c.body.expectedVersion === 3) { type(source(), 'A 的第一版，又打了字'); return ok(post({ bodyMd: 'B 的內容', version: 5 })); }
    return c.body.expectedVersion === 5 ? ok(post({ bodyMd: c.body.bodyMd, version: 6 })) : { status: 409, body: { error: 'blog_version_conflict', version: 5 } };
  };
  host.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
  await vi.waitFor(() => expect(host.querySelector('[data-conflict]')).not.toBeNull());
  expect(source().value).toBe('A 的第一版，又打了字');
  host.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
  await settle();
  expect(calls.filter((c) => c.method === 'PUT').every((c) => c.body.expectedVersion !== 5)).toBe(true);
  expect(host.querySelector('[data-conflict]')).not.toBeNull();
});

it('after the first save of a new post, leaving with new edits still asks', async () => {
  handle = (c) => c.method === 'POST' && c.path === '/v1/blog/admin/posts' ? ok(post({ id: 'p9', title: c.body.title, slug: c.body.slug, bodyMd: c.body.bodyMd, version: 1 }))
    : c.path === '/v1/blog/admin/posts/p9/revisions' ? ok({ items: [] }) : undefined;
  await mount('/review/blog/new');
  await vi.waitFor(() => expect(source()).not.toBeNull());
  const title = host.querySelector<HTMLInputElement>('.bed-title')!;
  title.value = 'Hello'; title.dispatchEvent(new Event('input'));
  type(source(), '第一版'); await nextTick();
  host.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/review/blog/p9'));
  expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ title: 'Hello', slug: 'hello', bodyMd: '第一版' });
  type(source(), '第二版還沒存'); await nextTick();
  const leaving = router.push('/review/blog');
  await vi.waitFor(() => expect(document.querySelector('[role=alertdialog]')?.textContent).toContain(t('blog.admin.unsaved')));
  document.querySelector<HTMLButtonElement>('[role=alertdialog] [data-cancel]')!.click();
  await leaving;
  expect(router.currentRoute.value.path).toBe('/review/blog/p9');
  // 換到另一篇也要問
  const other = router.push('/review/blog/p1');
  await vi.waitFor(() => expect(document.querySelector('[role=alertdialog]')?.textContent).toContain(t('blog.admin.unsaved')));
  document.querySelector<HTMLButtonElement>('[role=alertdialog] [data-cancel]')!.click();
  await other;
  expect(router.currentRoute.value.path).toBe('/review/blog/p9');
});

it('a reviewer who is not a manager sees who the blog tab is for, not a raw error', async () => {
  handle = (c) => (c.path.startsWith('/v1/blog/admin/') || c.path === '/v1/blog/admin/posts' ? { status: 403, body: { error: 'blog_write_forbidden' } } : undefined);
  await mount('/review/blog');
  await vi.waitFor(() => expect(host.textContent).toContain(t('blog.admin.managersOnly')));
  expect(host.textContent).not.toContain('blog_write_forbidden');
  expect(host.querySelector('.rblog-columns')).toBeNull();
});
