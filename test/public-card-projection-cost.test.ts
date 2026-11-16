import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { publicCandidates, publicCandidatePage } from '../src/work-pagination';
import type { Env } from '../src/types';
import { makeMember, resetDb } from './helpers';

beforeEach(resetDb);
afterEach(()=>vi.restoreAllMocks());
const source = { sort: 'hot' as const, limit: 24, offset: 0, allowNsfw: true };
const position = { raw: 0, trail: [], binding: 'projection-fixture' };
const pageOptions = { limit: 24, offset: 0, lang: 'en', allowNsfw: true };

async function fixture() {
 const author = await makeMember(11);
 await env.DB.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<200)
  INSERT INTO cards(id,provider,source_role_id,zone,author_num_id,author_name,names,summaries,tags,heat,registered_at,last_synced_at,status)
  SELECT 100000+x,'harbor','projection-'||x,'en',11,'Author',json_object('en','Card '||x),json_object('en','Summary '||x),'["before"]',x,x,x,'approved' FROM n`).run();
 await env.DB.prepare(`INSERT INTO card_numbers(num,provider,source_role_id) SELECT id,provider,source_role_id FROM cards`).run();
 await env.DB.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<20)
  INSERT INTO members(id,handle,created_at) SELECT 'fan-'||x,'fan-'||x,1 FROM n`).run();
 await env.DB.prepare(`INSERT INTO member_favorites(member_id,card_id,created_at) SELECT m.id,c.id,1 FROM members m CROSS JOIN cards c WHERE m.id LIKE 'fan-%'`).run();
 await env.DB.prepare(`WITH zones(z) AS (VALUES('clean'),('all')), windows(w) AS (VALUES('day'),('week'),('month'))
  INSERT INTO rank_settlements(zone,window,period,settled_at,receipt,snapshot) SELECT z,w,'fixture',1,'fixture','[]' FROM zones CROSS JOIN windows`).run();
 await env.DB.prepare(`INSERT INTO rank_awards(id,card_id,zone,window,period,rank,band,member_id,account_no,amount,awarded_at)
  SELECT CAST(c.id AS TEXT)||'-'||s.zone||'-'||s.window,c.id,s.zone,s.window,s.period,1,1,?,11,1,1 FROM cards c CROSS JOIN rank_settlements s`).bind(author).run();
}

type Sample = { sql: string; reads: number; rows: number };
function measuredDb(samples: Sample[], mutateAfterProof = false): D1Database {
 let mutated = false;
 function statement(stmt: D1PreparedStatement, sql: string): D1PreparedStatement {
  return new Proxy(stmt, { get(target, key) {
   if (key === 'bind') return (...values: unknown[]) => statement(target.bind(...values), sql);
   if (key === 'all') return async () => {
    const result = await target.all(); samples.push({sql,reads:result.meta.rows_read,rows:result.results.length}); return result;
   };
   if (key === 'first' && mutateAfterProof && sql === 'SELECT 1 FROM managed_work_access LIMIT 1') return async () => {
    if (!mutated) { mutated = true; await env.DB.prepare(`UPDATE cards SET names='{"en":"Unproven later title"}', summaries='{"en":"Later content"}', tags='["later"]',approved_hosted_role_id='later-target' WHERE id=100200`).run(); }
    return target.first();
   };
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  } });
 }
 return new Proxy(env.DB,{get(target,key){
  if(key==='prepare')return (sql:string)=>statement(target.prepare(sql),sql);
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }}) as D1Database;
}

it.each([false,true])('keeps a full 200-candidate page below the presentation read budget (ANALYZE=%s)',async analyzed=>{
 await fixture(); if(analyzed)await env.DB.prepare('ANALYZE').run(); const samples:Sample[]=[];
 const measured={...env,DB:measuredDb(samples)} as Env;
 const candidates=await publicCandidates(measured,source,0);
 const page=await publicCandidatePage(measured,candidates,position,pageOptions,source);
 expect(candidates.ids).toHaveLength(200);expect(page.items).toHaveLength(24);expect(page.hasNext).toBe(true);expect(page.total).toBe(200);
 expect(page.items.map(row=>row.id)).toEqual(Array.from({length:24},(_,i)=>String(100200-i)));
 expect(page.items[0]).toMatchObject({name:'Card 200',summary:'Summary 200',favoriteCount:20,roleId:'projection-200',tags:['before'],honors:[{zone:'clean',window:'day',band:1},{zone:'clean',window:'week',band:1},{zone:'clean',window:'month',band:1}]});
 const reads=samples.reduce((n,s)=>n+s.reads,0);console.log('public projection reads',reads,samples.map(s=>({reads:s.reads,rows:s.rows,start:s.sql.slice(0,70)})));
 expect(reads).toBeLessThan(6000);
});

it('does not mix a later card body or target into the captured visibility snapshot',async()=>{
 await fixture();const measured={...env,DB:measuredDb([],true)} as Env;
 const candidates=await publicCandidates(measured,source,0);
 const page=await publicCandidatePage(measured,candidates,position,pageOptions,source);
 expect(page.items[0]).toMatchObject({name:'Card 200',summary:'Summary 200',roleId:'projection-200',tags:['before']});
 expect(await env.DB.prepare('SELECT approved_hosted_role_id FROM cards WHERE id=100200').first('approved_hosted_role_id')).toBe('later-target');
});
