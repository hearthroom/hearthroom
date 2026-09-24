import { createApp, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../src/locales/en.json';
import ja from '../src/locales/ja.json';
import ko from '../src/locales/ko.json';
import DevelopersPage from '../src/pages/DevelopersPage.vue';
import { loadDeveloperCopy, type DeveloperCopy } from '../src/lib/developer-docs';

vi.mock('../src/lib/developer-docs', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/developer-docs')>(),
  loadDeveloperCopy: vi.fn(),
}));
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.clearAllMocks(); vi.restoreAllMocks(); window.location.hash = ''; });
function mount(locale = 'en') {
  const el = document.createElement('div'); document.body.appendChild(el);
  const i18n = createI18n({ legacy: false, locale, messages: { en, ja, ko } });
  const app = createApp(DevelopersPage); app.use(i18n); app.mount(el);
  cleanups.push(() => { app.unmount(); el.remove(); });
  return { el, i18n };
}
function deferred() {
  let resolve!: (value: DeveloperCopy) => void;
  const promise = new Promise<DeveloperCopy>(r => { resolve = r; });
  return { promise, resolve };
}
const copy = (locale: 'ja' | 'ko'): DeveloperCopy => ({ locale, dictionary: {}, overview: `# ${locale} overview` });

describe('developer documentation language loading', () => {
  it('keeps the latest selected language when a previous request completes late', async () => {
    const japanese = deferred(), korean = deferred();
    vi.mocked(loadDeveloperCopy).mockImplementation(code => code === 'ja' ? japanese.promise : korean.promise);
    const { el, i18n } = mount('ja');
    expect(el.querySelector('[role=status]')?.textContent).toBe(ja['developers.loading']);
    expect(el.querySelector('.doc-body')).toBeNull();
    i18n.global.locale.value = 'ko'; await nextTick();
    korean.resolve(copy('ko'));
    await vi.waitFor(() => expect(el.querySelector('h1')?.textContent).toBe('ko overview'));
    japanese.resolve(copy('ja')); await nextTick(); await nextTick();
    expect(el.querySelector('h1')?.textContent).toBe('ko overview');
    expect(document.title).toContain(ko['developers.title']);
  });
  it('scrolls to an endpoint deep link after its translated document finishes loading', async () => {
    const japanese = deferred();
    vi.mocked(loadDeveloperCopy).mockReturnValue(japanese.promise);
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    window.location.hash = '#integration-post-conversation-ws-ticket';
    const { el } = mount('ja');
    japanese.resolve(copy('ja'));
    await vi.waitFor(() => expect(el.querySelector('.doc-body')).not.toBeNull());
    const target = el.querySelector('#integration-post-conversation-ws-ticket');
    expect(target?.closest('article')?.querySelector('.ep__body')).not.toBeNull();
    expect(scroll.mock.contexts).toContain(target);
    scroll.mockRestore();
  });
  it('shows a localized error and can recover by switching languages', async () => {
    vi.mocked(loadDeveloperCopy).mockRejectedValueOnce(new Error('asset unavailable')).mockResolvedValue(copy('ko'));
    const { el, i18n } = mount('ja');
    await vi.waitFor(() => expect(el.querySelector('[role=alert]')).not.toBeNull());
    expect(el.textContent).toContain(ja['developers.loadError']);
    expect(el.querySelector('button')?.textContent).toBe(ja['developers.reload']);
    expect(el.querySelector('.doc-body')).toBeNull();
    i18n.global.locale.value = 'ko';
    await vi.waitFor(() => expect(el.querySelector('h1')?.textContent).toBe('ko overview'));
    expect(el.querySelector('[role=alert]')).toBeNull();
  });
});
