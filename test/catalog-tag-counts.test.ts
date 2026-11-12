import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { catalogTagCounts, upsertCard } from '../src/cards';
import { TAG_CATALOG } from '../shared/tag-catalog';
import { resetDb, role } from './helpers';

it('keeps counts current across insert, replacement, empty tags and deletion', async () => {
  await resetDb();
  const { id } = await upsertCard(env.DB, role({ roleId: 'tag-live', tags: ['Story', 'Story', '剧情'] }), 1);
  expect((await catalogTagCounts(env.DB, { allowNsfw: false })).story).toBe(1);
  await env.DB.prepare("UPDATE cards SET tags='[\"Game\"]' WHERE id=?").bind(id).run();
  expect(await catalogTagCounts(env.DB, { allowNsfw: false })).toMatchObject({ story: 0, game: 1 });
  await env.DB.prepare("UPDATE cards SET tags='[]' WHERE id=?").bind(id).run();
  expect(await catalogTagCounts(env.DB, { allowNsfw: false })).toMatchObject({ story: 0, game: 0 });
  await env.DB.prepare("UPDATE cards SET tags='[\"Story\"]' WHERE id=?").bind(id).run();
  await env.DB.prepare('DELETE FROM cards WHERE id=?').bind(id).run();
  expect((await catalogTagCounts(env.DB, { allowNsfw: false })).story).toBe(0);
});

it('preserves SQLite legacy JSON object and scalar tag semantics', async () => {
  await resetDb();
  const { id } = await upsertCard(env.DB, role({ roleId: 'tag-legacy' }), 1);
  for (const tags of ['{"a":"Story","a":"Game"}', '"Story"', 'null', '["Story","Story",123,null,{"tag":"Game"}]']) {
    await env.DB.prepare('UPDATE cards SET tags=? WHERE id=?').bind(tags,id).run();
    expect(await catalogTagCounts(env.DB, { allowNsfw:false })).toMatchObject({ story: tags==='null'?0:1, game: tags.startsWith('{')?1:0 });
  }
});

it('preserves scoped counts and reduces D1 reads against JSON expansion on the same cards', async () => {
  await resetDb();
  await env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<1000)
    INSERT INTO cards(id,source_role_id,author_num_id,tags,provider,status,registered_at,last_synced_at,zone,rating)
    SELECT 200000+n,'tag-perf-'||n,10001,CASE WHEN n%2=0 THEN '["Story","剧情","Game","custom"]' ELSE '["custom"]' END,
    'harbor',CASE WHEN n%7=0 THEN 'pending' ELSE 'approved' END,1,1,CASE WHEN n%3=0 THEN 'en' ELSE 'zh' END,CASE WHEN n%5=0 THEN 'R' ELSE 'G' END FROM seq`).run();
  const names=TAG_CATALOG.flatMap(e=>[...new Set(Object.values(e.names))].map(name=>[e.key,name]));
  const observed: {grouped:number;legacy:number}[]=[];
  for (const scope of [
    { allowNsfw:false },
    { allowNsfw:true, zone:'zh' },
    { allowNsfw:false, zone:'en', tagGroups:[['Game']], excludeTags:['custom'] },
    { allowNsfw:true, maxRating:'G' as const, tagGroups:[['Story','剧情']] },
  ]) {
    let query='',values:unknown[]=[],reads=0;
    const db={prepare(sql:string){query=sql;return {bind(...binds:unknown[]){values=binds;return {async all(){const r=await env.DB.prepare(sql).bind(...binds).all();reads=r.meta.rows_read;return r;}};}};}} as unknown as D1Database;
    const counts=await catalogTagCounts(db,scope);
    const where=query.slice(query.indexOf(' WHERE ')+7).replace(/ GROUP BY c.tags$/, '');
    const legacy=await env.DB.prepare(`WITH catalog AS MATERIALIZED (
      SELECT json_extract(value,'$[0]') AS k,json_extract(value,'$[1]') AS name FROM json_each(?)
      ) SELECT catalog.k,COUNT(DISTINCT c.id) AS n FROM cards c CROSS JOIN json_each(c.tags) t
      CROSS JOIN catalog ON catalog.name=t.value WHERE ${where} GROUP BY catalog.k`).bind(JSON.stringify(names),...values).all<{k:string;n:number}>();
    const expected=Object.fromEntries(TAG_CATALOG.map(e=>[e.key,0]));
    for(const r of legacy.results)expected[r.k]=r.n;
    expect(counts).toEqual(expected);
    observed.push({grouped:reads,legacy:legacy.meta.rows_read});
    expect(reads).toBeLessThanOrEqual(legacy.meta.rows_read);
  }
  console.log('D1_TAG_READS',JSON.stringify(observed));
  expect(observed[0].grouped).toBeGreaterThan(0);
  expect(observed[0].grouped).toBeLessThan(observed[0].legacy*0.5);
});
