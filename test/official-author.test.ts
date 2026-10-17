import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { appAdmins, bearer, makeMember, resetDb, restoreUpstream, role, whoAmI } from './helpers';
import { upstream } from '../src/upstream';
import { upsertCard } from '../src/cards';
let target:string, actor:string;
beforeEach(async()=>{await resetDb();target=await makeMember(11);actor=await makeMember(22);whoAmI(22);appAdmins('admin');await upsertCard(env.DB,role({roleId:'official-test',authorNumId:11}),Date.now(),{status:'approved'});});
afterEach(restoreUpstream);
const write=(official:boolean,requestId=crypto.randomUUID(),token='admin')=>SELF.fetch('https://c.test/v1/me/community/official/manage',{method:'POST',headers:{...bearer(token),'Content-Type':'application/json'},body:JSON.stringify({handle:'aaaaaabb',official,reason:'Verified organization',requestId})});
const read=async(path:string)=>await (await SELF.fetch('https://c.test'+path)).json() as any;
it('defaults false and grants/revokes across warm public card and author caches with durable idempotency',async()=>{
 expect((await read('/v1/cards')).items[0].author.official).toBe(false);
 expect((await read('/v1/authors/aaaaaabb')).official).toBe(false);
 const requestId=crypto.randomUUID();expect((await write(true,requestId)).status).toBe(200);expect((await write(true,requestId)).status).toBe(200);
 expect((await read('/v1/authors')).items[0].official).toBe(true);
 expect((await read('/v1/cards/official-test')).author.official).toBe(true);
 expect((await read('/v1/cards')).items[0].author.official).toBe(true);expect((await read('/v1/authors/aaaaaabb')).official).toBe(true);
 expect((await write(false,requestId)).status).toBe(409);expect((await write(false)).status).toBe(200);expect((await write(true,requestId)).status).toBe(200);
 expect((await read('/v1/cards')).items[0].author.official).toBe(false);expect((await read('/v1/authors/aaaaaabb')).official).toBe(false);
 expect((await env.DB.prepare('SELECT * FROM official_author_audit').all()).results).toHaveLength(2);
 const metrics=await (await SELF.fetch('https://c.test/metrics')).text();expect(metrics).toContain('operation="official_admin",outcome="success"');
});
it('denies reviewers/managers and upstream outages and emits admin outcome metrics without private identifiers',async()=>{
 await env.DB.prepare("INSERT INTO reviewers(member_id,granted_at,granted_by,role) VALUES (?,0,'test','manager')").bind(actor).run();
 expect((await write(true,undefined,'ordinary')).status).toBe(403);appAdmins();expect((await write(true)).status).toBe(403);
 upstream.fetchCommunityStatus=async()=>{throw new Error('unavailable')};expect((await write(true)).status).toBe(503);
 const metrics=await (await SELF.fetch('https://c.test/metrics')).text();expect(metrics).toContain('operation="official_admin",outcome="denied"');expect(metrics).not.toContain(target);
});
it('ignores self-profile official forgery and never exposes internal member IDs',async()=>{
 const response=await SELF.fetch('https://c.test/v1/me/profile',{method:'PUT',headers:{...bearer('ordinary'),'Content-Type':'application/json'},body:JSON.stringify({displayName:'Official',official:true,is_official:1})});expect(response.status).toBe(200);
 expect((await env.DB.prepare('SELECT is_official FROM members WHERE id=?').bind(actor).first())?.is_official).toBe(0);
 expect(JSON.stringify(await read('/v1/authors/aaaaaabb'))).not.toContain(target);
});

it('requires authentication and validates input without writing audit',async()=>{
 expect((await SELF.fetch('https://c.test/v1/me/community/official/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(401);
 for(const official of ['true',1,null]){
  const result=await SELF.fetch('https://c.test/v1/me/community/official/manage',{method:'POST',headers:{...bearer('admin'),'Content-Type':'application/json'},body:JSON.stringify({handle:'aaaaaabb',official,reason:'Verified',requestId:crypto.randomUUID()})});expect(result.status).toBe(400);
 }
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM official_author_audit').first())?.n).toBe(0);
});
it('commits once under concurrent retries and rolls back audit when state write fails',async()=>{
 const id=crypto.randomUUID();const results=await Promise.all([write(true,id),write(true,id)]);expect(results.map(r=>r.status)).toEqual([200,200]);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM official_author_audit').first())?.n).toBe(1);
 await env.DB.exec("CREATE TRIGGER official_test_fail BEFORE UPDATE OF is_official ON members BEGIN SELECT RAISE(ABORT,'test_fail'); END;");
 try{expect((await write(false)).status).toBe(503);expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM official_author_audit').first())?.n).toBe(1);expect((await env.DB.prepare('SELECT is_official FROM members WHERE id=?').bind(target).first())?.is_official).toBe(1);}
 finally{await env.DB.exec('DROP TRIGGER official_test_fail');}
});
it('projects trusted identity on upstream previews and honors current connection owner',async()=>{
 upstream.fetchRole=async()=>role({roleId:'preview-only',authorNumId:11});
 expect((await write(true)).status).toBe(200);
 expect((await read('/v1/cards/preview-only')).author).toMatchObject({handle:'aaaaaabb',official:true});
 await env.DB.prepare("INSERT INTO member_connections(provider,external_id,owner_member_id,linked_at) VALUES('harbor','11',?,0)").bind(actor).run();
 expect((await read('/v1/cards/preview-only')).author.official).toBe(false);
 expect((await read('/v1/cards/official-test')).author.official).toBe(false);
 await env.DB.prepare('DELETE FROM cards').run();expect((await read('/v1/authors/aaaaaabb')).official).toBe(true);
});

it('rejects review agents even when their token belongs to an app admin',async()=>{
 await env.DB.prepare("INSERT INTO reviewers(member_id,granted_by,granted_at) VALUES (?,'test',0)").bind(actor).run();
 await env.DB.prepare("INSERT INTO review_agents(member_id,granted_by,granted_at) VALUES (?,'test',0)").bind(actor).run();
 expect((await write(true)).status).toBe(403);expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM official_author_audit').first())?.n).toBe(0);
});
