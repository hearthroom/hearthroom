import { env, SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
const MAINTENANCE_KEY = 'site_maintenance';
import { opsMetrics } from '../src/ops-metrics';
import { resetDb } from './helpers';

beforeEach(resetDb);
async function setState(value: unknown) {
  await env.DB.prepare('INSERT OR REPLACE INTO community_settings(key,value,updated_at) VALUES(?,?,1)').bind(MAINTENANCE_KEY,JSON.stringify(value)).run();
}
it('defaults off, stays enabled after the ETA and reports primary state without caching',async()=>{
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
