import { env, createExecutionContext } from 'cloudflare:test';
import { beforeEach, expect, it, vi } from 'vitest';
import { cleanAvatars } from '../src/community-profile';
import { communityRoutes } from '../src/community/routes';
import { sign } from '../src/community/crypto';
import { resetDb } from './helpers';
import type { Env } from '../src/types';

beforeEach(resetDb);

/** Read the real statement's D1 accounting, without replacing SQL or its results. */
function measuredDb(prefix: string, samples: number[]): D1Database {
 return new Proxy(env.DB, { get(db, key) {
  if (key !== 'prepare') { const value=Reflect.get(db,key); return typeof value==='function'?value.bind(db):value; }
  return (sql:string) => {
   const stmt=db.prepare(sql);
   if (!sql.startsWith(prefix)) return stmt;
   return { bind: (...values:unknown[]) => {
    const bound=stmt.bind(...values);
    return { all: async () => { const result=await bound.all(); samples.push(result.meta.rows_read); return result; } };
   } };
  };
 } }) as D1Database;
}

async function members(count:number) {
 await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?)
 INSERT INTO members(id,handle,created_at,avatar_key) SELECT 'perf-'||x,'perf-'||x,1,'active-'||x FROM n`).bind(count).run();
}

it('bounds avatar cleanup reads while preserving active and unexpired objects', async()=>{
 await members(1000);
 await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000)
 INSERT INTO avatar_cleanup(key,delete_after) SELECT 'future-'||x,2000 FROM n`).run();
 await env.DB.prepare("INSERT INTO avatar_cleanup VALUES('abandoned',0),('active-1000',0)").run();
 const samples:number[]=[], remove=vi.fn(async(_key:string)=>{});
 await cleanAvatars({...env,DB:measuredDb('SELECT key FROM avatar_cleanup',samples),AVATARS:{delete:remove}} as unknown as Env,1000);
 expect(remove.mock.calls.map(call=>call[0])).toEqual(['abandoned']);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM avatar_cleanup').first<{n:number}>())!.n).toBe(1001);
 console.log('avatar_cleanup rows_read',samples);
 expect(samples).toHaveLength(1);
 expect(samples[0]).toBeLessThan(30);
});

it('reads Discord notices only for opted-in active links and retains oldest-first delivery', async()=>{
 expect.assertions(5);
 await members(1000);
 await env.DB.prepare("INSERT INTO community_preferences(member_id,notifications,discord_dm) VALUES('perf-1000',1,1),('perf-999',1,1)").run();
 await env.DB.prepare("INSERT INTO community_subjects(discord_id) VALUES('111111111111111111'),('222222222222222222')").run();
 await env.DB.prepare(`INSERT INTO discord_links(member_id,discord_id,name,version,state,created_at)
 VALUES('perf-1000','111111111111111111','linked','active','active',1),('perf-999','222222222222222222','inactive','inactive','cleanup',1)`).run();
 await env.DB.prepare(`INSERT INTO community_notifications(event_key,member_id,kind,path,created_at)
 SELECT 'stale-'||id,id,'fixture','/',? FROM members WHERE id<>'perf-1000'`).bind(Date.now()-10000).run();
 await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<12)
 INSERT INTO community_notifications(event_key,member_id,kind,path,created_at,retry_at,delivered)
 SELECT 'ready-'||x,'perf-1000','fixture','/',?+x,0,0 FROM n`).bind(Date.now()).run();
 await env.DB.prepare("INSERT INTO community_notifications(event_key,member_id,kind,path,created_at,retry_at,delivered) VALUES('backoff','perf-1000','fixture','/',?,?,0),('sent','perf-1000','fixture','/',?,0,1)").bind(Date.now()-10,Date.now()+60000,Date.now()-10).run();
 const samples:number[]=[], settings={...env,DB:measuredDb('SELECT n.id,n.kind,n.extra,n.card_id',samples),COMMUNITY_ENABLED:'true',COMMUNITY_GUILD_ID:'123456789012345678',COMMUNITY_BRIDGE_KEY:'a'.repeat(64)} as Env;
 const path='/internal/community/pending',time=String(Date.now()),nonce=crypto.randomUUID(),body=JSON.stringify({guild:settings.COMMUNITY_GUILD_ID});
 const response=await communityRoutes.fetch(new Request('https://c.test'+path,{method:'POST',body,headers:{'X-Community-Time':time,'X-Community-Nonce':nonce,'X-Community-Signature':await sign(settings.COMMUNITY_BRIDGE_KEY!,'POST',path,time,nonce,body)}}),settings,createExecutionContext());
 expect(response.status).toBe(200);
 const result=await response.json() as {notifications:{id:string}[]};
 const expected=await env.DB.prepare("SELECT id FROM community_notifications WHERE event_key LIKE 'ready-%' ORDER BY created_at LIMIT 10").all<{id:string}>();
 expect(result.notifications).toHaveLength(10);
 expect(result.notifications).toEqual(expected.results);
 console.log('pending Discord rows_read',samples);
 expect(samples).toHaveLength(1);
 expect(samples[0]).toBeLessThan(500);
});
