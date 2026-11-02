import {env,createExecutionContext,createScheduledController,waitOnExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {resetDb,makeMember,restoreUpstream} from './helpers';
import {rankMaintenance,rankPaymentMaintenance,rankTransport,RANK_CRON} from '../src/rank-maintenance';
import worker from '../src/index';
import {upstream} from '../src/upstream';
import {badgeStatsTransport} from '../src/badge-stats';
import {RANK_RETRY_CRON} from '../src/rank-maintenance';
import {cardRewardTransport} from '../src/card-reward-service';
import {settleRankSnapshot} from '../src/rank-awards';
let member:string;const at=Date.parse('2026-10-17T00:00:00+08:00'),real={...rankTransport},token=cardRewardTransport.token,statsRead=badgeStatsTransport.read;
beforeEach(async()=>{await resetDb();member=await makeMember(11);cardRewardTransport.token=async()=> 'service-only';});
afterEach(()=>{vi.restoreAllMocks();Object.assign(rankTransport,real);cardRewardTransport.token=token;badgeStatsTransport.read=statsRead;restoreUpstream()});
async function card(){await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider,approved_hosted_role_id) VALUES(100001,'rank-source',11,'{}','{}',?,1,'approved','harbor','rank-hosted')").bind(at+1000).run();await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at,decided_at) VALUES('rank-first',100001,'harbor','rank-source','first','approved',?,?)").bind(at,at+1000).run()}
it('waits for complete original windows, settles both boards once and never substitutes cumulative heat',async()=>{
 await card();let complete=false;rankTransport.heats=async(_env,windows)=>windows.map(w=>({...w,heat:150,complete}));
 await rankMaintenance(env,at+3*86400000);expect(await env.DB.prepare('SELECT published_at FROM rank_publications WHERE card_id=100001').first('published_at')).toBe(at+1000);expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_settlements').first('n')).toBe(0);
 complete=true;await rankMaintenance(env,at+3*86400000);await rankMaintenance(env,at+3*86400000);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards').first('n')).toBe(2);
 await env.DB.prepare('UPDATE cards SET registered_at=? WHERE id=100001').bind(at+86400000).run();
 await rankMaintenance(env,at+4*86400000);expect(await env.DB.prepare('SELECT published_at FROM rank_publications WHERE card_id=100001').first('published_at')).toBe(at+1000);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards').first('n')).toBe(2);
});
it('recovers a lost payment response using the same durable key, amount, recipient and dedicated service bearer',async()=>{
 await settleRankSnapshot(env,{zone:'clean',window:'day',period:'2026-10-17',now:at+3*86400000,cards:[{id:100001,heat:100,talkNum:1,registeredAt:at,adult:false,memberId:member,accountNo:11}]});
 const remote=new Map<string,unknown>();let attempts=0;
 rankTransport.pay=async(_env,bearer,input)=>{expect(bearer).toBe('service-only');expect(input.amount).toBe(5000);expect(input.accountNo).toBe(11);remote.set(input.key,input);attempts++;if(attempts===1)throw new Error('response lost');return input};
 await rankPaymentMaintenance(env,at+3*86400000);expect(await env.DB.prepare('SELECT status FROM rank_awards').first('status')).toBe('pending');
 await rankPaymentMaintenance(env,at+3*86400000+120000);await rankPaymentMaintenance(env,at+3*86400000+240000);
 expect(await env.DB.prepare('SELECT status FROM rank_awards').first('status')).toBe('paid');expect(remote.size).toBe(1);expect(attempts).toBe(2);
});
it('runs cohort settlement on its dedicated daily schedule without borrowing the unrelated card sync budget',async()=>{
 await card();rankTransport.heats=async(_env,windows)=>windows.map(w=>({...w,heat:100,complete:true}));
 let detailReads=0;upstream.fetchRole=async()=>{detailReads++;throw new Error('unrelated sync')};
 const ctx=createExecutionContext();await worker.scheduled(createScheduledController({cron:RANK_CRON,scheduledTime:at+3*86400000}),env,ctx);await waitOnExecutionContext(ctx);
 expect(detailReads).toBe(0);expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards').first('n')).toBe(2);
});
it('uses a new payment path that old Providers reject and verifies the returned pool identity',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({poolKey:'default',key:'rank-fixture',accountNo:11,amount:5000}),{status:200}));
 await expect(rankTransport.pay(env,'service-only',{key:'rank-fixture',accountNo:11,amount:5000,campaignRef:'rank:fixture',contentRef:'100001'})).rejects.toThrow('rank_payment_wrong_pool');
 expect(String(fetch.mock.calls[0][0])).toContain('/open/v1/campaign-pools/leaderboard/payouts');
});
it('holds settlement when an approved possible entrant has no original publication proof',async()=>{
 await card();await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider) VALUES(100002,'unknown-first',11,'{}','{}',?,1,'approved','harbor')").bind(at+2000).run();
 rankTransport.heats=async(_env,windows)=>windows.map(w=>({...w,heat:100,complete:true}));
 await rankMaintenance(env,at+3*86400000);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_settlements').first('n')).toBe(0);
});
it('separates scoring, payment and private-stat refresh into bounded scheduled invocations',async()=>{
 await card();rankTransport.heats=async(_env,windows)=>windows.map(w=>({...w,heat:100,complete:true}));
 let payments=0,refreshes=0;rankTransport.pay=async(_env,_token,input)=>{payments++;return input};badgeStatsTransport.read=async()=>{refreshes++;return [{accountNo:11,effectiveInvites:3,netTopupUsdMicros:5000000,consumedCredits:30000,complete:true}]};
 for(let phase=0;phase<3;phase++){
  const ctx=createExecutionContext();await worker.scheduled(createScheduledController({cron:RANK_RETRY_CRON,scheduledTime:at+3*86400000+phase*60000}),env,ctx);await waitOnExecutionContext(ctx);
  if(phase===0){expect(payments).toBe(0);expect(refreshes).toBe(0)}
 }
 expect(payments).toBe(2);expect(refreshes).toBe(1);
});
it('resumes a large cohort across bounded heat batches and never awards a partial prefix',async()=>{
 const ids=JSON.stringify(Array.from({length:201},(_,i)=>i));
 await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider) SELECT 100001+value,'large-'||value,11,'{}','{}',?+value,1,'approved','harbor' FROM json_each(?)").bind(at,ids).run();
 await env.DB.prepare('INSERT INTO rank_publications SELECT id,registered_at,? FROM cards').bind(at).run();
 let calls=0;rankTransport.heats=async(_env,windows)=>{calls++;return windows.map(w=>({...w,heat:100,complete:true}))};
 await rankMaintenance(env,at+3*86400000,1);expect(calls).toBe(1);expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards').first('n')).toBe(0);
 await rankMaintenance(env,at+3*86400000+60000,1);expect(calls).toBe(2);expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards').first('n')).toBe(20);
});
