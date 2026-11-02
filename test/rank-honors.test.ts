import {SELF,env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream} from './helpers';
import {settleRankSnapshot} from '../src/rank-awards';
import {getCard,toCard} from '../src/cards';
let member:string;const at=Date.parse('2026-10-17T00:00:00+08:00');
beforeEach(async()=>{await resetDb();member=await makeMember(11);
 await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider) VALUES(100001,'rank-source',11,'{}','{}',?,1,'approved','harbor')").bind(at).run();
});afterEach(restoreUpstream);
it('returns one best honor per period on covers and all dated awards on the visible detail path',async()=>{
 for(const zone of ['clean','all'] as const)for(const window of ['day','week','month'] as const){
  const period=window==='day'?'2026-10-17':window==='week'?'2026-10-12':'2026-10-01';
  await settleRankSnapshot(env,{zone,window,period,now:at+65*86400000,cards:[{id:100001,heat:100,talkNum:1,registeredAt:at,adult:false,memberId:member,accountNo:11}]});
 }
 const row=await getCard(env.DB,'100001');expect(toCard(row!,'zh-Hant').honors).toEqual(['day','week','month'].map(window=>({zone:'clean',window,band:1})));
 const response=await SELF.fetch('https://c.test/v1/cards/100001/honors');expect(response.status).toBe(200);
 const value=await response.json<{items:any[]}>();expect(value.items).toHaveLength(6);expect(value.items[0]).toMatchObject({period:expect.any(String),at:expect.any(Number),band:1});
 await env.DB.prepare("UPDATE cards SET rating='R' WHERE id=100001").run();expect((await SELF.fetch('https://c.test/v1/cards/100001/honors')).status).toBe(403);
 await env.DB.prepare("UPDATE cards SET status='unshared',rating=NULL WHERE id=100001").run();expect((await SELF.fetch('https://c.test/v1/cards/100001/honors')).status).toBe(404);
});
