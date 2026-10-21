import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { createApp, h, nextTick, type App } from 'vue';
import { resetManagedAuthForTest } from '../src/lib/managed-auth';
import { useSession } from '../src/lib/session';
vi.mock('../src/pages/MePage.vue', () => ({ default: { template: '<div>profile</div>' } }));
vi.mock('../src/pages/MyCardsPage.vue', () => ({ default: { template: '<div>cards</div>' } }));
vi.mock('../src/pages/LoginPage.vue', () => ({ default: { template: '<div>login</div>' } }));
import { router } from '../src/router';
import SessionConnectionGate from '../src/components/SessionConnectionGate.vue';
import { i18n } from '../src/lib/i18n';

let app: App | null = null;
let element: HTMLElement | null = null;
function mountGate() {
  element = document.createElement('div'); document.body.append(element);
  app = createApp({ render: () => h(SessionConnectionGate, null, { default: () => h('div', { 'data-private-page': '' }, 'private content') }) });
  app.use(getActivePinia()!).use(router).use(i18n).mount(element);
  return element;
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  setActivePinia(createPinia()); resetManagedAuthForTest(false);
  localStorage.setItem('hearthroom.provider', 'harbor');
  localStorage.setItem('hearthroom.oauth.access.harbor', JSON.stringify({ accessToken: 'synthetic-token', expiresAt: Date.now() + 3_600_000 }));
});
afterEach(() => { app?.unmount(); app = null; element?.remove(); element = null; vi.unstubAllGlobals(); });

it.each(['/me', '/mine'])('keeps the requested %s URL when proxy availability cannot confirm identity', async path => {
  localStorage.setItem('hearthroom.signedIn', '22');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'temporarily_unavailable' }, { status: 503 })));
  await router.push('/');
  await router.push(path);
  await useSession().restore();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(router.currentRoute.value.path).toBe(path);
});

it('still sends an explicitly rejected credential to login', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unauthorized' }, { status: 401 })));
  await router.push('/');
  await router.push('/me');
  expect(router.currentRoute.value.path).toBe('/login');
});

it.each(['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko'])('shows a retryable connection error in %s and recovers on the original page', async locale => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'temporarily_unavailable' }, { status: 503 })));
  await router.push('/');
  const path = locale === 'zh-Hant' ? '/me' : `/${locale}/me`;
  await router.push(path);
  const root = mountGate();
  expect(root.querySelector('[role="alert"]')?.textContent).toContain(i18n.global.t('state.serverBusy'));
  expect(root.querySelector('button')?.textContent).toBe(i18n.global.t('linked.retry'));
  expect(root.querySelector('[data-private-page]')).toBeNull();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/open/v1/me') ? { accountNumId: 22, nickName: 'fixture' } : {})));
  root.querySelector('button')!.click();
  await vi.waitFor(() => expect(root.querySelector('[data-private-page]')).not.toBeNull());
  expect(root.querySelector('[role="alert"]')).toBeNull();
  expect(router.currentRoute.value.path).toBe(path);
  expect(useSession().me?.accountNumId).toBe(22);
});

it('goes to login only when a retry explicitly rejects the saved credential', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'temporarily_unavailable' }, { status: 503 })));
  await router.push('/'); await router.push('/me');
  const root = mountGate();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unauthorized' }, { status: 401 })));
  root.querySelector('button')!.click();
  await nextTick();
  expect(root.querySelector('button')?.disabled).toBe(true);
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/login'));
  expect(router.currentRoute.value.query.returnTo).toBe('/me');
});
