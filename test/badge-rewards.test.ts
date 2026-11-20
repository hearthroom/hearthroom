import {env,SELF} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream,whoAmI,bearer} from './helpers';
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
const claim=(key:string)=>SELF.fetch(`https://c.test/v1/me/community/badges/${key}/claim`,{method:'POST',headers:bearer('valid')});

it('pays an earned badge once from the activity pool with the amount the server decides',async()=>{
 await award('member_profile');whoAmI(11);
 const before=(await badgeCollection(env,member)).items.find(b=>b.key==='member_profile');
 expect(before).toMatchObject({reward:100});expect(before).not.toHaveProperty('claim');
 const res=await claim('member_profile');expect(res.status).toBe(200);
 const body=await res.json<{items:{key:string;claim?:string}[]}>();
 expect(body.items.find(b=>b.key==='member_profile')?.claim).toBe('paid');
 expect(paid).toHaveLength(1);expect(paid[0]).toMatchObject({accountNo:11,amount:100,campaignRef:'badges-v1',contentRef:'badge:member_profile'});
 expect(paid[0].key).toMatch(/^badge-[0-9a-f]{32}$/);
 expect((await claim('member_profile')).status).toBe(200);expect(paid).toHaveLength(1);
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
