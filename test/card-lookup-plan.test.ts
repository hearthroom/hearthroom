import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { catalogTagCounts, getCard, getPublicCard, upsertCard } from '../src/cards';
import { saveScope } from '../src/saves';
import { resetDb, role } from './helpers';

function withPlans() {
  const plans: string[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const stmt = env.DB.prepare(sql).bind(...values);
          async function explain() {
            const result = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...values).all<{ detail: string }>();
            plans.push(result.results.map(row => row.detail));
          }
          return {
            async first() { await explain(); return stmt.first(); },
            async all() { await explain(); return stmt.all(); },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, plans };
}

it.each([
  { name: 'public', lookup: getPublicCard },
  { name: 'provider-scoped', lookup: getCard },
])('$name lookup seeks card and hosting identifiers by index', async ({ lookup }) => {
  const { db, plans } = withPlans();
  await lookup(db, 'missing-role');
  expect(plans).toHaveLength(1);
  const plan = plans[0].join('\n');
  expect(plan).toMatch(/SEARCH .*USING INTEGER PRIMARY KEY/);
  expect(plan).not.toMatch(/SCAN (?:c|cards|v|r|hosting_versions|hosting_replicas)\b/);
  expect(plan).not.toMatch(/SEARCH .*\(provider=\?\)/);
});

it('seeks all save versions by card ID after resolving the role', async () => {
  await resetDb();
  const { id } = await upsertCard(env.DB, role({ roleId: 'save-source' }), 1);
  const { db, plans } = withPlans();
  expect(await saveScope(db, 'save-source')).toEqual({ key: `card:${id}`, ids: [`card:${id}`, 'save-source'] });
  expect(plans).toHaveLength(2);
  expect(plans[1].join('\n')).not.toMatch(/SCAN (?:v|r|hosting_versions|hosting_replicas)\b/);
});

it('aggregates raw tag combinations once, with duplicate locale aliases counted once per card', async () => {
  await resetDb();
  await upsertCard(env.DB, role({ roleId: 'tag-source', tags: ['劇情', '剧情', 'Story'] }), 1);
  const { db, plans } = withPlans();
  expect(await catalogTagCounts(db, { allowNsfw: false })).toMatchObject({ story: 1 });
  expect(plans).toHaveLength(1);
  const plan = plans[0].join('\n');
  expect(plan).not.toMatch(/MATERIALIZE catalog|SCAN t VIRTUAL TABLE/);
  expect(plan).toContain('USE TEMP B-TREE FOR GROUP BY');
});

it('keeps numeric identity, provider preference and legacy tie order on collisions', async () => {
  await resetDb();
  const now = Date.now();
  const older = await upsertCard(env.DB, role({ roleId: 'legacy' }), now);
  const newer = await upsertCard(env.DB, role({ roleId: 'another' }), now + 1);
  const other = await upsertCard(env.DB, role({ roleId: 'legacy' }), now, { provider: 'lunatalk' });
  await env.DB.prepare('UPDATE cards SET approved_hosted_role_id = ? WHERE id = ?').bind('legacy', newer.id).run();
  expect((await getPublicCard(env.DB, 'legacy'))?.id).toBe(older.id);
  expect((await getPublicCard(env.DB, 'legacy', 'lunatalk'))?.id).toBe(other.id);
  expect((await getCard(env.DB, 'legacy'))?.id).toBe(newer.id);
  expect((await getCard(env.DB, older.id, 'lunatalk'))?.id).toBe(older.id);
  // Noncanonical numeric inputs still participate in the old SQLite equality comparison.
  expect((await getPublicCard(env.DB, `0${older.id}`, 'lunatalk'))?.id).toBe(older.id);
});

it('keeps the distinct approval and replica readiness rules for historical versions', async () => {
  await resetDb();
  const { id } = await upsertCard(env.DB, role({ roleId: 'original' }), 1);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO hosting_versions
      (version_id, work_id, member_id, operation_id, source_role_id, provider, hosted_revision_id, card_id, state, created_at)
      VALUES ('v1','w','m','op1','original','harbor','primary-old',?,'approved',1),
             ('v2','w','m','op2','original','harbor','primary-draft',?,'preparing',2)`).bind(id, id),
    env.DB.prepare(`INSERT INTO hosting_replicas (version_id, provider, source_role_id, hosted_revision_id, state, created_at)
      VALUES ('v1','harbor','original','failed-replica','failed',1),
             ('v1','lunatalk','copy','ready-replica','ready',1),
             ('v2','harbor','original','draft-replica','ready',2)`),
  ]);
  expect((await getPublicCard(env.DB, 'ready-replica', 'lunatalk'))?.id).toBe(id);
  for (const rejected of ['failed-replica', 'draft-replica', 'primary-old']) {
    expect(await getPublicCard(env.DB, rejected)).toBeNull();
  }
  expect((await getCard(env.DB, 'primary-old'))?.id).toBe(id);
  expect(await getCard(env.DB, 'primary-old', 'lunatalk')).toBeNull();
  expect(await getCard(env.DB, 'primary-draft')).toBeNull();
  expect(await getCard(env.DB, 'ready-replica')).toBeNull();
});
