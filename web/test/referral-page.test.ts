import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { i18n, loadLocale } from '../src/lib/i18n';
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
  await loadLocale('en');
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

// 分享連結帶入的推薦人還能換：照樣給填碼欄，說明換的是推薦人、期限是換人的截止日。
it('offers to replace a referrer that came from a shared link', async () => {
  mocks.summary.mockResolvedValue(page({ referred: true, canRedeem: true, redeemUntil: '2026-10-14T08:00:00Z' }));
  await mount('/me/referral?tab=enter');
  expect(root.querySelector('form[data-testid="referral-form"]')).not.toBeNull();
  const [before, after] = String(i18n.global.t('referral.switchHelp', { date: '§' })).split('§');
  const help = root.querySelector('#referral-help')?.textContent ?? '';
  expect(help.startsWith(before) && help.endsWith(after)).toBe(true);
});

// 邀請連結走分享連結那條路：朋友註冊後自動帶入，不用再填。
it('copies an invite link that carries the code as a share reference', async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
  mocks.summary.mockResolvedValue(page());
  await mount();
  const link = [...root.querySelectorAll('button')].find(b => b.textContent === String(i18n.global.t('referral.copyLink'))) as HTMLButtonElement;
  link.click();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(write).toHaveBeenCalledWith(`${location.origin}/?ref=K7M2Q9XA`);
});

it('shows the platform inviter promotion separately from the newcomer gift', async () => {
 mocks.summary.mockResolvedValue(page({ terms: { ...terms, inviterCredits: 1000, inviterEndAt: '2099-11-17T00:00:00+08:00' } }));
 await mount();
 expect(root.querySelector('[data-testid="inviter-bonus"]')?.textContent).toContain('1,000');
 expect(root.querySelector('[data-testid="inviter-bonus"]')?.textContent).not.toMatch(/30 (days|天)/);
});
it('hides expired inviter promotion while keeping the newcomer gift', async () => {
 mocks.summary.mockResolvedValue(page({ terms: { ...terms, inviterCredits: 1000, inviterEndAt: '2000-11-17T00:00:00+08:00' } }));
 await mount();expect(root.querySelector('[data-testid="inviter-bonus"]')).toBeNull();
 expect(root.textContent).toContain('1,000');
});

it('explains permanent newcomer credits without a zero-day expiry', async () => {
 mocks.summary.mockResolvedValue(page({ terms: { ...terms, welcomeDays: 0 } }));
 await mount();expect(root.textContent).toContain(String(i18n.global.t('referral.rule.welcomePermanent', { credits: '1,000' })));expect(root.textContent).not.toMatch(/0 (days|天)/);
});

it('shows each invite status and credited amount without exposing friend identity', async () => {
  mocks.summary.mockResolvedValue(page({ invitesTotal: 53, invites: [
    { boundAt: '2026-10-20T08:00:00Z', firstChat: 'waiting', firstChatBy: '2026-10-27T08:00:00Z', credited: 3000, pending: 0, pendingUntil: null, email: 'private@example.test' },
    { boundAt: '2026-10-19T08:00:00Z', firstChat: 'done', firstChatBy: '2026-10-26T08:00:00Z', credited: 5000, pending: 2000, pendingUntil: '2026-10-23T08:00:00Z' },
    { boundAt: '2026-10-10T08:00:00Z', firstChat: 'expired', firstChatBy: '2026-10-17T08:00:00Z', credited: 1000, pending: 0, pendingUntil: null },
  ] }));
  await mount();
  const rows = root.querySelectorAll('[data-testid="referral-invite"]');
  expect(rows).toHaveLength(3);
  const boundAt = '2026-10-20T08:00:00Z';
  const joined = new Intl.DateTimeFormat('en', {month:'numeric',day:'numeric'}).format(Date.parse(boundAt));
  expect(rows[0]?.querySelector('time')?.textContent).toBe(String(i18n.global.t('referral.invites.joined', {date:joined})));
  expect(rows[0]?.querySelector('time')?.getAttribute('datetime')).toBe(boundAt);
  expect(rows[0]?.querySelector('[data-testid="invite-waiting"]')?.textContent).toContain(new Intl.DateTimeFormat('en', {dateStyle:'medium',timeStyle:'short'}).format(Date.parse('2026-10-27T08:00:00Z')));
  expect(rows[0]?.querySelector('[data-testid="invite-credited"]')?.textContent).toContain('3,000');
  expect(rows[0]?.querySelector('[data-testid="invite-waiting"]')).not.toBeNull();
  expect(rows[0]?.querySelector('[data-testid="invite-pending"]')).toBeNull();
  expect(rows[1]?.querySelector('[data-testid="invite-done"]')).not.toBeNull();
  expect(rows[1]?.querySelector('[data-testid="invite-pending"]')?.textContent).toContain('2,000');
  expect(rows[2]?.querySelector('[data-testid="invite-expired"]')).not.toBeNull();
  expect(root.querySelector('[data-testid="invites-total"]')?.textContent).toContain('53');
  expect(root.textContent).not.toContain('private@example.test');
});

it('offers a copy-link action for an empty invite list and handles an older API without one', async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
  mocks.summary.mockResolvedValue(page({ invites: [], invitesTotal: 0 }));
  await mount();
  const copy = root.querySelector('[data-testid="invites-empty-copy"]') as HTMLButtonElement;
  expect(copy).not.toBeNull();
  copy.click();
  await Promise.resolve();
  expect(write).toHaveBeenCalledWith(`${location.origin}/?ref=K7M2Q9XA`);
});

it('does not claim there are no invites when the service omits the new list', async () => {
  mocks.summary.mockResolvedValue(page());
  await mount();
  expect(root.querySelector('[data-testid="referral-invites"]')).toBeNull();
});

it('uses separate service amounts and keeps a pending invite without an invented date', async () => {
  mocks.summary.mockResolvedValue(page({ terms: { ...terms, inviterCredits: 4000, welcomeCredits: 3000, firstChatCredits: 1500, firstChatDays: 9, inviterEndAt: '2099-11-17T00:00:00Z' }, invites: [
    { boundAt: '2026-10-20T08:00:00Z', firstChat: 'done', firstChatBy: '2026-10-29T08:00:00Z', credited: 0, pending: 5500, pendingUntil: null },
  ], invitesTotal: 1 }));
  await mount();
  expect(root.querySelector('.referral__lead')?.textContent).toContain('4,000');
  expect(root.querySelector('.referral__lead')?.textContent).toContain('3,000');
  expect(root.querySelector('.referral__lead')?.textContent).toContain('1,500');
  const pending = root.querySelector('[data-testid="invite-pending"]')?.textContent;
  expect(pending).toContain(String(i18n.global.t('referral.invites.pendingReview', { pending: '5,500' })));
  expect(root.textContent).not.toContain('Invalid Date');
});

it.each([0, 30])('keeps the friend gift after both inviter rewards become zero (welcomeDays=%s)', async (welcomeDays) => {
  mocks.summary.mockResolvedValue(page({terms: {...terms, welcomeCredits:3000, welcomeDays, inviterCredits:0, firstChatCredits:0, firstChatDays:7, inviterEndAt:'2000-11-17T00:00:00Z'}}));
  await mount();
  expect(root.querySelector('.referral__lead')?.textContent).toBe(String(i18n.global.t('referral.leadFriendOnly',{friend:'3,000'})));
  expect(root.querySelector('.referral__rules')?.textContent).toContain(String(i18n.global.t(welcomeDays===0?'referral.rule.bindFriendOnly':'referral.rule.welcome',{credits:'3,000',days:welcomeDays})));
  expect(root.querySelector('.referral__rules')?.textContent).not.toContain(String(i18n.global.t('referral.rule.permanent')));
  expect(root.querySelector('[data-testid="inviter-bonus"]')).toBeNull();
});
