import {env,createExecutionContext,waitOnExecutionContext} from 'cloudflare:test';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {libraryRoutes} from '../src/library';
import {ownedHistory} from '../src/owned-history';
import {bearer,makeMember,resetDb,restoreUpstream,whoAmI} from './helpers';
import type {Env} from '../src/types';

beforeEach(resetDb);
afterEach(()=>{vi.restoreAllMocks();restoreUpstream();});

it('seeks adult historical revisions while keeping conversation-list regional filtering unchanged',async()=>{
 whoAmI(11);
 const member=await makeMember(11);
 await env.DB.prepare("UPDATE members SET country_region='CN' WHERE id=?").bind(member).run();
 await env.DB.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<12)
 INSERT INTO cards(id,provider,source_role_id,author_num_id,registered_at,last_synced_at,status,rating)
 SELECT 100000+x,'harbor','history-'||x,11,1,1,'approved','G' FROM n`).run();
 await env.DB.prepare(`INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at)
 SELECT ?,'harbor',source_role_id,'conversation-'||id,1,id FROM cards`).bind(member).run();
 await env.DB.prepare(`WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000)
 INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,hosted_revision_id,state,created_at,rating)
 SELECT 'unrelated-'||x,'unrelated-work-'||x,?,'unrelated-op-'||x,'unrelated-source-'||x,'harbor','unrelated-revision-'||x,'approved',1,IIF(x%2=0,'R','G') FROM n`).bind(member).run();
 await env.DB.prepare(`INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,hosted_revision_id,state,created_at,rating)
 VALUES('adult-historical','historical-work',?,'historical-op','historical-source','harbor','history-12','retired',1,'R')`).bind(member).run();
 vi.spyOn(ownedHistory,'read').mockImplementation(async(_env,_token,id)=>({conversationId:id,roleId:'history-'+(Number(id.slice('conversation-'.length))-100000),canGenerate:true}));
 const samples:{sql:string;values:unknown[];reads:number}[]=[];
 const db=new Proxy(env.DB,{get(target,key){
  if(key!=='prepare'){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
  return (sql:string)=>{
   const stmt=target.prepare(sql);
   if(!sql.startsWith('SELECT * FROM (SELECT c.*'))return stmt;
   return {bind:(...values:unknown[])=>({all:async()=>{
    const result=await stmt.bind(...values).all();samples.push({sql,values,reads:result.meta.rows_read});return result;
   }})};
  };
 }}) as D1Database;
 const context=createExecutionContext();
 const response=await libraryRoutes.fetch(new Request('https://c.test/v1/me/conversations',{headers:bearer()}),{...env,DB:db} as Env,context);
 await waitOnExecutionContext(context);
 expect(response.status).toBe(200);
 const body=await response.json() as {conversations:{conversationRoleId:string}[]};
 expect(body.conversations.map(row=>row.conversationRoleId)).toEqual(Array.from({length:11},(_,i)=>'history-'+(11-i)));
 expect(samples).toHaveLength(1);
 const plan=(await env.DB.prepare('EXPLAIN QUERY PLAN '+samples[0].sql).bind(...samples[0].values).all<{detail:string}>()).results.map(row=>row.detail).join('\n');
 console.log('conversation historical-rating rows_read',samples[0].reads);
 expect(plan).not.toMatch(/SCAN rv(?:\n|$)/);
 expect(plan).toContain('hosting_versions_region_adult');
 expect(samples[0].reads).toBeLessThan(1000);
});
