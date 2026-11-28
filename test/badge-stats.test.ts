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

it('refreshes the next eight eligible owners in attempt order with a bounded identity lookup cost', async () => {
  await env.DB.batch([
    env.DB.prepare(`WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1199)
      INSERT INTO members(id,handle,created_at,account_class)
      SELECT printf('badge-%04d',x),printf('badge-%04d',x),1,CASE x WHEN 0 THEN 'test' ELSE 'normal' END FROM n`),
    env.DB.prepare(`INSERT INTO member_identities(provider,external_id,member_id,linked_at)
      SELECT 'harbor',CAST(10000+CAST(substr(id,7) AS INTEGER) AS TEXT),id,
        CASE id WHEN 'badge-0008' THEN 2 ELSE 1 END
      FROM members WHERE id GLOB 'badge-*' AND id NOT IN ('badge-0002','badge-0005')`),
    env.DB.prepare(`INSERT INTO member_connections(provider,external_id,owner_member_id,linked_at) VALUES
      ('harbor','10003','badge-0004',1),('harbor','10006','badge-0005',1),('harbor','10008','badge-0007',1)`),
    env.DB.prepare(`INSERT INTO legacy_account_fence(public_no,member_id,request_id,created_at)
      VALUES(279,'badge-0001','badge-refresh-fixture',1)`),
    env.DB.prepare(`INSERT INTO badge_qualification_refresh(member_id,receipt,attempted_at)
      SELECT id,'previous',CASE WHEN id<'badge-0014' THEN 10 ELSE 20 END
      FROM members WHERE id GLOB 'badge-*' AND id>='badge-0010'`),
    env.DB.prepare('INSERT INTO badge_qualification_refresh(member_id,receipt,attempted_at) VALUES(?,?,?)')
      .bind(member, 'previous', 200),
  ]);
  const requested: number[][] = [];
  badgeStatsTransport.read = async (_env, accountNos) => {
    requested.push(accountNos);
    return [];
  };
  const candidateReads: number[] = [];
  const db = new Proxy(env.DB, {
    get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        const statement = target.prepare(sql);
        if (!/^\s*(SELECT|WITH)\b/i.test(sql) || !sql.includes('badge_qualification_refresh')) return statement;
        return { all: async () => {
          const result = await statement.all();
          candidateReads.push(result.meta.rows_read);
          return result;
        } };
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await badgeStatsMaintenance({ ...env, DB: db }, 1000);
  expect(requested).toEqual([[10003, 10006, 10008, 10009, 10010, 10011, 10012, 10013]]);
  expect(candidateReads).toHaveLength(1);
  expect(candidateReads[0]).toBeGreaterThan(0);
  console.info('Scheduled badge refresh candidate rows read:', candidateReads[0]);
  expect(candidateReads[0]).toBeLessThan(5000);
});
