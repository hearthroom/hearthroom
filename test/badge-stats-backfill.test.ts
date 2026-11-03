import {env} from 'cloudflare:test';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {resetDb,makeMember} from './helpers';
import {applyBadgeStats,badgeStatsTransport} from '../src/badge-stats';
import {badgeStatsBackfill} from '../src/badge-stats-backfill';
import {opsMetrics} from '../src/ops-metrics';
const original=badgeStatsTransport.read;
beforeEach(resetDb);afterEach(()=>{badgeStatsTransport.read=original});
const value=(accountNo:number,effectiveInvites=10)=>({accountNo,effectiveInvites,netTopupUsdMicros:0,consumedCredits:0,complete:true});
async function enqueue(member:string,accountNo:number){await env.DB.prepare("INSERT INTO badge_stats_backfill_members(job_key,member_id,account_no) VALUES('invite-source-v2',?,?)").bind(member,accountNo).run()}
it('recomputes zero and absent caches once, preserving earned dates and completing the snapshot',async()=>{
 const a=await makeMember(11),b=await makeMember(22);
 await applyBadgeStats(env,a,value(11,0),1);await enqueue(a,11);await enqueue(b,22);
 let reads=0;badgeStatsTransport.read=async(_env,numbers)=>{reads++;return numbers.map(n=>value(n))};
 await badgeStatsBackfill(env,100);await badgeStatsBackfill(env,200);
 expect(reads).toBe(1);
 expect((await env.DB.prepare('SELECT effective_invites FROM badge_qualifications ORDER BY account_no').all()).results).toEqual([{effective_invites:10},{effective_invites:10}]);
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM community_awards WHERE badge IN('invite_3','invite_10') AND created_at=100").first('n')).toBe(4);
 expect(await env.DB.prepare("SELECT completed_at FROM badge_stats_backfill_runs WHERE job_key='invite-source-v2'").first('completed_at')).toBe(100);
 expect(await opsMetrics(env.DB)).toContain('hearthroom_badge_stats_total{operation="backfill",outcome="success"} 1');
});
it('keeps missing, incomplete and failed upstream reads pending without turning them into zero',async()=>{
 const a=await makeMember(11);await enqueue(a,11);await applyBadgeStats(env,a,value(11),1);
 badgeStatsTransport.read=async()=>[];await badgeStatsBackfill(env,10);
 expect(await env.DB.prepare('SELECT last_error FROM badge_stats_backfill_members').first('last_error')).toBe('unavailable');
 badgeStatsTransport.read=async()=>[{...value(11,0),complete:false}];await badgeStatsBackfill(env,20);
 expect(await env.DB.prepare('SELECT last_error FROM badge_stats_backfill_members').first('last_error')).toBe('incomplete');
 badgeStatsTransport.read=async()=>{throw Error('synthetic unavailable')};await badgeStatsBackfill(env,30);
 expect(await opsMetrics(env.DB)).toContain('hearthroom_badge_stats_total{operation="backfill",outcome="error"} 1');
 expect(await opsMetrics(env.DB)).toContain('hearthroom_badge_stats_total{operation="backfill",outcome="pending"} 2');
 expect(await env.DB.prepare('SELECT status FROM badge_stats_backfill_members').first('status')).toBe('pending');
 expect(await env.DB.prepare('SELECT effective_invites FROM badge_qualifications').first('effective_invites')).toBe(10);
 badgeStatsTransport.read=async()=>[value(11,3)];await badgeStatsBackfill(env,40);
 expect(await env.DB.prepare('SELECT status FROM badge_stats_backfill_members').first('status')).toBe('done');
});
it('does not apply a snapshot after ownership changes',async()=>{
 const a=await makeMember(11),b=await makeMember(22);await enqueue(a,11);
 await env.DB.prepare("DELETE FROM member_identities WHERE member_id=? AND provider='harbor'").bind(b).run();
 badgeStatsTransport.read=async()=>{
  await env.DB.prepare("UPDATE member_identities SET member_id=? WHERE provider='harbor' AND external_id='11'").bind(b).run();
  return [value(11)];
 };
 await badgeStatsBackfill(env,10);
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM badge_qualifications').first('n')).toBe(0);
 expect(await env.DB.prepare('SELECT status FROM badge_stats_backfill_members').first('status')).toBe('identity_changed');
});

it('does not complete a stale receipt and retries with bounded batches',async()=>{
 const a=await makeMember(11);await enqueue(a,11);
 await env.DB.prepare("CREATE TRIGGER backfill_stale AFTER INSERT ON badge_qualification_refresh BEGIN UPDATE badge_qualification_refresh SET receipt='newer' WHERE member_id=NEW.member_id; END").run();
 badgeStatsTransport.read=async()=>[value(11)];
 try{
  await badgeStatsBackfill(env,1);
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM badge_qualifications').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT status FROM badge_stats_backfill_members').first('status')).toBe('pending');
 }finally{await env.DB.prepare('DROP TRIGGER backfill_stale').run()}
 for(let n=12;n<46;n++){const m=await makeMember(n);await enqueue(m,n)}
 const batches:number[]=[];badgeStatsTransport.read=async(_env,accounts)=>{batches.push(accounts.length);return accounts.map(n=>value(n))};
 await badgeStatsBackfill(env,2);await badgeStatsBackfill(env,3);
 expect(batches).toEqual([32,3]);
 expect(await env.DB.prepare("SELECT COUNT(*) n FROM badge_stats_backfill_members WHERE status='done'").first('n')).toBe(35);
});

it('snapshots every normal canonical linked member once and excludes fenced or test identities',async()=>{
 const a=await makeMember(11),b=await makeMember(22),c=await makeMember(33),retired=await makeMember(44);
 await env.DB.prepare("UPDATE members SET account_class='test' WHERE id=?").bind(c).run();
 await env.DB.prepare("INSERT INTO legacy_account_fence(public_no,member_id,handle,request_id,created_at) SELECT 279,id,handle,'backfill-fence',1 FROM members WHERE id=?").bind(retired).run();
 await env.DB.prepare("UPDATE badge_stats_backfill_runs SET seeded_at=NULL WHERE job_key='invite-source-v2'").run();
 const migration=env.TEST_MIGRATIONS.find(m=>m.name.startsWith('0109_'))!;
 for(const sql of migration.queries)await env.DB.prepare(sql).run();
 expect((await env.DB.prepare('SELECT member_id,account_no FROM badge_stats_backfill_members ORDER BY account_no').all()).results).toEqual([{member_id:a,account_no:11},{member_id:b,account_no:22}]);
 await makeMember(55);
 for(const sql of migration.queries)await env.DB.prepare(sql).run();
 expect(await env.DB.prepare('SELECT COUNT(*) n FROM badge_stats_backfill_members').first('n')).toBe(2);
});

it('drains persistent omissions with an explicit incomplete outcome, preserving the old cache',async()=>{
 const a=await makeMember(11);await enqueue(a,11);await applyBadgeStats(env,a,value(11),1);
 let reads=0;badgeStatsTransport.read=async()=>{reads++;return []};
 for(let attempt=0;attempt<6;attempt++)await badgeStatsBackfill(env,10+attempt);
 expect(reads).toBe(5);
 expect(await env.DB.prepare('SELECT status FROM badge_stats_backfill_members').first('status')).toBe('unavailable');
 expect(await env.DB.prepare('SELECT effective_invites FROM badge_qualifications').first('effective_invites')).toBe(10);
 expect(await env.DB.prepare("SELECT outcome FROM badge_stats_backfill_runs WHERE job_key='invite-source-v2'").first('outcome')).toBe('incomplete');
 expect(await opsMetrics(env.DB)).not.toContain('hearthroom_badge_stats_total{operation="backfill",outcome="success"}');
});
