import {SELF,env} from 'cloudflare:test';
import {beforeEach,describe,expect,it} from 'vitest';
import {apiBaseOf,configuredProviders,parseProvider} from '../src/providers';
import {resetDb,role} from './helpers';
import {upsertCard,listCards,dueForSync} from '../src/cards';
import {cardLink} from '../src/card-link';

beforeEach(resetDb);

describe('Harper-only service boundary',()=>{
 it('advertises only Harper and uses it by default',async()=>{
  const response=await SELF.fetch('https://c.test/v1/providers');
  expect((await response.json() as any).providers).toEqual([{id:'harbor',name:'HarperHarbor'}]);
  expect(parseProvider(undefined)).toBe('harbor');
 });
 it('rejects retired identities rather than forwarding their tokens',async()=>{
  expect(()=>parseProvider('lunatalk')).toThrow();
  const response=await SELF.fetch('https://c.test/v1/me',{headers:{'X-Provider':'lunatalk',Authorization:'Bearer retired-token'}});
  expect(response.status).toBe(400);
 });
 it('cannot reenable the retired service through stale configuration',()=>{
  const env={PROVIDER_API_BASE:'https://retired.test',PROVIDER_API_BASE_HARBOR:'https://harbor.test'};
  expect(configuredProviders(env)).toEqual(['harbor']);
  expect(()=>apiBaseOf(env,'lunatalk')).toThrow();
 });
 it('hides unmigrated cards and never schedules their upstream',async()=>{
  const old=await upsertCard(env.DB,role({roleId:'retired'}),1,{provider:'lunatalk'});
  await upsertCard(env.DB,role({roleId:'available'}),1,{provider:'harbor'});
  const board=await listCards(env.DB,{sort:'new',offset:0,limit:24});
  expect(board.rows.map(r=>r.source_role_id)).toEqual(['available']);
  expect((await dueForSync(env.DB,10)).map(r=>r.source_role_id)).toEqual(['available']);
  await expect(cardLink(env,old.id,'harbor')).rejects.toThrow('card not found');
  for(const suffix of ['', '/platforms', '/manifest.webmanifest'])expect((await SELF.fetch(`https://c.test/v1/cards/${old.id}${suffix}`)).status).toBe(404);
 });
});

it('does not serve a pre-retirement board cache after the host contract changes',async()=>{
 const {boardKey,readBoardCache,boardCache}=await import('../src/board-cache');
 const key=await boardKey('https://c.test/v1/cards',0,false,'en');
 const legacyURL=new URL(key.edge.url);legacyURL.searchParams.delete('_host');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(legacyURL.toString()));
 const hash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
 await env.CACHE.put(`${boardCache.namespace}:${hash}`,JSON.stringify({body:JSON.stringify({items:[{provider:'lunatalk'}]}),expiresAt:Date.now()+300000}));
 expect(await readBoardCache(env,{waitUntil:()=>{}},key)).toBeNull();
});
