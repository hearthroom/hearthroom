import {env,createExecutionContext,createScheduledController,waitOnExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {resetDb,makeMember,restoreUpstream} from './helpers';
import {rankMaintenance,rankPaymentMaintenance,releaseHeldRankPayouts,rankTransport,RANK_CRON} from '../src/rank-maintenance';
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

it('uses the latest actual entrant maturity without settling an early prefix',async()=>{
 await card();
 const late=at+1*86400000+1000;
 await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider) VALUES(100002,'late',11,'{}','{}',?,1,'approved','harbor')").bind(late).run();
 await env.DB.prepare('INSERT INTO rank_publications VALUES(100002,?,?)').bind(late,at).run();
 rankTransport.heats=async(_env,windows)=>windows.map(w=>({...w,heat:100,complete:true}));
 await rankMaintenance(env,at+8*86400000);
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM rank_settlements WHERE window='week'").first('n')).toBe(0);
 await rankMaintenance(env,at+9*86400000);
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM rank_settlements WHERE window='week'").first('n')).toBe(2);
});

it('does not let an excluded test author with unknown publication hold other cohorts',async()=>{
 await card();const tester=await makeMember(22);await env.DB.prepare("UPDATE members SET account_class='test' WHERE id=?").bind(tester).run();
 await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider) VALUES(100002,'test-unknown',22,'{}','{}',?,1,'approved','harbor')").bind(at+2000).run();
 rankTransport.heats=async(_env,windows)=>windows.map(w=>({...w,heat:100,complete:true}));
 await rankMaintenance(env,at+3*86400000);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_settlements').first('n')).toBe(2);
});

it('preserves the proven first approval when correction rejects that submission but leaves a replacement public',async()=>{
 await card();await env.DB.prepare("DELETE FROM review_submissions WHERE id='rank-first'").run();await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at,decided_at) VALUES('corrected-first',100001,'harbor','rank-source','first','rejected',?,?)").bind(at,at+1000).run();await env.DB.prepare("INSERT INTO review_corrections(operation_id,submission_id,actor_member_id,actor_role,note,original_decided_at,created_at,state) VALUES('rank-correction','corrected-first',?,'manager','fixture',?,?,'complete')").bind(member,at+1000,at+2000).run();
 rankTransport.heats=async(_env,windows)=>windows.map(w=>({...w,heat:100,complete:true}));
 await rankMaintenance(env,at+3*86400000);
 expect(await env.DB.prepare('SELECT published_at FROM rank_publications WHERE card_id=100001').first('published_at')).toBe(at+1000);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_settlements').first('n')).toBe(2);
});
it('excludes explicitly unavailable works but holds a missing score with no visibility confirmation',async()=>{
 await card();
 rankTransport.heats=async(_env,windows)=>[];
 await rankMaintenance(env,at+3*86400000);expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_settlements').first('n')).toBe(0);
 rankTransport.heats=async(_env,windows)=>Object.assign([],{unavailable:windows});
 await rankMaintenance(env,at+3*86400000);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_settlements').first('n')).toBe(2);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards').first('n')).toBe(0);
 const snapshot=await env.DB.prepare('SELECT snapshot FROM rank_settlements LIMIT 1').first<string>('snapshot');expect(JSON.parse(snapshot!).excludedCardIds).toEqual([100001]);
});

it('settles native Harbor day and week cohorts from 2026-09-24 with held payouts, skips pre-09/24 and September month, and includes early October cards in October month',async()=>{
 const sep7=Date.parse('2026-09-07T02:00:00+08:00'),sep17=Date.parse('2026-09-17T12:00:00+08:00'),sep25=Date.parse('2026-09-25T12:00:00+08:00'),oct8=Date.parse('2026-10-08T12:00:00+08:00'),oct31=Date.parse('2026-10-31T12:00:00+08:00');
 await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider,rating) VALUES(100050,'sep7-no-pub',11,'{}','{}',?,1,'approved','harbor','G'),(100060,'sep17-lt',11,'{}','{}',?,1,'approved','harbor','G'),(100076,'sep25-r',11,'{}','{}',?,1,'approved','harbor','R'),(100088,'oct8-g',11,'{}','{}',?,1,'approved','harbor','G'),(100099,'oct31-g',11,'{}','{}',?,1,'approved','harbor','G')").bind(sep7,sep17,sep25,oct8,oct31).run();
 await env.DB.prepare('INSERT INTO rank_publications(card_id,published_at,captured_at) VALUES(100060,?,?),(100076,?,?),(100088,?,?),(100099,?,?)').bind(sep17,sep17,sep25,sep25,oct8,oct8,oct31,oct31).run();
 rankTransport.heats=async(_env,windows)=>windows.map(w=>({...w,heat:w.roleId==='sep25-r'?31804:w.roleId==='oct8-g'?500:100,complete:true}));
 const nov15=Date.parse('2026-11-15T12:00:00+08:00');
 for(let i=0;i<3;i++)await rankMaintenance(env,nov15+i*60000);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards WHERE card_id IN(100050,100060)').first('n')).toBe(0);
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM rank_settlements WHERE window='month' AND period='2026-09-01'").first('n')).toBe(0);
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM rank_settlements WHERE window='month' AND period='2026-10-01'").first('n')).toBe(0);
 const c76=(await env.DB.prepare('SELECT zone,window,period,band,payout_hold FROM rank_awards WHERE card_id=100076 ORDER BY window').all()).results;
 expect(c76).toEqual([
  {zone:'all',window:'day',period:'2026-09-25',band:1,payout_hold:1},
  {zone:'all',window:'week',period:'2026-09-21',band:1,payout_hold:1},
 ]);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_awards WHERE card_id=100088 AND payout_hold=1').first('n')).toBe(4);
 const dec2=Date.parse('2026-12-02T00:00:00+08:00');
 await rankMaintenance(env,dec2);
 const octMonth=(await env.DB.prepare("SELECT card_id,zone,band,payout_hold FROM rank_awards WHERE window='month' AND period='2026-10-01' ORDER BY zone").all()).results;
 expect(octMonth).toEqual([
  {card_id:100088,zone:'all',band:1,payout_hold:0},
  {card_id:100088,zone:'clean',band:1,payout_hold:0},
 ]);
});

it('supplements cross-boundary week 2026-10-12, skips held payouts during payment runs, and reserves a one-time idempotent payout release',async()=>{
 const preAuthor=await makeMember(22),oct16=Date.parse('2026-10-16T12:00:00+08:00'),nov15=Date.parse('2026-11-15T12:00:00+08:00');
 const postCards=Array.from({length:10},(_,i)=>({id:100011+i,heat:100-i,talkNum:5,registeredAt:at+1000+i,adult:true,memberId:member,accountNo:11}));
 for(const c of postCards){
  await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider,rating) VALUES(?,?,11,'{}','{}',?,1,'approved','harbor','R')").bind(c.id,`post-${c.id}`,c.registeredAt).run();
  await env.DB.prepare('INSERT INTO rank_publications(card_id,published_at,captured_at) VALUES(?,?,?)').bind(c.id,c.registeredAt,c.registeredAt).run();
  await env.DB.prepare("INSERT INTO rank_window_scores(card_id,window,from_at,to_at,heat,scored_at,excluded) VALUES(?,'week',?,?,?,?,'0')").bind(c.id,c.registeredAt,c.registeredAt+7*86400000,c.heat,nov15).run();
 }
 for(const zone of ['clean','all']as const)await settleRankSnapshot(env,{zone,window:'week',period:'2026-10-12',now:nov15-86400000,cards:postCards});
 await env.DB.prepare("UPDATE rank_awards SET status='paid',paid_at=?").bind(nov15-86400000).run();
 await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider,rating) VALUES(100070,'pre-hit',22,'{}','{}',?,1,'approved','harbor','R'),(100071,'pre-miss',22,'{}','{}',?,1,'approved','harbor','R')").bind(oct16,oct16+1000).run();
 await env.DB.prepare('INSERT INTO rank_publications(card_id,published_at,captured_at) VALUES(100070,?,?),(100071,?,?)').bind(oct16,oct16,oct16+1000,oct16+1000).run();
 let heatCalls=0,payCalls=0;
 rankTransport.heats=async(_env,windows)=>{heatCalls++;return windows.map(w=>({...w,heat:w.roleId==='pre-hit'?95:10,complete:true}))};
 rankTransport.pay=async(_env,_token,input)=>{payCalls++;return input};
 expect((await releaseHeldRankPayouts(env,nov15)).status).toBe('settlement_incomplete');
 for(let i=0;i<3;i++)await rankMaintenance(env,nov15+i*60000);
 const callsAfterSettle=heatCalls;
 await rankMaintenance(env,nov15+300000);
 expect(heatCalls).toBe(callsAfterSettle);
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM rank_awards WHERE window='week' AND period='2026-10-12' AND status='paid'").first('n')).toBe(10);
 expect(await env.DB.prepare("SELECT rank,band,amount,payout_hold FROM rank_awards WHERE card_id=100070 AND window='week'").first()).toEqual({rank:7,band:10,amount:10000,payout_hold:1});
 expect(await env.DB.prepare("SELECT rank,band,amount,payout_hold FROM rank_awards WHERE card_id=100070 AND window='day'").first()).toEqual({rank:1,band:1,amount:5000,payout_hold:1});
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM community_awards WHERE member_id=? AND source='rank-v1'").bind(preAuthor).first('n')).toBe(2);
 const plan=(await env.DB.prepare("EXPLAIN QUERY PLAN SELECT id FROM rank_awards WHERE status='pending' AND payout_hold=0 AND (attempted_at IS NULL OR attempted_at<=?) ORDER BY attempted_at IS NOT NULL,attempted_at,awarded_at,id LIMIT 5").bind(nov15).all<{detail:string}>()).results.map(r=>r.detail).join('\n');
 expect(plan).toContain('rank_awards_payable');
 await rankPaymentMaintenance(env,nov15+360000);
 await rankPaymentMaintenance(env,nov15+420000);
 await rankPaymentMaintenance(env,nov15+480000);
 expect(payCalls).toBe(10);
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM rank_awards WHERE card_id=100070 AND status='pending' AND payout_hold=1").first('n')).toBe(2);
 await rankPaymentMaintenance({...env,RANK_PRE_LAUNCH_PAYOUTS_ENABLED:'true'},nov15+540000);
 expect(payCalls).toBe(12);
 expect(await releaseHeldRankPayouts(env,nov15+600000)).toEqual({status:'already_released',awardCount:2,totalAmount:15000});
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM rank_awards WHERE card_id=100070 AND status='paid'").first('n')).toBe(2);
});
it('asks for heat v2 per cohort and never settles a v2 window on an answer without that formula',async()=>{
 const dec2=Date.parse('2026-12-02T10:00:00+08:00');
 await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider,approved_hosted_role_id) VALUES(100001,'v2-source',11,'{}','{}',?,1,'approved','harbor','v2-hosted')").bind(dec2).run();
 await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at,decided_at) VALUES('v2-first',100001,'harbor','v2-source','first','approved',?,?)").bind(dec2,dec2).run();
 const asked:{formula?:string}[]=[];
 // An older Provider ignores the field and answers without it.
 rankTransport.heats=async(_env,windows)=>{asked.push(...windows);return windows.map(({formula:_f,...w})=>({...w,heat:100,complete:true}))};
 const dayDone=Date.parse('2026-12-04T00:00:00+08:00');
 await rankMaintenance(env,dayDone);
 expect(asked.length).toBeGreaterThan(0);expect(asked.every(w=>w.formula==='v2')).toBe(true);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_window_scores').first('n')).toBe(0);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM rank_settlements').first('n')).toBe(0);
 rankTransport.heats=async(_env,windows)=>windows.map(w=>({...w,heat:100,complete:true}));
 await rankMaintenance(env,dayDone+60000);
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM rank_settlements WHERE window='day'").first('n')).toBe(2);
});
