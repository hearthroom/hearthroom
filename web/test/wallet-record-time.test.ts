import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '../src/lib/i18n';
import { dayLabel, hourMinute, monthDayTime } from '../src/lib/format';
vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: { accountNumId: 1 }, accessToken: async () => 'tok' }) }));
vi.mock('../src/lib/connections', async (orig) => ({ ...(await orig<object>()), accountToken: async () => 'tok' }));
import ServiceWallet from '../src/components/ServiceWallet.vue';
import { forgetPeriodPlans } from '../src/lib/rewards';

let app: ReturnType<typeof createApp> | undefined;
const now = new Date(2026, 9, 29, 0, 15);
const at = (days: number, hour: number, minute: number) => new Date(2026, 9, 29 - days, hour, minute).toISOString();
const times = [at(0, 0, 5), at(1, 23, 55), at(2, 8, 30)];
const records = times.map((createTime, i) => ({ id: i + 1, record: 'chat', recordType: 'sub', score: 1234567, createTime, modelName: 'A very long model and lane name '.repeat(6) }));
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  forgetPeriodPlans();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/score/records')) return json({ total: records.length, records });
    if (url.endsWith('/me/wallet')) return json({ available: 1000, expiring: 0, expiries: [] });
    if (url.endsWith('/plans')) return json({ list: [] });
    return json({});
  }));
});
afterEach(() => { app?.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each(['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko'] as const)('每筆時間沿用 %s 格式：今天與昨天只寫時分，舊日寫月日時分，金額下方一直可見', async (locale) => {
  await applyLocale(locale);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] });
  await router.push('/');
  app = createApp(ServiceWallet, { provider: 'harbor', externalId: 1 }).use(createPinia()).use(router).use(i18n);
  const root = document.createElement('div');
  app.mount(root);
  for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick(); }
  const rows = [...root.querySelectorAll('.ledger .row')];
  expect(rows).toHaveLength(3);
  expect(rows.map(r => r.querySelector('.row__value time')?.textContent)).toEqual([hourMinute(times[0]), hourMinute(times[1]), monthDayTime(times[2])]);
  expect(rows.map(r => r.querySelector('time')?.getAttribute('datetime'))).toEqual(times);
  expect([...root.querySelectorAll('.ledger__date > span:first-child')].map(e => e.textContent)).toEqual(times.map(dayLabel));
  expect(rows.every(r => r.querySelector('.row__num')?.textContent?.includes('1'))).toBe(true);
});
