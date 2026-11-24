import { env, SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
const MAINTENANCE_KEY = 'site_maintenance';
import { opsMetrics } from '../src/ops-metrics';
import { resetDb } from './helpers';
import { resetMaintenanceMemo } from '../src/maintenance';

beforeEach(resetDb);
async function setState(value: unknown) {
  await env.DB.prepare('INSERT OR REPLACE INTO community_settings(key,value,updated_at) VALUES(?,?,1)').bind(MAINTENANCE_KEY,JSON.stringify(value)).run();
  // 開關讀取在同一個 Worker 實例內共用 5 秒（D1 過載止血）；測試切換後立刻驗證，先清掉共用的那份
  resetMaintenanceMemo();
}
it('defaults off, stays enabled after the ETA and reports primary state (shared at most 5 seconds per instance)',async()=>{
  expect(await (await SELF.fetch('https://sukisuki.ai/v1/maintenance')).json()).toEqual({enabled:false,endsAt:null,messages:{}});
  await setState({enabled:true,endsAt:1,messages:{en:'Upgrade in progress'}});
  const response=await SELF.fetch('https://sukisuki.ai/v1/maintenance');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toMatchObject({enabled:true,endsAt:1,messages:{en:'Upgrade in progress'}});
});
it('blocks new API/proxy operations before auth or Provider, including websockets',async()=>{
  await setState({enabled:true,endsAt:null});
  for(const [path,method,headers] of [['/v1/me','GET',{}],['/v1/cards','POST',{}],['/v1/cards/file.css','DELETE',{}],['/hh-api/open/v1/chat','POST',{}],['/hh-api/open/v1/socket','GET',{Upgrade:'websocket'}]] as const){
    const r=await SELF.fetch('https://sukisuki.ai'+path,{method,headers});
    expect(r.status,path).toBe(503);expect(r.headers.get('retry-after')).toBe('15');
    expect(await r.json()).toMatchObject({error:'site_maintenance'});
  }
  expect(await opsMetrics(env.DB)).toContain('hearthroom_maintenance_requests_total{surface="api",outcome="blocked"}');
});
it('serves the SPA shell for all entrypoints including play and sandbox without Provider calls',async()=>{
  await setState({enabled:true,endsAt:null});
  const assets=vi.fn(async()=>new Response('<html><head></head><body><div id="app"></div></body></html>',{headers:{'Content-Type':'text/html'}}));
  for(const url of ['https://sukisuki.ai/','https://sukisuki.ai/en/cards/123','https://sukisuki.ai/mine','https://sukisuki.ai/play/123','https://play.sukisuki.ai/123','https://c123.sukisuki.ai/sandbox/index.html']){
    const ctx=createExecutionContext();
    const r=await worker.fetch(new Request(url,{headers:{Accept:'text/html'}}),{...env,ASSETS:{fetch:assets} as unknown as Fetcher},ctx);
    expect(r.status,url).toBe(503);expect(r.headers.get('cache-control')).toContain('no-store');
    expect(await r.text()).toContain('id="app"');await waitOnExecutionContext(ctx);
  }
  expect(assets).toHaveBeenCalledTimes(6);
});
it('invalid state never silently opens admission, and off restores normal routing',async()=>{
  await setState({enabled:'yes'});
  expect((await SELF.fetch('https://sukisuki.ai/v1/maintenance')).status).toBe(503);
  expect((await SELF.fetch('https://sukisuki.ai/v1/me')).status).toBe(503);
  await setState({enabled:false});
  expect((await SELF.fetch('https://sukisuki.ai/v1/health')).status).toBe(200);
});
it('keeps pages and APIs available when the primary maintenance read fails', async () => {
  const primaryRead = vi.fn(async () => { throw new Error('D1 temporarily unavailable'); });
  const db = new Proxy(env.DB, {
    get(binding, key) {
      if (key === 'withSession') {
        return (constraint: Parameters<D1Database['withSession']>[0]) => constraint === 'first-primary'
          ? {prepare: () => ({bind: () => ({first: primaryRead})})}
          : binding.withSession(constraint);
      }
      const value = Reflect.get(binding, key);
      return typeof value === 'function' ? value.bind(binding) : value;
    },
  });
  const assets = {fetch: async () => new Response('<html><head></head><body>Home</body></html>', {
    headers: {'Content-Type': 'text/html'},
  })} as unknown as Fetcher;
  const ctx = createExecutionContext();
  const settings = {...env, DB: db, ASSETS: assets};
  resetMaintenanceMemo();
  const home = await worker.fetch(new Request('https://sukisuki.ai/', {headers: {Accept: 'text/html'}}), settings, ctx);
  const health = await worker.fetch(new Request('https://sukisuki.ai/v1/health'), settings, ctx);
  const status = await worker.fetch(new Request('https://sukisuki.ai/v1/maintenance'), settings, ctx);
  await waitOnExecutionContext(ctx);

  expect(primaryRead).toHaveBeenCalledTimes(3);
  expect(home.status).toBe(200);
  expect(await home.text()).toContain('<body>Home</body>');
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ok: true});
  expect(status.status).toBe(503);
  expect(status.headers.get('Cache-Control')).toBe('no-store');
  expect(await status.json()).toEqual({error: 'maintenance_status_unavailable'});
  expect(await opsMetrics(env.DB)).toContain('hearthroom_maintenance_requests_total{surface="status",outcome="error"} 3\n');

  await setState({enabled: true});
  expect(await (await SELF.fetch('https://sukisuki.ai/v1/health')).json()).toMatchObject({error: 'site_maintenance'});
  await setState({enabled: false});
  expect((await SELF.fetch('https://sukisuki.ai/v1/health')).status).toBe(200);
});
it('shows an auto-recovering shell on browser auth pages while holding machine auth operations',async()=>{
 await setState({enabled:true});
 const assets=async()=>new Response('<html><head></head><body><div id="app"></div></body></html>',{headers:{'Content-Type':'text/html'}});
 for(const path of ['/auth/callback?code=example','/auth/route/issue','/auth/route/complete']){
  const ctx=createExecutionContext();
  const r=await worker.fetch(new Request('https://sukisuki.ai'+path,{headers:{Accept:'text/html'}}),{...env,ASSETS:{fetch:assets} as unknown as Fetcher},ctx);
  expect(r.headers.get('content-type'),path).toContain('text/html');expect(await r.text()).toContain('hearthroom-maintenance-shell');await waitOnExecutionContext(ctx);
 }
 const r=await SELF.fetch('https://sukisuki.ai/auth/route/prepare',{method:'POST'});expect(r.status).toBe(503);expect(r.headers.get('content-type')).toContain('application/json');
});
it('restores same-site sandbox documents by reloading their original shell and supports opaque-origin status checks',async()=>{
 await setState({enabled:true});
 const ctx=createExecutionContext();
 const r=await worker.fetch(new Request('https://sukisuki.ai/sandbox/'),{...env,ASSETS:{fetch:async()=>new Response('<html><head></head></html>',{headers:{'Content-Type':'text/html'}})} as unknown as Fetcher},ctx);
 expect(await r.text()).toContain('content="sandbox"');await waitOnExecutionContext(ctx);
 expect((await SELF.fetch('https://sukisuki.ai/v1/maintenance',{headers:{Origin:'null'}})).headers.get('Access-Control-Allow-Origin')).toBe('*');
});

it('shares the primary read for 5 seconds within one instance, then reads again', async () => {
  await setState({enabled:false});
  expect((await SELF.fetch('https://sukisuki.ai/v1/maintenance')).status).toBe(200);
  await env.DB.prepare('INSERT OR REPLACE INTO community_settings(key,value,updated_at) VALUES(?,?,1)').bind(MAINTENANCE_KEY,JSON.stringify({enabled:true,endsAt:null,messages:{}})).run();
  // 5 秒內共用剛才那份（還是關）
  expect(await (await SELF.fetch('https://sukisuki.ai/v1/maintenance')).json()).toMatchObject({enabled:false});
  vi.useFakeTimers({ now: Date.now() + 6_000, toFake: ['Date'] });
  try {
    expect(await (await SELF.fetch('https://sukisuki.ai/v1/maintenance')).json()).toMatchObject({enabled:true});
  } finally { vi.useRealTimers(); }
});
