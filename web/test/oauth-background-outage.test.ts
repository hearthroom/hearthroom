import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { AuthUnavailable } from '../src/lib/oauth';
const fixture = vi.hoisted(() => ({ token: vi.fn(), opts: null as any, on: vi.fn() }));
vi.mock('../src/lib/session', () => ({ useSession: () => ({ ready: true, me: { accountNumId: 22 }, profile: null, accessToken: fixture.token }) }));
vi.mock('../src/lib/notifications', () => ({ useNotifications: () => ({ unread: 0 }), noticeText: () => '' }));
vi.mock('../src/lib/review', () => ({ useReviewer: () => ({}) }));
vi.mock('../src/pet/pet-ui', () => ({ SukiPet: class {
  constructor(opts: any) { fixture.opts = opts; }
  async start() {} stop() {} setGuide() {} tuckAside() {} setSkin() {}
  on = fixture.on;
} }));
import SukiPet from '../src/components/SukiPet.vue';
import NewcomerNudge from '../src/components/checkin/NewcomerNudge.vue';
let app: App | undefined, root: HTMLElement;
beforeEach(() => {
  fixture.token.mockReset().mockRejectedValue(new AuthUnavailable('synthetic disconnected refresh'));
  fixture.opts = null; fixture.on.mockClear();
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => { queueMicrotask(callback); return 1; });
  root = document.body.appendChild(document.createElement('div'));
});
afterEach(() => { app?.unmount(); root.remove(); vi.unstubAllGlobals(); });
async function mount(component: typeof SukiPet | typeof NewcomerNudge) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] });
  await router.push('/');
  app = createApp(component).use(createPinia()).use(router).use(i18n);
  const errors: unknown[] = [];
  app.config.errorHandler = error => errors.push(error);
  app.mount(root); return errors;
}
it('settles the optional newcomer prompt load when refresh is disconnected', async () => {
  const errors = await mount(NewcomerNudge);
  await vi.waitFor(() => expect(fixture.token).toHaveBeenCalled());
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(errors).toEqual([]);
});
it('catches a pet resume action and keeps recall optional on refresh failure', async () => {
  await mount(SukiPet);
  await vi.waitFor(() => expect(fixture.opts).not.toBeNull());
  fixture.opts.resume.run();
  await vi.waitFor(() => expect(fixture.on).toHaveBeenCalledWith({ type: 'hint', text: i18n.global.t('state.serverBusy') }));
  await expect(fixture.opts.enableRecall()).resolves.toBeUndefined();
});
