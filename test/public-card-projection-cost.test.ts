import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { publicCandidates, publicCandidatePage } from '../src/work-pagination';
import type { Env } from '../src/types';
import { makeMember, resetDb } from './helpers';

beforeEach(resetDb);
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
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
 const sqlOf = new WeakMap<object, string>();
 function statement(stmt: D1PreparedStatement, sql: string): D1PreparedStatement {
  const proxy = new Proxy(stmt, { get(target, key) {
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
  sqlOf.set(proxy, sql);
  return proxy;
 }
 return new Proxy(env.DB,{get(target,key){
  if(key==='prepare')return (sql:string)=>statement(target.prepare(sql),sql);
  if(key==='batch')return async (stmts:D1PreparedStatement[])=>{
   const results=await target.batch(stmts);
   results.forEach((r,i)=>samples.push({sql:sqlOf.get(stmts[i])??'batch',reads:r.meta.rows_read,rows:r.results.length}));
   return results;
  };
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

/* 預覽數據跟著列表回（任務 2026-11-29-card-quality-tile-drawer-fix）：評分與留言整頁一筆快取，命中時不再讀這兩張表 */
it('reads ratings and comments for the shown page once, then serves them from the page snapshot',async()=>{
 vi.useFakeTimers({toFake:['Date'],now:Date.now()+3_600_000});// 前面用例留下的同一頁快取已過期
 await fixture();
 await env.DB.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<50)
  INSERT INTO members(id,handle,created_at) SELECT 'rater-'||x,'rater-'||x,1 FROM n`).run();
 // 首屏 24 張各 50 筆評分與 30 則頂層留言，後面的卡也有，確認只讀顯示中的那幾張
 await env.DB.prepare(`INSERT INTO card_scores(card_id,member_id,score,created_at,updated_at)
  SELECT CAST(c.id AS TEXT),m.id,1+(c.id+length(m.id))%5,1,1 FROM cards c CROSS JOIN members m WHERE m.id LIKE 'rater-%' AND c.id>100150`).run();
 await env.DB.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<30)
  INSERT INTO comments(id,card_id,member_id,content,created_at) SELECT 'cc-'||c.id||'-'||x,c.id,'rater-1','hi',x FROM cards c CROSS JOIN n WHERE c.id>100150`).run();
 const run=async()=>{
  const samples:Sample[]=[];const measured={...env,DB:measuredDb(samples)} as Env;const layers:string[]=[];
  const candidates=await publicCandidates(measured,source,0);
  const page=await publicCandidatePage(measured,candidates,position,{...pageOptions,onSocial:l=>layers.push(l)},source);
  const social=samples.filter(s=>/card_scores|JOIN comments/.test(s.sql));
  return {page,layers,total:samples.reduce((n,s)=>n+s.reads,0),social:social.reduce((n,s)=>n+s.reads,0),socialQueries:social.map(s=>s.reads),bytes:JSON.stringify(page).length};
 };
 const miss=await run();
 expect(miss.layers).toEqual(['origin']);
 expect(miss.page.items[0].qualitySignal?.detail).toMatchObject({comments:30,rating:{count:50}});
 const hit=await run();
 expect(hit.layers).toEqual(['edge']);
 expect(hit.social).toBe(0);
 // 組合不同的列表（推薦、搜尋、較短的一頁）也共用同一張卡算好的數字
 const samples:Sample[]=[];const layers:string[]=[];const measured={...env,DB:measuredDb(samples)} as Env;
 const shorter=await publicCandidatePage(measured,await publicCandidates(measured,source,0),position,{...pageOptions,limit:12,onSocial:l=>layers.push(l)},source);
 expect(layers).toEqual(['edge']);
 expect(samples.filter(s=>/card_scores|JOIN comments/.test(s.sql))).toEqual([]);
 expect(shorter.items[0].qualitySignal?.detail).toEqual(miss.page.items[0].qualitySignal?.detail);
 const withoutDetail=JSON.stringify({...hit.page,items:hit.page.items.map(i=>({...i,qualitySignal:i.qualitySignal&&{...i.qualitySignal,detail:undefined}}))}).length;
 console.log('list social reads',{missTotal:miss.total,missSocial:miss.social,missQueries:miss.socialQueries,hitTotal:hit.total,hitSocial:hit.social,pageBytes:hit.bytes,detailBytes:hit.bytes-withoutDetail});
 // 只讀顯示中的 24 張：每筆評分約 3 列（索引、評分列、成員帳號類別），每則留言約 2 列；
 // 後面 26 張也有評分與留言，掃整張表就會超過這個上限
 expect(miss.social).toBeLessThan(24*(50*3+30*2)+200);
});

it('still answers the list without preview data when ratings cannot be read',async()=>{
 vi.useFakeTimers({toFake:['Date'],now:Date.now()+7_200_000});// 前面用例留下的同一頁快取已過期
 await fixture();
 const failing=new Proxy(env.DB,{get(target,key){
  if(key==='batch')return async()=>{throw new Error('D1 overloaded');};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }}) as D1Database;
 const measured={...env,DB:failing} as Env;const layers:string[]=[];
 vi.spyOn(console,'warn').mockImplementation(()=>{});
 const candidates=await publicCandidates(measured,source,0);
 const page=await publicCandidatePage(measured,candidates,position,{...pageOptions,onSocial:l=>layers.push(l)},source);
 expect(page.items).toHaveLength(24);
 expect(layers).toEqual(['error']);
 expect(page.items[0].qualitySignal).toEqual({lengthCharacters:null,deepPlay:null});
});
