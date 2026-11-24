import {SELF,env} from 'cloudflare:test';import {afterEach,beforeEach,expect,it} from 'vitest';
import {resetDb,makeMember,bearer,whoAmI,restoreUpstream} from './helpers';
import {badgeStatsTransport,claimSelfRefresh,runSelfRefresh,SELF_REFRESH_INTERVAL,type BadgeStats} from '../src/badge-stats';
import {badgeCollection,PROGRESS_ONLY,sweepMilestones} from '../src/community/badges';
import {STAT_FIRST_BADGES,awardFirstBadges} from '../src/community/first-badges';
import {opsMetrics} from '../src/ops-metrics';

const originalRead=badgeStatsTransport.read;
let member:string;
beforeEach(async()=>{await resetDb();member=await makeMember(11)});
afterEach(()=>{badgeStatsTransport.read=originalRead;restoreUpstream()});
const stats=(explored:number):BadgeStats=>({accountNo:11,effectiveInvites:0,netTopupUsdMicros:0,consumedCredits:0,complete:true,exploredRoles:explored,exploredRoles500At:null});
const explored=async()=>env.DB.prepare('SELECT explored_roles FROM badge_qualifications WHERE member_id=?').bind(member).first<number>('explored_roles');

it('refreshes the member once per ten minutes, counting routine refreshes too',async()=>{
 const calls:number[][]=[];badgeStatsTransport.read=async(_e,accounts)=>{calls.push(accounts);return [stats(5)]};
 const now=Date.now();
 const claim=await claimSelfRefresh(env,member,now);expect(claim?.accountNo).toBe(11);
 await runSelfRefresh(env,member,claim!,now);
 expect(calls).toEqual([[11]]);expect(await explored()).toBe(5);
 expect(await claimSelfRefresh(env,member,now+SELF_REFRESH_INTERVAL-1)).toBeNull();
 expect(await claimSelfRefresh(env,member,now+SELF_REFRESH_INTERVAL)).not.toBeNull();
 // 例行刷新剛輪到這個人，本人打開頁面也不再打 Harbor
 const other=await makeMember(22);
 await env.DB.prepare('INSERT INTO badge_qualification_refresh(member_id,receipt,attempted_at) VALUES(?,?,?)').bind(other,'routine',now).run();
 expect(await claimSelfRefresh(env,other,now+60000)).toBeNull();
 const metrics=await opsMetrics(env.DB);
 expect(metrics).toContain('hearthroom_badge_stats_total{operation="self",outcome="success"} 1');
 expect(metrics).toContain('hearthroom_badge_stats_total{operation="self",outcome="throttled"} 2');
});

it('keeps stored values when Harbor fails and skips members without a usable link',async()=>{
 await env.DB.prepare("INSERT INTO badge_qualifications(member_id,account_no,effective_invites,net_topup_usd_micros,consumed_credits,verified_at,explored_roles) VALUES(?,11,0,0,0,1,3)").bind(member).run();
 badgeStatsTransport.read=async()=>{throw new Error('badge_stats_unavailable')};
 const claim=await claimSelfRefresh(env,member);await runSelfRefresh(env,member,claim!);
 expect(await explored()).toBe(3);
 expect(await opsMetrics(env.DB)).toContain('hearthroom_badge_stats_total{operation="self",outcome="error"} 1');
 await env.DB.prepare("UPDATE members SET account_class='test' WHERE id=?").bind(member).run();
 expect(await claimSelfRefresh(env,member,Date.now()+SELF_REFRESH_INTERVAL)).toBeNull();
});

it('refreshes only when the badge page asks for it, and flags only the read that started one',async()=>{
 let calls=0;badgeStatsTransport.read=async()=>{calls++;return [stats(4)]};whoAmI(11);
 const read=async(q='')=>(await SELF.fetch('https://c.test/v1/me/community/badges'+q,{headers:bearer('valid')})).json<{refreshing?:boolean}>();
 // 我的頁、展示徽章等其他讀取不帶 refresh，不占 10 分鐘的額度
 expect((await read()).refreshing).toBeUndefined();
 expect((await read('?refresh=1')).refreshing).toBe(true);
 expect((await read()).refreshing).toBeUndefined();
 expect((await read('?refresh=1')).refreshing).toBeUndefined();
 expect(calls).toBeLessThanOrEqual(1);
});

it('shows the wanderer progress from the explored count without awarding it from the wall or the sweep',async()=>{
 await env.DB.prepare("INSERT INTO badge_qualifications(member_id,account_no,effective_invites,net_topup_usd_micros,consumed_credits,verified_at,explored_roles,explored_roles_500_at) VALUES(?,11,0,0,0,1,3,NULL)").bind(member).run();
 let wall=await badgeCollection(env,member);
 const wanderer=()=>wall.items.find(b=>b.key==='sole_wanderer');
 expect(wanderer()?.progress).toEqual({value:3,target:500});expect(wanderer()?.pausedMet).toBeUndefined();
 expect(wall.items.filter(b=>b.series==='explorer').map(b=>b.key).sort()).toEqual(['player_explorer_10','player_explorer_100','player_explorer_300','player_explorer_50','sole_wanderer']);
 await env.DB.prepare('UPDATE badge_qualifications SET explored_roles=612,explored_roles_500_at=? WHERE member_id=?').bind(Date.now()-10*86400000,member).run();
 wall=await badgeCollection(env,member);
 expect(wanderer()).toMatchObject({state:'locked',progress:{value:500,target:500},pausedMet:true});
 await sweepMilestones(env);await awardFirstBadges(env,STAT_FIRST_BADGES);
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM community_awards WHERE badge LIKE 'sole_wanderer%'").first('n')).toBe(0);
 const publicWall=await badgeCollection(env,member,true);
 expect(publicWall.items.find(b=>b.key==='sole_wanderer')?.progress).toBeUndefined();
});

it('keeps the paused flag in step with the first-badge release list',()=>{
 for(const [key,only] of Object.entries(PROGRESS_ONLY))expect(only.paused).toBe(!STAT_FIRST_BADGES.some(b=>b.key===key));
});
