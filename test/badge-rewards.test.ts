import {env,SELF,createExecutionContext,waitOnExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream,whoAmI,bearer} from './helpers';
import worker from '../src/index';
import {upstream,type PayResult} from '../src/upstream';
import {cardRewardTransport} from '../src/card-reward-service';
import {badgeCollection} from '../src/community/badges';
import {claimBadgeReward,badgeRewardMaintenance} from '../src/community/badge-rewards';
import {opsMetrics} from '../src/ops-metrics';

const realPay=upstream.payCampaign,realToken=cardRewardTransport.token;
let member:string;const paid:{key:string;accountNo:number;amount:number;campaignRef:string;contentRef:string}[]=[];
let next:PayResult['kind']='paid';
beforeEach(async()=>{
 await resetDb();member=await makeMember(11);paid.length=0;next='paid';
 cardRewardTransport.token=async()=>'service-only';
 upstream.payCampaign=async(_env,bearerToken,body)=>{expect(bearerToken).toBe('service-only');paid.push(body);
  return next==='paid'?{kind:'paid',entryId:'e',paidAt:'2026-11-20T00:00:00Z',replayed:false}:next==='rejected'?{kind:'rejected',code:'pool_max_payout'}:{kind:next} as PayResult;};
});
afterEach(()=>{upstream.payCampaign=realPay;cardRewardTransport.token=realToken;restoreUpstream();});
const award=(badge:string,who=member)=>env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,?,'test',1)").bind(who,badge).run();
/** 等背景發點跑完（waitUntil 不擋回應） */
const settled=async()=>{for(let i=0;i<50;i++){if(!(await env.DB.prepare("SELECT 1 FROM badge_reward_claims WHERE status='pending' AND attempted_at IS NULL").first()))return;await new Promise(r=>setTimeout(r,20));}};
const claim=(key:string)=>SELF.fetch(`https://c.test/v1/me/community/badges/${key}/claim`,{method:'POST',headers:bearer('valid')});

it('pays an earned badge once from the activity pool with the amount the server decides',async()=>{
 await award('member_profile');whoAmI(11);
 const before=(await badgeCollection(env,member)).items.find(b=>b.key==='member_profile');
 expect(before).toMatchObject({reward:100});expect(before).not.toHaveProperty('claim');
 const res=await claim('member_profile');expect(res.status).toBe(200);
 const body=await res.json<{items:{key:string;claim?:string}[]}>();
 // 回應不等發點：記下就回「發放中」，發點在回應之後背景進行
 expect(['pending','paid']).toContain(body.items.find(b=>b.key==='member_profile')?.claim);
 await settled();
 expect(paid).toHaveLength(1);expect(paid[0]).toMatchObject({accountNo:11,amount:100,campaignRef:'badges-v1',contentRef:'badge:member_profile'});
 expect(paid[0].key).toMatch(/^badge-[0-9a-f]{32}$/);
 expect((await claim('member_profile')).status).toBe(200);await settled();expect(paid).toHaveLength(1);
 expect(await opsMetrics(env.DB)).toContain('hearthroom_badge_rewards_total{operation="payout",outcome="success"} 1');
});

it('refuses badges that pay nothing or are not earned, and members without a payout account',async()=>{
 whoAmI(11);
 await award('opening_veteran');await award('spend_1');await award('rank_clean_day_1');
 for(const key of ['opening_veteran','spend_1','rank_clean_day_1','creator_works_30','no_such_badge'])expect((await claim(key)).status,key).toBe(409);
 expect((await badgeCollection(env,member)).items.find(b=>b.key==='opening_veteran')).not.toHaveProperty('reward');
 await env.DB.prepare("INSERT INTO members(id,handle,created_at) VALUES('loose','loosehdl',0)").run();
 await award('member_profile','loose');
 await expect(claimBadgeReward(env,'loose','member_profile',100)).rejects.toThrow('badge_reward_unlinked');
 await env.DB.prepare("UPDATE members SET account_class='test' WHERE id=?").bind(member).run();await award('member_profile');
 await expect(claimBadgeReward(env,member,'member_profile',100)).rejects.toThrow('badge_reward_unavailable');
 expect(paid).toHaveLength(0);
});

it('retries an unconfirmed payout with the same key and voids it if the badge is revoked first',async()=>{
 await award('member_profile');await award('player_saver');
 next='unknown';
 expect(await claimBadgeReward(env,member,'member_profile',100,1000)).toBe('pending');
 expect(await claimBadgeReward(env,member,'player_saver',100,1000)).toBe('pending');
 next='paid';
 await env.DB.prepare("UPDATE community_awards SET revoked_at=2 WHERE member_id=? AND badge='player_saver'").bind(member).run();
 await badgeRewardMaintenance(env,1000+60000);
 const rows=(await env.DB.prepare('SELECT badge,status FROM badge_reward_claims ORDER BY badge').all()).results;
 expect(rows).toEqual([{badge:'member_profile',status:'paid'},{badge:'player_saver',status:'void'}]);
 expect(paid.filter(p=>p.contentRef==='badge:member_profile').map(p=>p.key)).toEqual([paid[0].key,paid[0].key]);
});

it('records a provider refusal instead of retrying forever',async()=>{
 await award('member_profile');next='rejected';
 expect(await claimBadgeReward(env,member,'member_profile',100)).toBe('rejected');
 expect(await env.DB.prepare('SELECT error FROM badge_reward_claims').first('error')).toBe('pool_max_payout');
 await badgeRewardMaintenance(env,Date.now()+3600000);expect(paid).toHaveLength(1);
});

it('claims every claimable badge in one request and pays them all with one token',async()=>{
 await award('member_profile');await award('player_saver');await award('player_explorer_10');await award('spend_1');whoAmI(11);
 let tokens=0;cardRewardTransport.token=async()=>{tokens++;return 'service-only';};
 const res=await SELF.fetch('https://c.test/v1/me/community/badges/claim',{method:'POST',headers:{...bearer('valid'),'Content-Type':'application/json'},body:'{}'});
 expect(res.status).toBe(200);
 const body=await res.json<{items:{key:string;claim?:string}[]}>();
 expect(body.items.filter(b=>b.claim).map(b=>b.key).sort()).toEqual(['member_profile','player_explorer_10','player_saver']);
 await settled();
 expect(paid.map(p=>p.contentRef).sort()).toEqual(['badge:member_profile','badge:player_explorer_10','badge:player_saver']);
 expect(tokens).toBe(1);
 // 再按一次：沒有可領的，照樣回收藏，不重複付
 expect((await SELF.fetch('https://c.test/v1/me/community/badges/claim',{method:'POST',headers:{...bearer('valid'),'Content-Type':'application/json'},body:'{}'})).status).toBe(200);
 await settled();expect(paid).toHaveLength(3);
 // 指定一枚不能領的：409
 expect((await SELF.fetch('https://c.test/v1/me/community/badges/claim',{method:'POST',headers:{...bearer('valid'),'Content-Type':'application/json'},body:JSON.stringify({keys:['spend_1']})})).status).toBe(409);
});

it('freezes credit claims on the five conversation badges without revoking earned badges or prior paid claims',async()=>{
 const frozen=['player_explorer_50','player_explorer_100','player_explorer_300','sole_wanderer','sole_wanderer_pioneer'];
 const afterCutoff=Date.parse(env.CONVERSATION_BADGE_REWARD_FREEZE)+1000;
 for(const key of frozen)await env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,?,'test',?)").bind(member,key,afterCutoff).run();
 await award('member_profile');
 // 既已領取的不追回
 await env.DB.prepare("INSERT INTO badge_reward_claims(id,member_id,badge,amount,account_no,status,claimed_at,paid_at) VALUES('already1',?,'player_explorer_50',500,11,'paid',1,2)").bind(member).run();
 whoAmI(11);
 const wall=await badgeCollection(env,member);
 for(const key of frozen){
  const item=wall.items.find(b=>b.key===key);
  expect(item,key).toMatchObject({state:'earned'});
  expect(item,key).not.toHaveProperty('reward');
 }
 expect(wall.items.find(b=>b.key==='player_explorer_50')?.claim).toBe('paid');
 expect(wall.items.find(b=>b.key==='player_explorer_50')?.claimAmount).toBe(500);
 // 單枚領取未領過的凍結徽章：409
 for(const key of frozen.slice(1))expect((await claim(key)).status,key).toBe(409);
 // 單枚重送已領過的：保持冪等 200、不重付也不改紀錄
 expect((await claim('player_explorer_50')).status).toBe(200);
 // 全部領取：只領未凍結的 member_profile，跳過五枚凍結徽章
 const allRes=await SELF.fetch('https://c.test/v1/me/community/badges/claim',{method:'POST',headers:{...bearer('valid'),'Content-Type':'application/json'},body:'{}'});
 expect(allRes.status).toBe(200);
 await settled();
 expect(paid.map(p=>p.contentRef)).toEqual(['badge:member_profile']);
 expect(await env.DB.prepare("SELECT status,amount FROM badge_reward_claims WHERE id='already1'").first()).toEqual({status:'paid',amount:500});
 // 保留「全部歸零」開關：即使早於截止時間，設為 all 也一律歸零
 const allFreezeEnv={...env,CONVERSATION_BADGE_REWARD_FREEZE:'all'};
 await env.DB.prepare("UPDATE community_awards SET created_at=1 WHERE member_id=? AND badge='player_explorer_100'").bind(member).run();
 expect((await badgeCollection(allFreezeEnv,member)).items.find(b=>b.key==='player_explorer_100')).not.toHaveProperty('reward');
});

it('supports cutoff mode with pre-cutoff payout for normal members and exclusion list override',async()=>{
 const cutoff='2026-11-22T03:30:00Z';
 const cutoffMs=Date.parse(cutoff);
 const excluded=await makeMember(22);
 await env.DB.batch([
  // Normal member: explorer_50 earned before cutoff (eligible), explorer_100 earned at cutoff (frozen)
  env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,'player_explorer_50','metric-v1',?)").bind(member,cutoffMs-10_000),
  env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,'player_explorer_100','metric-v1',?)").bind(member,cutoffMs),
  // Excluded member: both earned well before cutoff, still frozen by exclusion list
  env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,'player_explorer_50','metric-v1',?)").bind(excluded,cutoffMs-60_000),
  env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,'sole_wanderer','sole-v1',?)").bind(excluded,cutoffMs-60_000),
 ]);
 const cutoffEnv={...env,CONVERSATION_BADGE_REWARD_FREEZE:cutoff,CONVERSATION_BADGE_FREEZE_EXCLUDED:`${excluded}, other-id`};
 const call=async(path:string,token:string,method='GET',body?:unknown)=>{
  const ctx=createExecutionContext();
  const res=await worker.fetch(new Request(`https://c.test${path}`,{method,headers:{...bearer(token),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),cutoffEnv,ctx);
  await waitOnExecutionContext(ctx);
  return res;
 };

 // Normal member sees reward on pre-cutoff explorer_50, no reward on post-cutoff explorer_100 or locked explorer_300
 whoAmI(11);
 const normalWall=await (await call('/v1/me/community/badges','norm')).json<{items:{key:string;reward?:number;claim?:string}[]}>();
 expect(normalWall.items.find(b=>b.key==='player_explorer_50')?.reward).toBe(500);
 expect(normalWall.items.find(b=>b.key==='player_explorer_100')).not.toHaveProperty('reward');
 expect(normalWall.items.find(b=>b.key==='player_explorer_300')).not.toHaveProperty('reward');
 expect((await call('/v1/me/community/badges/player_explorer_100/claim','norm','POST')).status).toBe(409);
 expect((await call('/v1/me/community/badges/player_explorer_50/claim','norm','POST')).status).toBe(200);
 expect(paid.map(p=>({accountNo:p.accountNo,contentRef:p.contentRef,amount:p.amount}))).toEqual([{accountNo:11,contentRef:'badge:player_explorer_50',amount:500}]);

 // Excluded member sees no reward and cannot claim either pre-cutoff badge
 whoAmI(22);
 const excludedWall=await (await call('/v1/me/community/badges','excl')).json<{items:{key:string;reward?:number}[]}>();
 expect(excludedWall.items.find(b=>b.key==='player_explorer_50')).not.toHaveProperty('reward');
 expect(excludedWall.items.find(b=>b.key==='sole_wanderer')).not.toHaveProperty('reward');
 expect((await call('/v1/me/community/badges/player_explorer_50/claim','excl','POST')).status).toBe(409);
 expect((await call('/v1/me/community/badges/sole_wanderer/claim','excl','POST')).status).toBe(409);
 expect(paid).toHaveLength(1);
});

it('voids pre-existing pending claims for frozen or excluded badges during maintenance retry',async()=>{
 const cutoff='2026-11-22T03:30:00Z';
 const cutoffMs=Date.parse(cutoff);
 const excluded=await makeMember(22);
 await env.DB.batch([
  env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,'player_explorer_50','metric-v1',?)").bind(member,cutoffMs-5000),
  env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,'player_explorer_100','metric-v1',?)").bind(member,cutoffMs+5000),
  env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,'sole_wanderer','sole-v1',?)").bind(excluded,cutoffMs-5000),
  env.DB.prepare("INSERT INTO badge_reward_claims(id,member_id,badge,amount,account_no,status,claimed_at) VALUES('p-ok',?,'player_explorer_50',500,11,'pending',1000)").bind(member),
  env.DB.prepare("INSERT INTO badge_reward_claims(id,member_id,badge,amount,account_no,status,claimed_at) VALUES('p-post',?,'player_explorer_100',2000,11,'pending',1000)").bind(member),
  env.DB.prepare("INSERT INTO badge_reward_claims(id,member_id,badge,amount,account_no,status,claimed_at) VALUES('p-excl',?,'sole_wanderer',30000,22,'pending',1000)").bind(excluded),
 ]);
 const cutoffEnv={...env,CONVERSATION_BADGE_REWARD_FREEZE:cutoff,CONVERSATION_BADGE_FREEZE_EXCLUDED:excluded};
 await badgeRewardMaintenance(cutoffEnv,cutoffMs+100_000);
 const rows=(await env.DB.prepare('SELECT id,status FROM badge_reward_claims ORDER BY id').all<{id:string;status:string}>()).results;
 expect(rows).toEqual([
  {id:'p-excl',status:'void'},
  {id:'p-ok',status:'paid'},
  {id:'p-post',status:'void'},
 ]);
 expect(paid.map(p=>p.contentRef)).toEqual(['badge:player_explorer_50']);
});
