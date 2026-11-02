import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it} from 'vitest';
import {resetDb,makeMember,restoreUpstream} from './helpers';
import {badgeCollection,setFeaturedBadges,sweepMilestones} from '../src/community/badges';
import {settleRankSnapshot} from '../src/rank-awards';
import {publicCommunityView} from '../src/community/service';
let member:string;const launch=Date.parse('2026-10-17T00:00:00+08:00'),end=Date.parse('2026-11-18T00:00:00+08:00');
beforeEach(async()=>{await resetDb();member=await makeMember(11);await env.DB.prepare('UPDATE members SET created_at=?').bind(end).run()});afterEach(restoreUpstream);
it('converts the old founder into the correct veteran and honors inclusive launch-month dates',async()=>{
 for(const [time,key] of [[launch-1,'beta_veteran'],[launch,'opening_veteran'],[end-1,'opening_veteran'],[end,'']] as const){
  await env.DB.prepare('DELETE FROM community_awards WHERE member_id=?').bind(member).run();await env.DB.prepare('UPDATE members SET created_at=? WHERE id=?').bind(time,member).run();
  const wall=await badgeCollection(env,member);expect(wall.items.some(b=>b.key==='member_founder')).toBe(false);
  expect(wall.items.filter(b=>['beta_veteran','opening_veteran'].includes(b.key)&&b.state==='earned').map(b=>b.key)).toEqual(key?[key]:[]);
 }
});
it('counts permanent rank award events once and reveals spending badges only when explicitly pinned',async()=>{
 const at=launch;await settleRankSnapshot(env,{zone:'clean',window:'day',period:'2026-10-17',now:end,cards:[{id:100001,heat:100,talkNum:1,registeredAt:at,adult:false,memberId:member,accountNo:11}]});
 await settleRankSnapshot(env,{zone:'clean',window:'day',period:'2026-10-18',now:end,cards:[{id:100002,heat:100,talkNum:1,registeredAt:at+86400000,adult:false,memberId:member,accountNo:11}]});
 await env.DB.prepare("INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,'spend_1','badge-stats',1)").bind(member).run();
 await env.DB.prepare('INSERT INTO community_preferences(member_id,public_badges) VALUES(?,1)').bind(member).run();
 const own=await badgeCollection(env,member);expect(own.items.find(b=>b.key==='rank_clean_day_1')).toMatchObject({state:'earned',count:2,lastPeriod:'2026-10-18'});
 expect((await badgeCollection(env,member,true)).items.some(b=>b.key==='spend_1')).toBe(false);
 expect((await publicCommunityView(env,member)).badges).not.toContain('spend_1');
 await setFeaturedBadges(env,member,['spend_1','rank_clean_day_1']);
 expect((await badgeCollection(env,member,true)).items.find(b=>b.key==='spend_1')).toMatchObject({count:1,state:'earned'});
 expect((await publicCommunityView(env,member)).badges).toEqual(['spend_1','rank_clean_day_1']);
 // Sweeping automatic milestones does not inflate rank counts.
 await sweepMilestones(env);expect((await badgeCollection(env,member)).items.find(b=>b.key==='rank_clean_day_1')?.count).toBe(2);
});
it('projects an existing permanent honor after its Harbor author links a community identity',async()=>{
 await settleRankSnapshot(env,{zone:'clean',window:'day',period:'2026-10-17',now:end,cards:[{id:100001,heat:100,talkNum:1,registeredAt:launch,adult:false,memberId:null,accountNo:11}]});
 const {rankMaintenance}=await import('../src/rank-maintenance');
 await rankMaintenance(env,end);
 expect((await badgeCollection(env,member)).items.find(b=>b.key==='rank_clean_day_1')).toMatchObject({state:'earned',count:1});
 await env.DB.prepare('INSERT INTO community_preferences(member_id,public_badges) VALUES(?,1)').bind(member).run();
 expect((await publicCommunityView(env,member)).badges).toContain('rank_clean_day_1');
});
