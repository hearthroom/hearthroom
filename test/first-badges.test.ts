import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream} from './helpers';
import {applyBadgeStats,type BadgeStats} from '../src/badge-stats';
import {awardFirstBadges,STAT_FIRST_BADGES} from '../src/community/first-badges';
import {badgeCollection,sweepMilestones} from '../src/community/badges';
import {badgeRarity,badgeReward} from '../shared/badge-rarity';

const DAY=86400000,base=Date.parse('2027-03-01T00:00:00Z');
const members:string[]=[];
beforeEach(async()=>{await resetDb();members.length=0;for(let i=1;i<=12;i++)members.push(await makeMember(100+i));});
afterEach(restoreUpstream);
const stats=(n:number,extra:Partial<BadgeStats>):BadgeStats=>({accountNo:100+n,effectiveInvites:0,netTopupUsdMicros:0,consumedCredits:0,complete:true,...extra});
const lighthouse=(n:number,at:number)=>applyBadgeStats(env,members[n-1],stats(n,{paidInvites:100,paidInvites100At:new Date(at).toISOString()}),base);
const holders=async(badge:string)=>(await env.DB.prepare('SELECT member_id,created_at FROM community_awards WHERE badge=? ORDER BY created_at').bind(badge).all<{member_id:string;created_at:number}>()).results;

it('rates and pays the one-of-a-kind badges as designed',()=>{
 expect(badgeRarity({key:'sole_lighthouse',category:'invite'})).toBe('unique');
 expect(badgeRarity({key:'sole_lighthouse_pioneer',category:'invite'})).toBe('epic');
 expect(badgeReward({key:'sole_lighthouse',category:'invite'})).toBe(100000);
 expect(badgeReward({key:'sole_starlight',category:'spend'})).toBe(0);
 expect(badgeReward({key:'sole_starlight_pioneer',category:'spend'})).toBe(0);
 expect(badgeReward({key:'invite_paid_10',category:'invite'})).toBe(2000);
});

it('awards the paid-friends milestone from the Harbor count',async()=>{
 await applyBadgeStats(env,members[0],stats(1,{paidInvites:10}),base);
 await sweepMilestones(env);
 expect((await badgeCollection(env,members[0])).items.find(b=>b.key==='invite_paid_10')).toMatchObject({state:'earned'});
});

it('crowns whoever crossed first, not whoever was read first, once the hold has passed',async()=>{
 await lighthouse(2,base-5*DAY);             // 先讀到，越線較晚
 await lighthouse(3,base-2*DAY);             // 還在 7 天確認期內
 await awardFirstBadges(env,STAT_FIRST_BADGES,base);
 expect(await holders('sole_lighthouse')).toEqual([]);   // 確認期沒過，誰都不發
 await lighthouse(1,base-6*DAY);             // 晚讀到，越線較早
 await awardFirstBadges(env,STAT_FIRST_BADGES,base+2*DAY);
 expect((await holders('sole_lighthouse')).map(r=>r.member_id)).toEqual([members[0]]);
 expect((await holders('sole_lighthouse')).map(r=>r.created_at)).toEqual([base-6*DAY]);
 expect((await holders('sole_lighthouse_pioneer')).map(r=>r.member_id)).toEqual([members[1]]);
 await awardFirstBadges(env,STAT_FIRST_BADGES,base+6*DAY);
 expect((await holders('sole_lighthouse_pioneer')).map(r=>r.member_id)).toEqual([members[1],members[2]]);
 expect((await badgeCollection(env,members[2])).items.find(b=>b.key==='sole_lighthouse_pioneer')).toMatchObject({state:'earned'});
});

it('keeps a revoked crown empty and stops at nine pioneers',async()=>{
 for(let i=1;i<=12;i++)await lighthouse(i,base-30*DAY+i*1000);
 await awardFirstBadges(env,STAT_FIRST_BADGES,base);
 expect((await holders('sole_lighthouse')).map(r=>r.member_id)).toEqual([members[0]]);
 expect(await holders('sole_lighthouse_pioneer')).toHaveLength(9);
 await env.DB.prepare("UPDATE community_awards SET revoked_at=? WHERE badge='sole_lighthouse'").bind(base).run();
 await awardFirstBadges(env,STAT_FIRST_BADGES,base+DAY);
 expect((await holders('sole_lighthouse')).map(r=>r.member_id)).toEqual([members[0]]);
 expect(await env.DB.prepare("INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) VALUES(?,'sole_lighthouse','x',1)").bind(members[5]).run().then(r=>r.meta.changes)).toBe(0);
});

it('confirms the spending crown only after 30 days and only while both totals still qualify',async()=>{
 const crossed=base-20*DAY;
 await applyBadgeStats(env,members[0],stats(1,{netTopupUsdMicros:1_000_000_000,consumedCredits:6_000_000,starlightAt:new Date(crossed).toISOString()}),base);
 await awardFirstBadges(env,STAT_FIRST_BADGES,base);
 expect(await holders('sole_starlight')).toEqual([]);
 // 退款後淨儲值掉到門檻下：確認期到了也不發
 await applyBadgeStats(env,members[0],stats(1,{netTopupUsdMicros:900_000_000,consumedCredits:6_000_000,starlightAt:null}),base+1);
 await awardFirstBadges(env,STAT_FIRST_BADGES,crossed+31*DAY);
 expect(await holders('sole_starlight')).toEqual([]);
 await applyBadgeStats(env,members[0],stats(1,{netTopupUsdMicros:1_200_000_000,consumedCredits:6_500_000,starlightAt:new Date(crossed+DAY).toISOString()}),base+2);
 await awardFirstBadges(env,STAT_FIRST_BADGES,crossed+31*DAY);
 expect((await holders('sole_starlight')).map(r=>r.member_id)).toEqual([members[0]]);
});

it('leaves older Harbor responses without the new fields untouched',async()=>{
 await applyBadgeStats(env,members[0],stats(1,{paidInvites:120,paidInvites100At:new Date(base-20*DAY).toISOString()}),base);
 await applyBadgeStats(env,members[0],stats(1,{}),base+1);
 expect(await env.DB.prepare('SELECT paid_invites,paid_invites_100_at FROM badge_qualifications WHERE member_id=?').bind(members[0]).first()).toEqual({paid_invites:120,paid_invites_100_at:base-20*DAY});
});

it('awards the 500-character badge by verified crossing time after the full refresh round',async()=>{
 const wander=(n:number,count:number,at:number|null)=>applyBadgeStats(env,members[n-1],stats(n,{exploredRoles:count,exploredRoles500At:at===null?null:new Date(at).toISOString()}),base);
 await wander(1,499,null);
 await wander(2,500,base-2*DAY);
 await wander(3,520,base-3*DAY);
 // 全站刷完一輪後放行（2026-11-25）：照越線時間排，最早的拿唯一，下一位拿先驅；沒滿 500 的不算。
 await awardFirstBadges(env,STAT_FIRST_BADGES,base+10*DAY);
 expect(await holders('sole_wanderer')).toEqual([{member_id:members[2],created_at:base-3*DAY}]);
 expect(await holders('sole_wanderer_pioneer')).toEqual([{member_id:members[1],created_at:base-2*DAY}]);
 expect(await env.DB.prepare('SELECT explored_roles,explored_roles_500_at FROM badge_qualifications WHERE member_id=?').bind(members[2]).first()).toEqual({explored_roles:520,explored_roles_500_at:base-3*DAY});
 // 舊版 Harbor 沒有這兩個欄位：不動已存的數，徽章牆照舊顯示進度。
 await applyBadgeStats(env,members[0],stats(1,{}),base+1);
 await sweepMilestones(env);
 expect((await badgeCollection(env,members[0])).items.find(b=>b.key==='player_explorer_300')).toMatchObject({state:'earned',progress:{value:499,target:300}});
});
