import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import { currentProvider, setProvider } from '../src/lib/provider';
import WalletPage from '../src/pages/WalletPage.vue';
const mocks = vi.hoisted(() => ({wallet:vi.fn(),records:vi.fn(),token:vi.fn(),summary:vi.fn(),referral:vi.fn()}));
vi.mock('../src/lib/api',async original => ({...await original<typeof import('../src/lib/api')>(),fetchWallet:mocks.wallet,fetchScoreRecords:mocks.records,fetchScoreSummary:mocks.summary,fetchReferral:mocks.referral}));
vi.mock('../src/lib/connections',()=>({accountToken:mocks.token}));
let app:ReturnType<typeof createApp>;let root:HTMLElement;
afterEach(()=>{app?.unmount();root?.remove();vi.clearAllMocks();});
it('shows both balances and histories without a global provider switch',async()=>{
  setProvider('harbor');
  mocks.token.mockImplementation(async p=>`token-${p}`);
  mocks.wallet.mockImplementation(async (_t,p)=>({score:p==='harbor'?222:111,tempScore:0,plans:[]}));
  mocks.records.mockImplementation(async (_t,_page,_size,p)=>({records:[{id:1,record:`${p} entry`,score:5,recordType:'sub',createTime:'2026-09-20T00:00:00Z'}],total:1}));
  mocks.summary.mockRejectedValue(new Error('offline'));
  mocks.referral.mockRejectedValue(new Error('offline'));
  const pinia=createPinia();setActivePinia(pinia);
  const session=useSession();session.me={accountNumId:1,nickName:'Fixture',avatar:''};session.profile={identities:[{provider:'lunatalk',externalId:1},{provider:'harbor',externalId:2}]} as any;
  const router=createRouter({history:createMemoryHistory(),routes:[{path:'/wallet',component:WalletPage}]});await router.push('/wallet');
  root=document.createElement('div');document.body.append(root);app=createApp(WalletPage).use(pinia).use(router).use(i18n);app.mount(root);
  for(let i=0;i<40;i++)await Promise.resolve();await nextTick();
  expect(root.textContent).not.toContain('111');expect(root.textContent).toContain('222');
  expect(root.textContent).not.toContain('lunatalk entry');expect(root.textContent).toContain('harbor entry');
  expect(root.querySelector('a[href*="provider="]')).toBeNull();
  for(const button of root.querySelectorAll('.seg button'))button.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  expect(currentProvider()).toBe('harbor');
  expect(mocks.token).toHaveBeenCalledWith('harbor',2);
});

/**
 * 積分頁重新設計（owner 2026-09-27）：邀請獎勵要跟儲值放在一起、要有每天每週的統計、流水要看得懂。
 */
const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(key, args ?? {});
const today = new Date();
const iso = (offset: number) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const summary = Array.from({ length: 84 }, (_, i) => ({ date: iso(83 - i), spent: i === 83 ? 46 : 3, earned: i === 83 ? 100 : 0, count: 1 }));
const referral = (over: Record<string, unknown> = {}) => ({ enabled: true, code: 'HH7Q2K', referred: false, welcomeCredits: 0, canRedeem: false, invited: 0, purchased: 0, earned: 0,
  terms: { welcomeCredits: 50, welcomeDays: 7, firstPercent: 10, firstCap: 1000, inviteePercent: 0, rebatePercent: 0, rebateDays: 0, bindDays: 7 }, ...over });

async function mountWallet() {
  setProvider('harbor');
  mocks.token.mockImplementation(async () => 'token');
  mocks.wallet.mockResolvedValue({ score: 6479, tempScore: 0, plans: [] });
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).toISOString();
  mocks.records.mockResolvedValue({ records: [
    { id: 1, record: 'chat', score: 12, recordType: 'sub', createTime: now },
    { id: 2, record: 'referral', score: 100, recordType: 'add', createTime: now },
  ], total: 2 });
  const pinia = createPinia(); setActivePinia(pinia);
  const session = useSession(); session.me = { accountNumId: 2, nickName: 'Fixture', avatar: '' }; session.profile = { identities: [{ provider: 'harbor', externalId: 2 }] } as any;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/wallet', component: WalletPage }, { path: '/:p(.*)*', component: { template: '<div />' } }] }); await router.push('/wallet');
  root = document.createElement('div'); document.body.append(root); app = createApp({ template: '<RouterView />' }).use(pinia).use(router).use(i18n); app.mount(root);
  for (let i = 0; i < 60; i++) await Promise.resolve(); await nextTick();
  return root;
}

it('流水顯示看得懂的項目名，每一天附上支出與收入小計', async () => {
  mocks.summary.mockResolvedValue(summary); mocks.referral.mockResolvedValue(referral());
  const page = await mountWallet();
  const items = [...page.querySelectorAll('.row__item')].map((e) => e.textContent);
  expect(items).toEqual([t('wallet.reason.chat'), t('wallet.reason.referral')]);
  // 今天的小計取自統計（46／100），不是只加手上這兩筆
  expect(page.querySelector('.ledger__sum')?.textContent).toContain('46');
  expect(page.querySelector('.ledger__sum')?.textContent).toContain('100');
});

it('最近消耗：今天、本週、近 30 天，圖可以切 7 天／30 天／按週', async () => {
  mocks.summary.mockResolvedValue(summary); mocks.referral.mockResolvedValue(referral());
  const page = await mountWallet();
  const spent = page.querySelector('[data-testid="wallet-spent"]')!;
  expect(spent.querySelectorAll('dd')[0].textContent).toBe('46');
  expect(spent.querySelectorAll('dd')[2].textContent).toBe(String(46 + 29 * 3));
  expect(page.querySelectorAll('.usage-chart__col')).toHaveLength(30);
  const buttons = [...page.querySelectorAll<HTMLButtonElement>('.usage .seg__item')];
  buttons[0].click(); await nextTick();
  expect(page.querySelectorAll('.usage-chart__col')).toHaveLength(7);
  buttons[2].click(); await nextTick();
  expect(page.querySelectorAll('.usage-chart__col').length).toBeGreaterThanOrEqual(11);
});

it('還能填推薦碼的人：邀請卡直接帶去填碼，寫明能領多少', async () => {
  mocks.summary.mockResolvedValue(summary); mocks.referral.mockResolvedValue(referral({ canRedeem: true }));
  const page = await mountWallet();
  const invite = page.querySelector('[data-testid="wallet-invite"]')!;
  expect(invite.textContent).toContain(t('wallet.invite.redeemGift', { credits: '50' }));
  expect(invite.querySelector('[data-testid="wallet-invite-redeem"]')?.getAttribute('href')).toContain('/me/referral?tab=enter');
});

it('其他人：邀請卡秀自己的推薦碼；活動沒開就不佔位', async () => {
  mocks.summary.mockResolvedValue(summary); mocks.referral.mockResolvedValue(referral({ referred: true }));
  let page = await mountWallet();
  expect(page.querySelector('[data-testid="wallet-invite-code"]')?.textContent).toBe('HH7Q2K');
  expect(page.querySelector('[data-testid="wallet-invite-redeem"]')).toBeNull();
  app.unmount(); root.remove();
  mocks.referral.mockResolvedValue(referral({ enabled: false }));
  page = await mountWallet();
  expect(page.querySelector('[data-testid="wallet-invite"]')).toBeNull();
});

it('統計讀不到：圖和最近消耗不顯示，流水照常', async () => {
  mocks.summary.mockRejectedValue(new Error('offline')); mocks.referral.mockResolvedValue(referral());
  const page = await mountWallet();
  expect(page.querySelector('.usage')).toBeNull();
  expect(page.querySelector('[data-testid="wallet-spent"]')).toBeNull();
  expect(page.querySelectorAll('.row')).toHaveLength(2);
});
