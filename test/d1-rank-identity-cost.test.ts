import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testCardIds } from '../src/test-accounts';
import { rankMaintenance } from '../src/rank-maintenance';
import { makeMember, resetDb } from './helpers';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

it('classifies both original and connected authors in one indexed exclusion set, without per-card identity subqueries', async () => {
  const normal = await makeMember(11), test = await makeMember(22), legacy = await makeMember(33);
  await env.DB.prepare("UPDATE members SET account_class='test' WHERE id=?").bind(test).run();
  await env.DB.prepare("INSERT INTO member_connections(provider,external_id,owner_member_id,linked_at) VALUES('harbor','22',?,1),('harbor','11',?,1)").bind(normal,test).run();
  await env.DB.prepare("INSERT INTO legacy_account_fence(public_no,member_id,handle,request_id,created_at) VALUES(279,?,'fixture','cost-test',1)").bind(legacy).run();
  await env.DB.prepare("INSERT INTO cards(id,provider,source_role_id,author_num_id,registered_at,last_synced_at,status) VALUES(100001,'harbor','original-test',22,1,1,'approved'),(100002,'harbor','connected-test',11,1,1,'approved'),(100003,'harbor','fenced',33,1,1,'approved'),(100004,'harbor','unknown',44,1,1,'approved'),(100005,'lunatalk','other-provider',11,1,1,'approved')").run();
  const original = env.DB.prepare.bind(env.DB), queries: string[] = [];
  vi.spyOn(env.DB, 'prepare').mockImplementation(sql => { queries.push(sql); return original(sql); });
  expect([...await testCardIds(env.DB, ['100001','100002','100003','100004','100005','100005',...Array.from({length:44},(_,i)=>String(999000+i))])].sort()).toEqual(['100001','100002','100003']);
  expect(queries).toHaveLength(1);
  const plan = (await original(`EXPLAIN QUERY PLAN ${queries[0]}`).bind('[100001,100002,100003,100004,100005]').all<{detail:string}>()).results.map(r=>r.detail).join('\n');
  expect(plan).not.toMatch(/CORRELATED SCALAR SUBQUERY/);
  expect(plan).toContain('idx_members_test_ids');
  expect(plan).not.toMatch(/SCAN (?:i|x)\b/);
  expect(plan).not.toMatch(/SCAN members(?:\n|$)/);
});

it('keeps empty and single-card checks on direct indexed seeks', async () => {
  const test=await makeMember(22);
  await env.DB.prepare("UPDATE members SET account_class='test' WHERE id=?").bind(test).run();
  await env.DB.prepare("INSERT INTO cards(id,provider,source_role_id,author_num_id,registered_at,last_synced_at,status) VALUES(100001,'harbor','single-test',22,1,1,'approved')").run();
  const original=env.DB.prepare.bind(env.DB),queries:string[]=[];
  vi.spyOn(env.DB,'prepare').mockImplementation(sql=>{queries.push(sql);return original(sql);});
  expect([...await testCardIds(env.DB,[])]).toEqual([]);expect(queries).toHaveLength(0);
  expect([...await testCardIds(env.DB,['100001'])]).toEqual(['100001']);
  expect(queries).toHaveLength(1);expect(queries[0]).not.toContain('MATERIALIZED');
});

it('captures only missing publication proof and seeks completed corrections by submission', async () => {
  const original = env.DB.prepare.bind(env.DB), queries: {sql:string;values:unknown[]}[] = [];
  vi.spyOn(env.DB,'prepare').mockImplementation(sql => {
    const stmt=original(sql);
    if(sql.startsWith('INSERT OR IGNORE INTO rank_publications')){
      const bind=stmt.bind.bind(stmt);
      stmt.bind=((...values:unknown[])=>{queries.push({sql,values});return bind(...values);}) as typeof stmt.bind;
    }
    return stmt;
  });
  await rankMaintenance(env,Date.parse('2026-10-17T00:00:00+08:00'));
  expect(queries).toHaveLength(1);
  const {sql,values}=queries[0];
  const plan=(await original(`EXPLAIN QUERY PLAN ${sql}`).bind(...values).all<{detail:string}>()).results.map(r=>r.detail).join('\n');
  expect(plan).toMatch(/SEARCH p USING INTEGER PRIMARY KEY/);
  expect(plan).not.toMatch(/SCAN x\b/);
  expect(plan).toContain('idx_registrations_source_time');
});
