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

const mocks = vi.hoisted(() => ({ role: 'manager' as string, reviewer: true, writer: true }));
vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: { accountNumId: 7 }, profile: {}, ready: true, accessToken: async () => 'synthetic' }) }));
vi.mock('../src/lib/api', async (original) => {
  const real = await original<typeof import('../src/lib/api')>();
  return {
    ...real,
    fetchReviewMe: async () => ({ reviewer: mocks.reviewer, pending: 0, reviews: 0, cases: 0, comments: 0, role: mocks.role, blogWriter: mocks.writer }),
    fetchCommentQueue: async () => ({ total: 0, items: [] }),
    fetchCommentStats: async () => ({ held: 0, openReports: 0, removed7d: 0, medianHandleMs7d: null, holdReasons7d: {} }),
    fetchKeywords: async () => ({ items: [] }),
  };
});
import { router as siteRouter } from '../src/router';
import { AUTOSAVE_MS } from '../src/lib/blog';

const post = (over: Record<string, unknown> = {}) => ({
  id: 'p1', columnId: 'c1', columnSlug: 'news', slug: 'hello', locale: 'zh-Hant', title: '開站了', excerpt: '', coverUrl: null, bodyMd: '舊內容',
  shareTitle: null, shareDescription: null, shareCoverUrl: null, campaignId: null, status: 'draft', publishAt: null, firstPublishedAt: null,
  pinned: false, commentsClosed: false, pinnedCommentId: null, version: 3, createdAt: 1, updatedAt: 1, coverKey: null, shareCoverKey: null, authorHandle: 'ed', ...over,
});
type Call = { method: string; path: string; body: any };
let calls: Call[];
let handle: (c: Call) => { status: number; body: unknown; wait?: Promise<void> } | undefined;
const ok = (body: unknown) => ({ status: 200, body });
const tree = () => ({ items: [
  { id: 'g1', slug: 'official', name: { 'zh-Hant': '官方消息' }, description: {}, sort: 0, enabled: true, parentId: null, postCount: 3,
    columns: [{ id: 'c1', slug: 'news', name: { 'zh-Hant': '公告' }, description: {}, sort: 0, enabled: true, parentId: 'g1', postCount: 3 }] },
] });

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
/** 只存不發：⌘S（草稿的主按鈕是「發布」） */
const saveNow = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }));

beforeEach(() => {
  i18n.global.locale.value = 'zh-Hant';
  mocks.role = 'manager'; mocks.reviewer = true; mocks.writer = true;
  calls = [];
  handle = () => undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = url.split('?')[0]!;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const call = { method, path, body };
    calls.push(call);
    const custom = handle(call);
    if (custom?.wait) await custom.wait;
    const res = custom
      ?? (path === '/v1/blog/admin/posts/p1' && method === 'GET' ? ok(post())
        : path === '/v1/blog/admin/columns' ? ok(tree())
          : path === '/v1/blog/admin/posts/p1/revisions' ? ok({ items: [] })
            : path === '/v1/blog/admin/translation-groups' ? ok({ total: 0, items: [] })
              : { status: 404, body: { error: 'not_found' } });
    return new Response(JSON.stringify(res.body), { status: res.status });
  }));
});
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

it('shows the blog tab to app owners and admins, whatever their review role', async () => {
  mocks.role = 'owner'; mocks.writer = false;
  await mount('/review/comments');
  await settle();
  expect(host.querySelector('.management-nav a[href="/review/comments"]')).not.toBeNull();
  expect(host.querySelector('.management-nav a[href="/review/blog"]')).toBeNull();
  app.unmount(); document.body.innerHTML = '';

  mocks.role = 'reviewer'; mocks.writer = true;
  await mount('/review/comments');
  await vi.waitFor(() => expect(host.querySelector('.management-nav a[href="/review/blog"]')?.textContent?.trim()).toBe(t('moderation.tab.blog')));
});

it('an app admin who is not a reviewer sees only the blog tab', async () => {
  mocks.reviewer = false; mocks.writer = true;
  await mount('/review/blog');
  await vi.waitFor(() => expect(host.querySelector('.management-nav a[href="/review/blog"]')).not.toBeNull());
  expect(host.querySelectorAll('.management-nav a')).toHaveLength(1);
});

it('a save that hits a version conflict keeps my text and offers load-latest or copy-mine', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  type(source(), '我的新內容'); await nextTick();
  handle = (c) => (c.method === 'PUT' ? { status: 409, body: { error: 'blog_version_conflict', version: 4 } } : undefined);
  saveNow();
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
  saveNow();
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
  expect(host.querySelector<HTMLButtonElement>('[data-action="primary"]')!.disabled).toBe(true);
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
  expect(host.querySelector<HTMLButtonElement>('[data-action="primary"]')!.disabled).toBe(false);
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
  const publish = () => host.querySelector<HTMLButtonElement>('[data-action="primary"]')!;
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
  await vi.waitFor(() => expect(host.querySelector('[data-action="primary"]')!.textContent?.trim()).toBe(t('blog.admin.update')));

  handle = (c) => (c.method === 'PUT' ? ok(post({ status: 'published', bodyMd: c.body.bodyMd, version: 5 })) : undefined);
  type(source(), '發布後再改'); await nextTick();
  saveNow();
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
  saveNow();
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
  saveNow();
  await vi.waitFor(() => expect(host.querySelector('[data-conflict]')).not.toBeNull());
  expect(source().value).toBe('A 的第一版，又打了字');
  saveNow();
  await settle();
  expect(calls.filter((c) => c.method === 'PUT').every((c) => c.body.expectedVersion !== 5)).toBe(true);
  expect(host.querySelector('[data-conflict]')).not.toBeNull();
});

it('after the first save of a new post, leaving with new edits still asks', async () => {
  handle = (c) => c.method === 'POST' && c.path === '/v1/blog/admin/posts' ? ok(post({ id: 'p9', title: c.body.title, slug: c.body.slug, bodyMd: c.body.bodyMd, version: 1 }))
    : c.path === '/v1/blog/admin/posts/p9/revisions' ? ok({ items: [] }) : undefined;
  await mount('/review/blog/new?column=c1');
  await vi.waitFor(() => expect(source()).not.toBeNull());
  const title = host.querySelector<HTMLInputElement>('.bed-title')!;
  title.value = 'Hello'; title.dispatchEvent(new Event('input'));
  type(source(), '第一版'); await nextTick();
  saveNow();
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

it('someone who is not an app owner or admin sees who the blog is for, not a raw error', async () => {
  handle = (c) => (c.path.startsWith('/v1/blog/admin/') || c.path === '/v1/blog/admin/posts' ? { status: 403, body: { error: 'blog_write_forbidden' } } : undefined);
  await mount('/review/blog');
  await vi.waitFor(() => expect(host.textContent).toContain(t('blog.admin.managersOnly')));
  expect(host.textContent).not.toContain('blog_write_forbidden');
  expect(host.querySelector('.rblog-columns')).toBeNull();
});

it('restoring a revision says readers see it at once when the post is live, and only that it is saved otherwise', async () => {
  const revision = { id: 'r1', editorHandle: 'ed', title: '開站了', bodyMd: '更舊的內容', createdAt: 1 };
  const restoreMessage = async (live: boolean) => {
    handle = (c) => c.path === '/v1/blog/admin/posts/p1' && c.method === 'GET' ? ok(post(live ? { status: 'published', publishAt: 1, firstPublishedAt: 1 } : {}))
      : c.path === '/v1/blog/admin/posts/p1/revisions' ? ok({ items: [revision] })
        : c.path === '/v1/blog/admin/posts/p1/revisions/r1' ? ok(revision) : undefined;
    await mount('/review/blog/p1');
    await vi.waitFor(() => expect(host.querySelector('[data-action="open-revisions"]')).not.toBeNull());
    host.querySelector<HTMLButtonElement>('[data-action="open-revisions"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.bed-rev')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.bed-rev')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-action="restore"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-action="restore"]')!.click();
    await vi.waitFor(() => expect(confirm()).not.toBeNull());
    const text = document.querySelector('[role=alertdialog]')!.textContent;
    app.unmount(); document.body.innerHTML = '';
    return text;
  };
  expect(await restoreMessage(true)).toContain(t('blog.admin.restoreConfirmLive'));
  expect(await restoreMessage(false)).toContain(t('blog.admin.restoreConfirm'));
});

const postListUrls = () => (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]).filter((u) => u.startsWith('/v1/blog/admin/translation-groups?'));

it('lists groups and columns with post counts on the left, and filters posts by what is picked', async () => {
  await mount('/review/blog');
  await vi.waitFor(() => expect(host.querySelector('[data-pick="column:news"]')).not.toBeNull());
  expect(host.querySelector('[data-pick="all"]')!.textContent).toContain('3');
  expect(host.querySelector('[data-pick="group:official"]')!.textContent).toContain('官方消息');
  host.querySelector<HTMLButtonElement>('[data-pick="column:news"]')!.click();
  await vi.waitFor(() => expect(postListUrls().pop()).toContain('column=c1'));
  await settle();
  expect(host.querySelector<HTMLAnchorElement>('[data-action="new-post"]')!.getAttribute('href')).toBe('/review/blog/new?column=c1');
  host.querySelector<HTMLButtonElement>('[data-pick="group:official"]')!.click();
  await vi.waitFor(() => expect(postListUrls().pop()).toContain('group=g1'));
  await settle();
  expect(host.querySelector<HTMLAnchorElement>('[data-action="new-post"]')!.getAttribute('href')).toBe('/review/blog/new');
});

it('with no columns yet, new post is disabled and says to create a group and a column first', async () => {
  handle = (c) => (c.path === '/v1/blog/admin/columns' ? ok({ items: [] }) : undefined);
  await mount('/review/blog');
  await vi.waitFor(() => expect(host.textContent).toContain(t('blog.admin.noGroups')));
  expect(host.querySelector('[data-action="new-post"]')!.getAttribute('aria-disabled')).toBe('true');
  expect(host.textContent).toContain(t('blog.admin.needColumn'));
});

it('creates a group, then a column inside it, through the dialog', async () => {
  await mount('/review/blog');
  await vi.waitFor(() => expect(host.querySelector('[data-add-column="official"]')).not.toBeNull());
  host.querySelector<HTMLButtonElement>('[data-action="new-group"]')!.click();
  await settle();
  const dialog = () => document.querySelector('[role=dialog]')!;
  const fill = (sel: string, value: string) => { const el = dialog().querySelector<HTMLInputElement>(sel)!; el.value = value; el.dispatchEvent(new Event('input')); };
  expect(dialog().querySelector('[data-field="parent"]')).toBeNull();
  fill('[data-name="zh-Hant"]', '創作指南'); fill('[data-field="slug"]', 'creators');
  handle = (c) => (c.path === '/v1/blog/admin/columns' && c.method === 'POST' ? ok({ id: 'new', ...c.body }) : undefined);
  dialog().querySelector<HTMLButtonElement>('[data-action="save-column"]')!.click();
  await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/blog/admin/columns')).toBe(true));
  expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ slug: 'creators', parentId: null, name: { 'zh-Hant': '創作指南' } });
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());

  host.querySelector<HTMLButtonElement>('[data-add-column="official"]')!.click();
  await settle();
  expect(dialog().querySelector<HTMLSelectElement>('[data-field="parent"]')!.value).toBe('g1');
  fill('[data-name="zh-Hant"]', '活動'); fill('[data-field="slug"]', 'events');
  dialog().querySelector<HTMLButtonElement>('[data-action="save-column"]')!.click();
  await vi.waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.path === '/v1/blog/admin/columns')).toHaveLength(2));
  expect(calls.filter((c) => c.method === 'POST').pop()!.body).toMatchObject({ slug: 'events', parentId: 'g1' });
});

it('deleting a column that still has posts says why it cannot be deleted', async () => {
  await mount('/review/blog');
  await vi.waitFor(() => expect(host.querySelector('[data-menu="news"]')).not.toBeNull());
  handle = (c) => (c.method === 'DELETE' ? { status: 409, body: { error: 'blog_column_not_empty' } } : undefined);
  host.querySelector<HTMLElement>('[data-menu="news"] [data-action="delete"]')!.click();
  await vi.waitFor(() => expect(confirm()).not.toBeNull());
  confirm().click();
  await vi.waitFor(() => expect(host.textContent).toContain(t('blog.admin.columnNotEmpty')));
});

it('shows the primary action that fits the post: publish for a draft, update once it is live', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(host.querySelector('[data-action="primary"]')?.textContent?.trim()).toBe(t('blog.admin.publish')));
  app.unmount(); document.body.innerHTML = '';
  handle = (c) => (c.path === '/v1/blog/admin/posts/p1' && c.method === 'GET' ? ok(post({ status: 'published', publishAt: 1, firstPublishedAt: 1 })) : undefined);
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(host.querySelector('[data-action="primary"]')?.textContent?.trim()).toBe(t('blog.admin.update')));
  host.querySelector<HTMLElement>('[data-action="publish-menu"]')!.click();
  expect(host.querySelector('[data-action="unpublish"]')).not.toBeNull();
});

it('a new post preselects the column from the link only when it is a real column', async () => {
  await mount('/review/blog/new?column=c1');
  await vi.waitFor(() => expect(host.querySelector<HTMLSelectElement>('#bed-f-columnId')?.value).toBe('c1'));
  app.unmount(); document.body.innerHTML = '';
  await mount('/review/blog/new?column=g1');
  await vi.waitFor(() => expect(host.querySelector('#bed-f-columnId')).not.toBeNull());
  expect(host.querySelector<HTMLSelectElement>('#bed-f-columnId')!.value).toBe('');
});

it('the column picker only offers columns, grouped under their group', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(host.querySelector('#bed-f-columnId optgroup')).not.toBeNull());
  const group = host.querySelector('#bed-f-columnId optgroup')!;
  expect(group.getAttribute('label')).toBe('官方消息');
  expect([...group.querySelectorAll('option')].map((o) => o.value)).toEqual(['c1']);
});

it('publishing with a missing field sends nothing and marks the field', async () => {
  handle = (c) => (c.path === '/v1/blog/admin/posts/p1' && c.method === 'GET' ? ok(post({ slug: '' })) : undefined);
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(host.querySelector('[data-action="primary"]')).not.toBeNull());
  await settle();
  host.querySelector<HTMLButtonElement>('[data-action="primary"]')!.click();
  await settle();
  expect(calls.some((c) => c.method !== 'GET')).toBe(false);
  expect(host.querySelector('#bed-f-slug')!.getAttribute('aria-invalid')).toBe('true');
});

it('saving into a column someone just deleted says to check the column', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  handle = (c) => (c.method === 'PUT' ? { status: 400, body: { error: 'blog_invalid', field: 'columnId' } } : undefined);
  type(source(), '改一下'); await nextTick();
  saveNow();
  await vi.waitFor(() => expect(host.textContent).toContain(t('blog.admin.invalid', { field: t('blog.admin.columns') })));
});

it('revisions open in a drawer from the settings column', async () => {
  handle = (c) => (c.path === '/v1/blog/admin/posts/p1/revisions' ? ok({ items: [{ id: 'r1', editorHandle: 'ed', title: '開站了', createdAt: 1 }] }) : undefined);
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(host.querySelector('[data-action="open-revisions"]')).not.toBeNull());
  expect(document.querySelector('.bed-rev')).toBeNull();
  host.querySelector<HTMLButtonElement>('[data-action="open-revisions"]')!.click();
  await settle();
  expect(document.querySelector('[role=dialog] .bed-rev')).not.toBeNull();
});

it('saves a draft on its own after a pause in typing', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    handle = (c) => (c.method === 'PUT' ? ok(post({ bodyMd: c.body.bodyMd, version: 4 })) : undefined);
    type(source(), '新的內容'); await nextTick();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 100);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(0);
    const state = host.querySelector('[data-save-state]')!.textContent!.trim();
    expect(state).not.toBe('');
    expect(state).not.toContain(t('blog.admin.unsavedShort'));
    expect(state).not.toContain(t('blog.admin.saving'));
  } finally { vi.useRealTimers(); }
});

it('never saves a live post on its own; update does', async () => {
  handle = (c) => (c.path === '/v1/blog/admin/posts/p1' && c.method === 'GET' ? ok(post({ status: 'published', publishAt: 1, firstPublishedAt: 1 }))
    : c.method === 'PUT' ? ok(post({ status: 'published', publishAt: 1, firstPublishedAt: 1, bodyMd: c.body.bodyMd, version: 4 })) : undefined);
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    type(source(), '公開後再改'); await nextTick();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(host.querySelector('[data-save-state]')!.textContent).toContain(t('blog.admin.unsavedShort'));
  } finally { vi.useRealTimers(); }
  host.querySelector<HTMLButtonElement>('[data-action="primary"]')!.click();
  await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
});

it('an autosave that hits someone else\'s save stops and shows the conflict, without retrying', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    handle = (c) => (c.method === 'PUT' ? { status: 409, body: { error: 'blog_version_conflict', version: 9 } } : undefined);
    type(source(), 'A 的修改'); await nextTick();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 100);
    await vi.waitFor(() => expect(host.querySelector('[data-conflict]')).not.toBeNull());
    type(source(), 'A 又改了'); await nextTick();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 3);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

it('publishing while an autosave is in flight waits for it and saves only once', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  let release!: () => void;
  handle = (c) => {
    if (c.method === 'PUT') return { status: 200, body: post({ bodyMd: c.body.bodyMd, version: 4 }), wait: new Promise<void>((r) => { release = r; }) };
    if (c.path === '/v1/blog/admin/posts/p1/state') return ok(post({ bodyMd: '新的', status: 'published', publishAt: 1, version: 5 }));
    return undefined;
  };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    type(source(), '新的'); await nextTick();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 10);
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
  } finally { vi.useRealTimers(); }
  expect(host.querySelector<HTMLButtonElement>('[data-action="primary"]')!.disabled).toBe(true);
  release();
  await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('[data-action="primary"]')!.disabled).toBe(false));
  host.querySelector<HTMLButtonElement>('[data-action="primary"]')!.click();
  await vi.waitFor(() => expect(confirm()).not.toBeNull());
  confirm().click();
  await vi.waitFor(() => expect(calls.some((c) => c.path === '/v1/blog/admin/posts/p1/state')).toBe(true));
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  expect(calls.find((c) => c.path === '/v1/blog/admin/posts/p1/state')!.body.change).toEqual({ status: 'published' });
});

it('the toolbar wraps the selection in bold and the shortcut does the same', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  source().setSelectionRange(0, 1);
  host.querySelector<HTMLButtonElement>('[data-md="bold"]')!.click();
  await nextTick();
  expect(source().value).toBe('**舊**內容');
  source().setSelectionRange(source().value.length - 2, source().value.length);
  source().dispatchEvent(new KeyboardEvent('keydown', { key: 'i', metaKey: true, bubbles: true }));
  await nextTick();
  expect(source().value).toBe('**舊***內容*');
});

it('an autosave the server refuses (taken address) says why and waits for an edit before trying again', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    handle = (c) => (c.method === 'PUT' ? { status: 409, body: { error: 'blog_slug_taken' } } : undefined);
    type(source(), '改一下'); await nextTick();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 100);
    await vi.waitFor(() => expect(host.textContent).toContain(t('blog.admin.slugTaken')));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 3);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    handle = (c) => (c.method === 'PUT' ? ok(post({ bodyMd: c.body.bodyMd, version: 4 })) : undefined);
    type(source(), '改一下，再改'); await nextTick();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 100);
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
  } finally { vi.useRealTimers(); }
});

it('publish now from the menu while an autosave is in flight waits for it, then asks to publish', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  let release!: () => void;
  handle = (c) => {
    if (c.method === 'PUT') return { status: 200, body: post({ bodyMd: c.body.bodyMd, version: 4 }), wait: new Promise<void>((r) => { release = r; }) };
    if (c.path === '/v1/blog/admin/posts/p1/state') return ok(post({ bodyMd: '新的', status: 'published', publishAt: 1, version: 5 }));
    return undefined;
  };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    type(source(), '新的'); await nextTick();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 10);
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
  } finally { vi.useRealTimers(); }
  host.querySelector<HTMLElement>('[data-action="publish-menu"]')!.click();
  host.querySelector<HTMLButtonElement>('[data-action="publish-now"]')!.click();
  await settle();
  release();
  await vi.waitFor(() => expect(confirm()).not.toBeNull());
  confirm().click();
  await vi.waitFor(() => expect(calls.some((c) => c.path === '/v1/blog/admin/posts/p1/state')).toBe(true));
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
});

it('a new post keeps its address following the title after the first autosave, until the address is edited', async () => {
  let n = 0;
  handle = (c) => c.method === 'POST' && c.path === '/v1/blog/admin/posts' ? ok(post({ id: 'p9', title: c.body.title, slug: c.body.slug, bodyMd: c.body.bodyMd, version: ++n }))
    : c.method === 'PUT' ? ok(post({ id: 'p9', title: c.body.title, slug: c.body.slug, bodyMd: c.body.bodyMd, version: ++n }))
      : c.path === '/v1/blog/admin/posts/p9/revisions' ? ok({ items: [] }) : undefined;
  await mount('/review/blog/new?column=c1');
  await vi.waitFor(() => expect(source()).not.toBeNull());
  const title = host.querySelector<HTMLInputElement>('#bed-f-title')!;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    title.value = 'Hello'; title.dispatchEvent(new Event('input')); await nextTick();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 10);
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/blog/admin/posts')).toBe(true));
    await vi.advanceTimersByTimeAsync(0);
    title.value = 'Hello world'; title.dispatchEvent(new Event('input')); await nextTick();
    expect(host.querySelector<HTMLInputElement>('#bed-f-slug')!.value).toBe('hello-world');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 10);
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ slug: 'hello-world', autosave: true });
    const slug = host.querySelector<HTMLInputElement>('#bed-f-slug')!;
    slug.value = 'mine'; slug.dispatchEvent(new Event('input')); await nextTick();
    title.value = 'Hello again'; title.dispatchEvent(new Event('input')); await nextTick();
    expect(slug.value).toBe('mine');
  } finally { vi.useRealTimers(); }
});

it('a manual save is not marked as an autosave', async () => {
  await mount('/review/blog/p1');
  await vi.waitFor(() => expect(source()?.value).toBe('舊內容'));
  handle = (c) => (c.method === 'PUT' ? ok(post({ bodyMd: c.body.bodyMd, version: 4 })) : undefined);
  type(source(), '手動'); await nextTick();
  saveNow();
  await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
  expect(calls.find((c) => c.method === 'PUT')!.body.autosave).toBeUndefined();
});

it('leaving while a new post\'s first autosave is in flight does not pull you back or save again', async () => {
  let release!: () => void;
  handle = (c) => c.method === 'POST' && c.path === '/v1/blog/admin/posts' ? { status: 200, body: post({ id: 'p9', title: c.body.title, slug: c.body.slug, bodyMd: c.body.bodyMd, version: 1 }), wait: new Promise<void>((r) => { release = r; }) }
    : c.path === '/v1/blog/admin/posts/p9/revisions' ? ok({ items: [] }) : undefined;
  await mount('/review/blog/new?column=c1');
  await vi.waitFor(() => expect(source()).not.toBeNull());
  const title = host.querySelector<HTMLInputElement>('#bed-f-title')!;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    title.value = 'Hello'; title.dispatchEvent(new Event('input')); await nextTick();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 10);
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/blog/admin/posts')).toBe(true));
  } finally { vi.useRealTimers(); }
  type(source(), '還沒存的字'); await nextTick();
  const leaving = router.push('/review/blog');
  await vi.waitFor(() => expect(confirm()).not.toBeNull());
  confirm().click();
  await leaving;
  expect(router.currentRoute.value.path).toBe('/review/blog');
  release();
  await settle(); await new Promise((r) => setTimeout(r, AUTOSAVE_MS + 200)); await settle();
  expect(router.currentRoute.value.path).toBe('/review/blog');
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
}, 10_000);

it('each post in the list shows its reader counts: views, likes and comments', async () => {
  const row = { id: 'p1', columnId: 'c1', columnSlug: 'news', slug: 'hello', locale: 'zh-Hant', title: '開站了', status: 'published', publishAt: 1, firstPublishedAt: 1,
    pinned: false, commentsClosed: false, version: 3, updatedAt: 1, authorHandle: 'ed', editorHandle: 'ed', viewCount: 1234, likeCount: 5, commentCount: 2 };
  handle = (c) => (c.path === '/v1/blog/admin/translation-groups' ? ok({ total: 1, items: [{id:'tg',title:row.title,columnId:row.columnId,sourceLocale:row.locale,version:1,versions:[row]}] }) : undefined);
  await mount('/review/blog');
  await vi.waitFor(() => expect(host.querySelector('[data-post="p1"] [data-stats]')).not.toBeNull());
  const stats = [...host.querySelectorAll('[data-post="p1"] [data-stats] > span')];
  const fmt = (n: number) => new Intl.NumberFormat('zh-Hant').format(n);
  // 畫面上是數字（讀屏略過），讀屏唸的是隱藏的完整說法：generic span 上的 aria-label 讀屏不唸
  expect(stats.map((s) => s.querySelector('[aria-hidden="true"]:not(svg)')!.textContent!.trim())).toEqual([fmt(1234), '5', '2']);
  expect(stats.map((s) => s.querySelector('.sr-only')!.textContent!.trim())).toEqual([
    t('blog.admin.statViews', { n: fmt(1234) }), t('blog.admin.statLikes', { n: '5' }), t('blog.admin.statComments', { n: '2' }),
  ]);
});
it('prefills a new translation without publishing or creating it, then saves into the source group',async()=>{
 handle=c=>c.path==='/v1/blog/admin/posts'&&c.method==='POST'?ok(post({id:'en1',locale:'en',slug:'hello-en',version:1,translationGroupId:'g',groupVersion:2,sourceLocale:'zh-Hant'})):undefined;
 await mount('/review/blog/new?translationOf=p1&language=en');await settle();
 expect(source().value).toBe('舊內容');expect(host.textContent).toContain(t('blog.admin.translationDraftHint'));
 expect(calls.filter(c=>c.method==='POST')).toHaveLength(0);
 saveNow();await settle();
 expect(calls.find(c=>c.method==='POST'&&c.path==='/v1/blog/admin/posts')?.body).toMatchObject({translationOfPostId:'p1',locale:'en'});
 expect(calls.filter(c=>c.path.endsWith('/state'))).toHaveLength(0);
});
it('locks formerly public URL fields after unpublishing',async()=>{
 handle=c=>c.path==='/v1/blog/admin/posts/p1'&&c.method==='GET'?ok(post({status:'unpublished',wasPublic:true,translationGroupId:'g',groupVersion:1,sourceLocale:'zh-Hant',translations:[]})):undefined;
 await mount('/review/blog/p1');await settle();
 expect(host.querySelector<HTMLInputElement>('#bed-f-slug')?.disabled).toBe(true);
 expect(host.querySelector<HTMLSelectElement>('#bed-f-columnId')?.disabled).toBe(true);
 expect(host.textContent).toContain(t('blog.admin.permalinkLocked'));
});
it('lists each translation group once, with independent language/status links',async()=>{
 handle=c=>c.path==='/v1/blog/admin/translation-groups'?ok({total:1,items:[{id:'tg',sourceLocale:'zh-Hant',version:2,title:'同一篇',columnId:'c1',versions:[{...post(),id:'p1'},{...post(),id:'p2',locale:'en',status:'unpublished'}]}]}):undefined;
 await mount('/review/blog');await settle();
 expect(host.querySelectorAll('[data-translation-group]')).toHaveLength(1);
 expect(host.querySelector('a[href="/review/blog/p1"]')).not.toBeNull();expect(host.querySelector('a[href="/review/blog/p2"]')).not.toBeNull();
});
