import {env} from 'cloudflare:test';import{beforeEach,afterEach,expect,it}from'vitest';
import{resetDb,makeMember}from'./helpers';import{applyBadgeStats,badgeStatsMaintenance,badgeStatsTransport}from'../src/badge-stats';import{badgeCollection}from'../src/community/badges';import{opsMetrics}from'../src/ops-metrics';
const originalRead=badgeStatsTransport.read;afterEach(()=>{badgeStatsTransport.read=originalRead});
let member:string;beforeEach(async()=>{await resetDb();member=await makeMember(11)});
const stats={accountNo:11,effectiveInvites:10,netTopupUsdMicros:50000000,consumedCredits:300000,complete:true};
it('requires both spending thresholds, revokes after refund and never treats incomplete reads as zero',async()=>{
 await applyBadgeStats(env,member,{...stats,consumedCredits:299999});
 let wall=await badgeCollection(env,member);expect(wall.items.find(b=>b.key==='spend_1')?.state).toBe('earned');expect(wall.items.find(b=>b.key==='spend_2')?.state).toBe('locked');
 await applyBadgeStats(env,member,stats);wall=await badgeCollection(env,member);expect(wall.items.find(b=>b.key==='spend_2')?.state).toBe('earned');expect(wall.items.find(b=>b.key==='invite_10')?.state).toBe('earned');
 await applyBadgeStats(env,member,{...stats,netTopupUsdMicros:0,consumedCredits:0,effectiveInvites:0,complete:false});expect((await badgeCollection(env,member)).items.find(b=>b.key==='spend_2')?.state).toBe('earned');
 await applyBadgeStats(env,member,{...stats,netTopupUsdMicros:4000000,effectiveInvites:2});wall=await badgeCollection(env,member);expect(wall.items.find(b=>b.key==='spend_1')?.state).toBe('revoked');expect(wall.items.find(b=>b.key==='invite_3')?.state).toBe('revoked');
 await applyBadgeStats(env,member,stats);expect((await badgeCollection(env,member)).items.find(b=>b.key==='spend_2')?.state).toBe('earned');
});
it('reports missing qualifications as pending and does not overwrite a newer refresh receipt',async()=>{
 badgeStatsTransport.read=async()=>[];await badgeStatsMaintenance(env);
 expect(await opsMetrics(env.DB)).toContain('hearthroom_badge_stats_total{operation="refresh",outcome="pending"} 1');
 await applyBadgeStats(env,member,stats);
 await env.DB.prepare("UPDATE badge_qualification_refresh SET receipt='newer' WHERE member_id=?").bind(member).run();
 await applyBadgeStats(env,member,{...stats,effectiveInvites:0,netTopupUsdMicros:0,consumedCredits:0},Date.now(),'stale');
 expect((await badgeCollection(env,member)).items.find(b=>b.key==='spend_2')?.state).toBe('earned');
});
it('revalidates identity inside the qualification write after a concurrent link transfer',async()=>{
 const other=await makeMember(22);await env.DB.prepare("DELETE FROM member_identities WHERE member_id=? AND provider='harbor'").bind(other).run();
 await env.DB.prepare(`CREATE TRIGGER badge_test_transfer AFTER INSERT ON badge_qualification_refresh BEGIN UPDATE member_identities SET member_id='${other}' WHERE provider='harbor' AND external_id='11'; END`).run();
 try{
  await applyBadgeStats(env,member,stats);
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM badge_qualifications WHERE member_id=?').bind(member).first('n')).toBe(0);
  expect(await env.DB.prepare("SELECT COUNT(*) n FROM community_awards WHERE member_id=? AND badge IN('spend_1','spend_2','invite_3','invite_10')").bind(member).first('n')).toBe(0);
 }finally{await env.DB.prepare('DROP TRIGGER badge_test_transfer').run()}
});

it('updates complete invitation totals while incomplete currency totals preserve spending qualifications',async()=>{
 await applyBadgeStats(env,member,stats);
 await applyBadgeStats(env,member,{...stats,effectiveInvites:2,netTopupUsdMicros:0,consumedCredits:0,complete:false,invitesComplete:true,spendingComplete:false});
 const wall=await badgeCollection(env,member);
 expect(wall.items.find(b=>b.key==='invite_3')?.state).toBe('revoked');
 expect(wall.items.find(b=>b.key==='spend_2')?.state).toBe('earned');
 expect(await env.DB.prepare('SELECT net_topup_usd_micros FROM badge_qualifications WHERE member_id=?').bind(member).first('net_topup_usd_micros')).toBe(50000000);
});
