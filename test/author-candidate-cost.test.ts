import {env} from 'cloudflare:test';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {listCardIds} from '../src/cards';
import {makeMember,resetDb} from './helpers';

beforeEach(resetDb);
afterEach(async()=>{await resetDb();await env.DB.prepare('ANALYZE').run();});

function measuredDb(reads:number[]):D1Database{
 function statement(stmt:D1PreparedStatement):D1PreparedStatement{
  return new Proxy(stmt,{get(target,key){
   if(key==='bind')return(...args:unknown[])=>statement(target.bind(...args));
   if(key==='all')return async()=>{const result=await target.all();reads.push(result.meta.rows_read);return result;};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
 }
 return new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>statement(target.prepare(sql));const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}) as D1Database;
}
async function catalog(dense=false){
 await env.DB.prepare(`WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4500)
  INSERT INTO members(id,handle,created_at) SELECT 'author-'||x,'author-'||x,1 FROM n`).run();
 await env.DB.prepare(`INSERT INTO member_identities(provider,external_id,member_id,linked_at) SELECT 'harbor',CAST(rowid AS TEXT),id,1 FROM members`).run();
 await env.DB.prepare(`WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2400)
  INSERT INTO cards(id,provider,source_role_id,author_num_id,names,summaries,tags,heat,registered_at,last_synced_at,status)
  SELECT 100000+x,'harbor','author-card-'||x,${dense?'11':'10+x%40'},'{}','{}','[]',x,x,x,'approved' FROM n`).run();
}
const options={authorMemberId:'author-11',allowNsfw:true,sort:'hot' as const,limit:200,offset:0};
it.each([false,true])('bounds sparse author discovery without decorating unrelated cards (ANALYZE=%s)',async analyzed=>{
 await catalog();if(analyzed)await env.DB.prepare('ANALYZE').run();
 const reads:number[]=[];const result=await listCardIds(measuredDb(reads),options);
 const ids=Array.from({length:2400},(_,i)=>i+1).filter(i=>10+i%40===11).reverse().map(i=>String(100000+i));
 expect(result.rows.map(r=>r.id)).toEqual(ids);expect(result.hasNext).toBe(false);expect(result.total).toBe(60);
 expect(reads.length).toBeGreaterThan(0);expect(reads.reduce((a,b)=>a+b,0)).toBeLessThan(3500);
});
it.each([false,true])('keeps an early limit when most cards belong to one author (ANALYZE=%s)',async analyzed=>{
 await catalog(true);if(analyzed)await env.DB.prepare('ANALYZE').run();
 const reads:number[]=[];const result=await listCardIds(measuredDb(reads),options);
 expect(result.rows.map(r=>r.id)).toEqual(Array.from({length:200},(_,i)=>String(102400-i)));expect(result.hasNext).toBe(true);
 expect(reads.reduce((a,b)=>a+b,0)).toBeLessThan(1800);
});
it.each([['real','CAST(1.5 AS REAL)'],['text',"'legacy-author'"],['blob',"CAST('11' AS BLOB)"],['large-real','1e20']])('preserves a legacy %s author accepted by the original text ownership join',async(_kind,value)=>{
 await env.DB.prepare("INSERT INTO members(id,handle,created_at) VALUES('legacy','legacy',1)").run();
 await env.DB.prepare(`INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES('harbor',CAST(${value} AS TEXT),'legacy',1)`).run();
 await env.DB.prepare(`INSERT INTO cards(id,provider,source_role_id,author_num_id,names,summaries,tags,registered_at,last_synced_at,status)
  VALUES(100001,'harbor','legacy-card',${value},'{}','{}','[]',1,1,'approved')`).run();
 expect((await listCardIds(env.DB,{...options,authorMemberId:'legacy'})).rows.map(r=>r.id)).toEqual(['100001']);
});
it.each(['none','original-test','connected-test','original-fence','connected-fence'])('keeps connected ownership and dual exclusions (%s)',async mode=>{
 const original='old-owner',connected='new-owner';
 await env.DB.prepare("INSERT INTO members(id,handle,created_at,account_class) VALUES('old-owner','oldowner',1,?),('new-owner','newowner',1,?)").bind(mode==='original-test'?'test':'normal',mode==='connected-test'?'test':'normal').run();
 await env.DB.prepare("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES('harbor','11','old-owner',1),('harbor','12','new-owner',1)").run();
 await env.DB.prepare("INSERT INTO member_connections(provider,external_id,owner_member_id,linked_at) VALUES('harbor','11','new-owner',1)").run();
 await env.DB.prepare("INSERT INTO cards(id,provider,source_role_id,author_num_id,names,summaries,tags,registered_at,last_synced_at,status) VALUES(100001,'harbor','transferred',11,'{}','{}','[]',1,1,'approved')").run();
 if(mode.endsWith('-fence'))await env.DB.prepare("INSERT INTO legacy_account_fence(public_no,member_id,handle,request_id,created_at) SELECT 279,id,handle,'fixture',1 FROM members WHERE id=?").bind(mode==='original-fence'?original:connected).run();
 const ids=async(member:string)=>(await listCardIds(env.DB,{...options,authorMemberId:member})).rows.map(r=>r.id);
 expect(await ids(original)).toEqual([]);expect(await ids(connected)).toEqual(mode==='none'?['100001']:[]);
});
it('does not grant ownership through a numerically similar noncanonical identity',async()=>{
 await makeMember(11);const other=await makeMember(12);
 await env.DB.prepare("INSERT INTO member_connections(provider,external_id,owner_member_id,linked_at) VALUES('harbor','011',?,1)").bind(other).run();
 await env.DB.prepare("INSERT INTO cards(id,provider,source_role_id,author_num_id,names,summaries,tags,registered_at,last_synced_at,status) VALUES(100001,'harbor','canonical',11,'{}','{}','[]',1,1,'approved')").run();
 expect((await listCardIds(env.DB,{...options,authorMemberId:other})).rows).toEqual([]);
});
