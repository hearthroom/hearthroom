import {afterEach,expect,it,vi} from 'vitest';
import {hostGateway} from '../src/hosting';
import type {Env} from '../src/types';
const keys={PROVIDER_API_BASE:'https://api.lunatalk.ai',PROVIDER_API_BASE_HARBOR:'https://api.harperharbor.com',HOSTING_SERVICE_KEY:'harbor-only',HOSTING_SERVICE_KEY_LUNATALK:'luna-only'} as unknown as Env;
afterEach(()=>vi.unstubAllGlobals());
it.each(['harbor'] as const)('sends only the destination hosting key to %s',async provider=>{
 const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({workId:'work',versionId:'version',hostedRevisionId:'frozen'})));
 vi.stubGlobal('fetch',fetcher);
 await hostGateway.seal(keys,'owner','draft','work','version',provider);
 expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('X-Hosting-Key')).toBe('harbor-only');
 await hostGateway.promote(keys,'owner','frozen','work','version',provider);
 expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('X-Hosting-Key')).toBe('harbor-only');
});
it('never falls back to the Harbor secret when LunaTalk is unconfigured',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 await expect(hostGateway.seal({...keys,HOSTING_SERVICE_KEY_LUNATALK:undefined} as Env,'owner','draft','work','version','lunatalk')).rejects.toThrow('unknown provider');
 expect(fetcher).not.toHaveBeenCalled();
});

it('refuses registration without the selected hosting credential instead of falling back to legacy publication',async()=>{
 const {SELF,env}=await import('cloudflare:test');
 const {resetDb,whoAmI,rolesOnMainSite,restoreUpstream}=await import('./helpers');
 await resetDb();delete (env as unknown as Env).HOSTING_SERVICE_KEY;whoAmI(10001);rolesOnMainSite({roleId:'draft',authorNumId:10001});
 try {
  const response=await SELF.fetch('https://c.test/v1/cards',{method:'POST',headers:{Authorization:'Bearer author-token','Content-Type':'application/json'},body:JSON.stringify({roleId:'draft',nsfw:false,operationId:crypto.randomUUID()})});
  expect(response.status).toBe(503);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM cards').first()).toEqual({n:0});
 } finally {restoreUpstream()}
});
