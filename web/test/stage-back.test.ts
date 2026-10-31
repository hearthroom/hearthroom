import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { StageDeps } from '../src/lib/stage-host';

const installed = vi.hoisted(() => ({ host: null as any }));
vi.mock('../src/lib/stage-preload', () => ({ preloadStage: async () => ({
  browserHost: (options: any) => ({ ...options, events: { on: vi.fn() } }),
  installMoonStage: async (_app: unknown, options: any) => { installed.host = options.host; },
  MoonStage: {},
}) }));

beforeEach(() => { vi.resetModules(); installed.host = null; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function navigation(options: { host?: string; path?: string; locale?: string; back?: string | null; referrer?: string; length?: number } = {}) {
  const host = options.host ?? 'sukisuki.ai';
  const locale = options.locale ?? 'zh-Hant';
  const path = options.path ?? '/play/100001?provider=harbor';
  vi.stubGlobal('location', { hostname: host, origin: `https://${host}`, href: `https://${host}${path}`, assign: vi.fn() });
  vi.spyOn(window.history, 'length', 'get').mockReturnValue(options.length ?? 1);
  vi.spyOn(window.history, 'state', 'get').mockReturnValue({ back: options.back ?? null });
  vi.spyOn(document, 'referrer', 'get').mockReturnValue(options.referrer ?? '');
  const { i18n } = await import('../src/lib/i18n');
  i18n.global.locale.value = locale as any;
  const router = { back: vi.fn(), push: vi.fn() };
  const { ensureStage } = await import('../src/lib/stage-host');
  await ensureStage({ app: {}, router, session: { me: null, accessToken: async () => null }, guest: true,
    currentPath: () => path,
    lp: (p: string) => host.startsWith('play.') ? `${p}?lang=${locale}` : `${locale === 'zh-Hant' ? '' : `/${locale}`}${p}`,
  } as unknown as StageDeps);
  return { nav: installed.host.nav, router, assign: vi.mocked(location.assign) };
}

it.each(['back', 'toEntry'] as const)('%s returns to the card when opened directly, including external browser history', async action => {
  const { nav, router } = await navigation({ length: 3, referrer: 'https://elsewhere.test/' });
  nav[action]();
  expect(router.back).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledWith('/cards/100001');
});

it.each(['/cards/100001', '/', '/library?tab=conversations'])('returns through router history to %s', async back => {
  const { nav, router } = await navigation({ back, length: 2 });
  nav.toEntry();
  expect(router.back).toHaveBeenCalledOnce();
  expect(router.push).not.toHaveBeenCalled();
});

it('recognizes a full-document arrival from a card page', async () => {
  const { nav, router } = await navigation({ length: 2, referrer: 'https://sukisuki.ai/cards/100001' });
  nav.toEntry();
  expect(router.back).toHaveBeenCalledOnce();
});

it('does not mistake the opener of a new tab for a previous history entry', async () => {
  const { nav, router } = await navigation({ referrer: 'https://sukisuki.ai/cards/100001' });
  nav.toEntry();
  expect(router.back).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledWith('/cards/100001');
});

it.each(['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko'])('keeps %s on the fallback card page', async locale => {
  const { nav, router } = await navigation({ locale });
  nav.toEntry();
  expect(router.push).toHaveBeenCalledWith(`${locale === 'zh-Hant' ? '' : `/${locale}`}/cards/100001`);
});

it.each(['sukisuki.ai', 'hearthroom.club', 'sukisuki.chat', 'sukisuki.pro'])('leaves play.%s for the corresponding community card', async root => {
  const { nav, router, assign } = await navigation({ host: `play.${root}`, path: '/100001/?lang=ja', locale: 'ja' });
  nav.toEntry();
  expect(assign).toHaveBeenCalledWith(`https://${root}/ja/cards/100001`);
  expect(router.push).not.toHaveBeenCalled();
});

it('recognizes the community referrer on its card app subdomain', async () => {
  const { nav, router } = await navigation({ host: 'play.sukisuki.ai', path: '/100001/', length: 2, referrer: 'https://sukisuki.ai/' });
  nav.toEntry();
  expect(router.back).toHaveBeenCalledOnce();
});

it('rejects an external URL masquerading as router history', async () => {
  const { nav, router } = await navigation({ back: '//elsewhere.test/', length: 2 });
  nav.toEntry();
  expect(router.back).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledWith('/cards/100001');
});
