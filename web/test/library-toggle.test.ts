import { createApp, nextTick, type App } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { i18n } from '../src/lib/i18n';
const f = vi.hoisted(() => ({ request: vi.fn(), route: { fullPath: '/cards/a' }, push: vi.fn(), session: { me: { accountNumId: 1 }, accessToken: async () => 'qa' } }));
vi.mock('../src/lib/library', () => ({ libraryRequest: f.request }));
vi.mock('../src/lib/session', () => ({ useSession: () => f.session }));
vi.mock('../src/lib/use-locale', () => ({ useLocalePath: () => ({ lp: (s: string) => s }) }));
vi.mock('vue-router', () => ({ useRoute: () => f.route, useRouter: () => ({ push: f.push }) }));
import LibraryToggle from '../src/components/LibraryToggle.vue';
let app: App, el: HTMLDivElement;
const settle = async () => { await nextTick(); await new Promise(r => setTimeout(r, 0)); };
beforeEach(() => { vi.clearAllMocks(); el = document.createElement('div'); document.body.append(el); });
afterEach(() => { app?.unmount(); el.remove(); });
it('keeps the saved state on failed removal and lets the user retry', async () => {
 f.request.mockResolvedValueOnce({ active: true }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ active: false });
 app = createApp(LibraryToggle, { kind: 'favorites', target: 'a' }).use(i18n); app.mount(el); await settle();
 const button = el.querySelector('button')!; expect(button.getAttribute('aria-pressed')).toBe('true');
 button.click(); await settle(); expect(button.getAttribute('aria-pressed')).toBe('true'); expect(el.querySelector('[role=alert]')).not.toBeNull();
 button.click(); await settle(); expect(button.getAttribute('aria-pressed')).toBe('false'); expect(f.request.mock.calls[2][2]).toBe('DELETE');
});
it('blocks repeated writes while saving', async () => {
 let finish!: (value: unknown) => void;
 f.request.mockResolvedValueOnce({ active: false }).mockImplementationOnce(() => new Promise(r => { finish = r; }));
 app = createApp(LibraryToggle, { kind: 'following', target: 'qaauthor' }).use(i18n); app.mount(el); await settle();
 const button = el.querySelector('button')!; button.click(); await settle(); expect(button.disabled).toBe(true); button.click(); expect(f.request).toHaveBeenCalledTimes(2);
 finish({ active: true }); await settle(); expect(button.disabled).toBe(false); expect(button.getAttribute('aria-pressed')).toBe('true');
});
