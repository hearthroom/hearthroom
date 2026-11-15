import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { libraryRoutes } from '../src/library';
import { ownedHistory } from '../src/owned-history';
import { upstream } from '../src/upstream';
import type { Env } from '../src/types';
import { bearer, makeMember, resetDb, restoreUpstream, whoAmI } from './helpers';

beforeEach(resetDb);
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); });

async function seedHistory() {
  whoAmI(11);
  const member = await makeMember(11);
  const other = await makeMember(12);
  await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<32)
    INSERT INTO cards(id,provider,source_role_id,approved_hosted_role_id,author_num_id,registered_at,last_synced_at,status,rating)
    SELECT 100000+x,'harbor','cost-source-'||x,'cost-revision-'||x||'-4',11,1,1,'approved','G' FROM n`).run();
  await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<2400)
    INSERT INTO cards(id,provider,source_role_id,author_num_id,registered_at,last_synced_at,status,rating)
    SELECT 101000+x,'harbor','unrelated-source-'||x,12,1,1,'approved','G' FROM n`).run();
  await env.DB.prepare(`INSERT INTO card_numbers(num,provider,source_role_id)
    SELECT id,provider,source_role_id FROM cards WHERE id<101000`).run();
  await env.DB.prepare(`INSERT INTO works(id,member_id,source_provider,source_role_id,created_at)
    SELECT 'cost-work-'||(id-100000),?,'harbor',source_role_id,1 FROM cards WHERE id<101000`).bind(member).run();
  await env.DB.prepare(`WITH RECURSIVE versions(v) AS (SELECT 1 UNION ALL SELECT v+1 FROM versions WHERE v<4)
    INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,hosted_revision_id,state,created_at,rating)
    SELECT 'cost-version-'||(c.id-100000)||'-'||v,'cost-work-'||(c.id-100000),?,
      'cost-operation-'||(c.id-100000)||'-'||v,c.source_role_id,'harbor',
      'cost-revision-'||(c.id-100000)||'-'||v,'approved',1,'G'
    FROM cards c CROSS JOIN versions WHERE c.id<101000`).bind(member).run();
  await env.DB.prepare(`INSERT INTO hosting_replicas(version_id,provider,source_role_id,hosted_revision_id,state,created_at)
    SELECT version_id,provider,source_role_id,hosted_revision_id,'ready',1 FROM hosting_versions`).run();
  await env.DB.prepare(`INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at)
    SELECT ?,provider,hosted_revision_id,'conversation-'||hosted_revision_id,1,
      CAST(substr(source_role_id,13) AS INTEGER)*10+CAST(substr(hosted_revision_id,-1) AS INTEGER)
    FROM hosting_versions`).bind(member).run();
  await env.DB.prepare(`INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at)
    SELECT ?,provider,source_role_id,'other-'||id,1,id FROM cards WHERE id>101000`).bind(other).run();
  vi.spyOn(ownedHistory, 'read').mockImplementation(async (_env, _token, id) => ({
    conversationId: id, roleId: id.slice('conversation-'.length), canGenerate: true,
  }));
  return member;
}

type Sample = { sql: string; values: unknown[]; reads: number };
async function readPage(page: number, samples: Sample[]) {
  const db = new Proxy(env.DB, { get(target, key) {
    if (key !== 'prepare') {
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    }
    return (sql: string) => {
      const stmt = target.prepare(sql);
      if (!sql.startsWith('SELECT * FROM (SELECT c.*')) return stmt;
      return { bind: (...values: unknown[]) => ({ all: async () => {
        const result = await stmt.bind(...values).all();
        samples.push({ sql, values, reads: result.meta.rows_read });
        return result;
      } }) };
    };
  } }) as D1Database;
  const context = createExecutionContext();
  const response = await libraryRoutes.fetch(new Request(`https://c.test/v1/me/conversations?pageNum=${page}`, {
    headers: bearer(),
  }), { ...env, DB: db } as Env, context);
  await waitOnExecutionContext(context);
  expect(response.status).toBe(200);
  return await response.json() as {
    conversations: { cardNumber: number; conversationRoleId: string; conversationId: string }[];
    hasNextPage: boolean;
  };
}

it.each([false, true])('seeks matching cards and preserves pages with analyzed statistics=%s', async analyzed => {
  await seedHistory();
  if (analyzed) await env.DB.exec('ANALYZE');
  const samples: Sample[] = [];
  const first = await readPage(1, samples);
  expect(first.conversations.map(row => row.cardNumber)).toEqual(Array.from({ length: 24 }, (_, i) => 100032-i));
  expect(first.conversations.every(row => row.conversationRoleId.endsWith('-4'))).toBe(true);
  expect(first.hasNextPage).toBe(true);
  const last = await readPage(2, samples);
  expect(last.conversations.map(row => row.cardNumber)).toEqual(Array.from({ length: 8 }, (_, i) => 100008-i));
  expect(last.hasNextPage).toBe(false);
  expect(samples).toHaveLength(2);
  const plan = (await env.DB.prepare('EXPLAIN QUERY PLAN '+samples[0].sql)
    .bind(...samples[0].values).all<{ detail: string }>()).results.map(row => row.detail).join('\n');
  console.log('conversation-list card lookup', JSON.stringify({ reads: samples.map(s => s.reads), plan }));
  for (const sample of samples) expect(sample.reads).toBeLessThan(5000);
  expect(plan).toContain('SEARCH c USING INTEGER PRIMARY KEY');
});

it('keeps every source/hosted collision, deduplicates a double match and retains an unknown role', async () => {
  whoAmI(11);
  const member = await makeMember(11);
  await env.DB.prepare(`INSERT INTO cards(id,provider,source_role_id,approved_hosted_role_id,author_num_id,registered_at,last_synced_at)
    VALUES (100001,'harbor','shared','current-a',11,1,1),
           (100002,'harbor','second','shared',11,1,1),
           (100003,'harbor','third','shared',11,1,1),
           (100004,'harbor','self','self',11,1,1),
           (100005,'lunatalk','foreign','shared',11,1,1)`).run();
  await env.DB.prepare('INSERT INTO card_numbers(num,provider,source_role_id) SELECT id,provider,source_role_id FROM cards').run();
  await env.DB.prepare(`INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at)
    VALUES (?,'harbor','shared','conversation-shared',1,3),
           (?,'harbor','self','conversation-self',1,2),
           (?,'harbor','unknown','conversation-unknown',1,1)`).bind(member, member, member).run();
  vi.spyOn(ownedHistory, 'read').mockImplementation(async (_env, _token, id) => ({
    conversationId: id, roleId: id.slice('conversation-'.length), canGenerate: true,
  }));
  vi.spyOn(upstream, 'fetchRole').mockRejectedValue(new Error('synthetic missing role'));
  const rows = await readPage(1, []);
  expect(rows.conversations).toHaveLength(5);
  expect(rows.conversations.filter(r => r.cardNumber !== null).map(r => r.cardNumber).sort())
    .toEqual([100001, 100002, 100003, 100004]);
  expect(rows.conversations.filter(r => r.conversationId === 'conversation-self')).toHaveLength(1);
  expect(rows.conversations.find(r => r.conversationId === 'conversation-unknown')).toMatchObject({
    cardNumber: null, conversationRoleId: 'unknown',
  });
  expect(rows.hasNextPage).toBe(false);
});

it('uses the original work provider for a Harbor copy rather than a colliding Harbor card', async () => {
  whoAmI(11);
  const member = await makeMember(11);
  await env.DB.prepare(`INSERT INTO cards(id,provider,source_role_id,approved_hosted_role_id,author_num_id,registered_at,last_synced_at)
    VALUES (100001,'lunatalk','original','original-revision',11,1,1),
           (100002,'harbor','other','copy-revision',11,1,1)`).run();
  await env.DB.prepare('INSERT INTO card_numbers(num,provider,source_role_id) SELECT id,provider,source_role_id FROM cards').run();
  await env.DB.prepare(`INSERT INTO works(id,member_id,source_provider,source_role_id,created_at)
    VALUES ('copied-work',?,'lunatalk','original',1)`).bind(member).run();
  await env.DB.prepare(`INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at)
    VALUES ('copied-work','harbor',11,'copy-revision','complete',1)`).run();
  await env.DB.prepare(`INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at)
    VALUES (?,'harbor','copy-revision','copied-conversation',1,1)`).bind(member).run();
  vi.spyOn(ownedHistory, 'read').mockResolvedValue({
    conversationId: 'copied-conversation', roleId: 'copy-revision', canGenerate: true,
  });
  const rows = await readPage(1, []);
  expect(rows.conversations).toMatchObject([{ cardNumber: 100001, conversationId: 'copied-conversation' }]);
  expect(rows.hasNextPage).toBe(false);
});
