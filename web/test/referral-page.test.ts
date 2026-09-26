import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import { setProvider } from '../src/lib/provider';
import { ApiError } from '../src/lib/api';
import ReferralPage from '../src/pages/ReferralPage.vue';
const mocks = vi.hoisted(() => ({ summary: vi.fn(), redeem: vi.fn(), token: vi.fn(), login: vi.fn() }));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), fetchReferral: mocks.summary, redeemReferral: mocks.redeem }));
vi.mock('../src/lib/connections', () => ({ accountToken: mocks.token }));
vi.mock('../src/lib/oauth', async original => ({ ...await original<typeof import('../src/lib/oauth')>(), beginLogin: mocks.login }));

const terms = { welcomeCredits: 1000, welcomeDays: 30, firstPercent: 20, firstCap: 24000, inviteePercent: 0, rebatePercent: 5, rebateDays: 365, bindDays: 7 };
const page = (over: Record<string, unknown> = {}) => ({ enabled: true, code: 'K7M2Q9XA', terms, referred: false, welcomeCredits: 0, canRedeem: true, redeemUntil: '2026-10-03T00:00:00Z', invited: 3, purchased: 1, earned: 12600, ...over });
let app: ReturnType<typeof createApp>; let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.clearAllMocks(); });

async function mount(path = '/me/referral') {
  setProvider('harbor');
  i18n.global.locale.value = 'en';
  mocks.token.mockResolvedValue('token-harbor');
  const pinia = createPinia(); setActivePinia(pinia);
  const session = useSession(); session.me = { accountNumId: 7, nickName: 'Fixture', avatar: '' }; session.profile = { identities: [{ provider: 'harbor', externalId: 7 }] } as any;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/me/referral', component: ReferralPage }] });
  await router.push(path);
  root = document.createElement('div'); document.body.append(root);
  app = createApp(ReferralPage).use(pinia).use(router).use(i18n); app.mount(root);
  for (let i = 0; i < 40; i++) await Promise.resolve(); await nextTick();
}

it('opens on the own code with results and rules read from the service', async () => {
  mocks.summary.mockResolvedValue(page({ terms: { ...terms, welcomeCredits: 1500 } }));
  await mount();
  expect(root.querySelector('[data-testid="referral-code"]')?.textContent).toBe('K7M2Q9XA');
  expect(root.textContent).toContain('1,500');
  expect(root.textContent).toContain('12,600');
  expect(root.querySelector('form[data-testid="referral-form"]')).toBeNull();
  expect(mocks.token).toHaveBeenCalledWith('harbor', 7);
});

it('lands an invite link on the entry tab with the code filled in, and applies it once', async () => {
  mocks.summary.mockResolvedValue(page());
  mocks.redeem.mockResolvedValue(page({ referred: true, canRedeem: false, welcomeCredits: 1000 }));
  await mount('/me/referral?code=ab12cd34');
  const input = root.querySelector('input[data-testid="referral-input"]') as HTMLInputElement;
  expect(input.value).toBe('AB12CD34');
  const button = root.querySelector('form[data-testid="referral-form"] button') as HTMLButtonElement;
  button.click(); button.click();
  for (let i = 0; i < 20; i++) await Promise.resolve(); await nextTick();
  expect(mocks.redeem).toHaveBeenCalledTimes(1);
  expect(mocks.redeem).toHaveBeenCalledWith('token-harbor', 'AB12CD34', 'harbor');
  expect(root.querySelector('[data-testid="referral-entered"]')?.textContent).toContain('1,000');
});

it('explains a rejected code in words and keeps what was typed', async () => {
  mocks.summary.mockResolvedValue(page());
  mocks.redeem.mockRejectedValue(new ApiError(409, 'x', 'referral_self'));
  await mount('/me/referral?tab=enter');
  const input = root.querySelector('input[data-testid="referral-input"]') as HTMLInputElement;
  input.value = 'ZZZZ2345'; input.dispatchEvent(new Event('input')); await nextTick();
  (root.querySelector('form[data-testid="referral-form"] button') as HTMLButtonElement).click();
  for (let i = 0; i < 20; i++) await Promise.resolve(); await nextTick();
  const alert = root.querySelector('[role="alert"]')?.textContent ?? '';
  expect(alert.length).toBeGreaterThan(5); expect(alert).not.toContain('referral_self');
  expect(input.value).toBe('ZZZZ2345');
});

// 舊的授權沒有邀請這項權限：說清楚，並讓他一鍵重新授權回到這頁。
it('asks to re-authorize when the sign-in predates the invite permission', async () => {
  mocks.summary.mockRejectedValue(new ApiError(403, 'x', 'insufficient_scope'));
  await mount();
  const button = root.querySelector('[data-testid="referral-reauthorize"]') as HTMLButtonElement;
  expect(button).not.toBeNull();
  button.click();
  expect(mocks.login).toHaveBeenCalledWith('/me/referral', { provider: 'harbor' });
});
