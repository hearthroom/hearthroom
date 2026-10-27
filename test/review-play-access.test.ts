import {env,createExecutionContext} from 'cloudflare:test';
import {afterEach,beforeEach,expect,it} from 'vitest';
import worker from '../src/index';
import {bearer,identities,makeReviewer,resetDb,restoreUpstream,reviewOn,reviewOff,reviewUpstream,rolesOnMainSite,ratingBody} from './helpers';
import {legacyPolicyFixture} from './work-policy-fixture';
import {CLAIM_TTL_MS} from '../src/review';
let review:string,role:string,member:string;
const options=()=>({...env,HOSTING_SERVICE_KEY:'fixture-key'});
const check=(account=20001,target=role,key='fixture-key')=>worker.fetch(new Request(`https://c.test/internal/review/${review}/play-access?accountNumId=${account}&roleId=${encodeURIComponent(target)}`,{headers:{'X-Hosting-Key':key}}),options(),createExecutionContext());
beforeEach(async()=>{
 await resetDb();legacyPolicyFixture();identities({'author':10001,'reviewer':20001});rolesOnMainSite({roleId:'draft',authorNumId:10001});reviewUpstream();reviewOn();
 const submitted=await worker.fetch(new Request('https://c.test/v1/cards',{method:'POST',headers:{...bearer('author'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'draft',...ratingBody(true),operationId:crypto.randomUUID()})}),env,createExecutionContext());
 expect(submitted.status).toBe(201);
 const row=await env.DB.prepare('SELECT id,source_role_id FROM review_submissions').first<any>();review=row.id;role=row.source_role_id;
 member=await makeReviewer(20001);
 await env.DB.prepare('UPDATE members SET age_verified_at=? WHERE id=?').bind(Date.now(),member).run();
 await env.DB.prepare('UPDATE review_submissions SET claimed_by=?,claimed_at=? WHERE id=?').bind(member,Date.now(),review).run();
});
afterEach(()=>{restoreUpstream();reviewOff();});
it('allows only the exact pending revision and current claimant through the server-only callback',async()=>{
 const r=await check();expect(r.status).toBe(200);expect(await r.json()).toMatchObject({allowed:true,roleId:role});expect(r.headers.get('Cache-Control')).toContain('no-store');
 expect((await check(20002)).status).toBe(403);expect((await check(20001,'another-role')).status).toBe(403);expect((await check(20001,role,'wrong')).status).toBe(401);
 const metrics=await worker.fetch(new Request('https://c.test/metrics'),options(),createExecutionContext());
 const text=await metrics.text();expect(text).toContain('hearthroom_review_play_checks_total{operation="admission",outcome="allow"}');expect(text).not.toContain(review);
});
it('revokes access on expiry, release, completed review, reviewer revocation, or age gate',async()=>{
 await env.DB.prepare('UPDATE review_submissions SET claimed_at=? WHERE id=?').bind(Date.now()-CLAIM_TTL_MS,review).run();expect((await check()).status).toBe(403);
 await env.DB.prepare('UPDATE review_submissions SET claimed_at=?,claimed_by=NULL WHERE id=?').bind(Date.now(),review).run();expect((await check()).status).toBe(403);
 await env.DB.prepare('UPDATE review_submissions SET claimed_by=? WHERE id=?').bind(member,review).run();
 await env.DB.prepare('UPDATE members SET age_verified_at=NULL WHERE id=?').bind(member).run();expect((await check()).status).toBe(403);
 await env.DB.prepare('UPDATE members SET age_verified_at=? WHERE id=?').bind(Date.now(),member).run();expect((await check()).status).toBe(200);
 await env.DB.prepare('UPDATE reviewers SET revoked_at=? WHERE member_id=?').bind(Date.now(),member).run();expect((await check()).status).toBe(403);
 await env.DB.prepare('UPDATE reviewers SET revoked_at=NULL WHERE member_id=?').bind(member).run();
 await env.DB.prepare("UPDATE review_submissions SET status='superseded' WHERE id=?").bind(review).run();expect((await check()).status).toBe(403);
});

it('resolves retained account connections before the original identity, matching reviewer authentication',async()=>{
 const canonical=await makeReviewer(20002);
 await env.DB.prepare('UPDATE members SET age_verified_at=? WHERE id=?').bind(Date.now(),canonical).run();
 await env.DB.prepare("INSERT INTO member_connections(provider,external_id,owner_member_id,linked_at) VALUES('harbor','20001',?,?)").bind(canonical,Date.now()).run();
 expect((await check()).status).toBe(403);
 await env.DB.prepare('UPDATE review_submissions SET claimed_by=? WHERE id=?').bind(canonical,review).run();
 expect((await check()).status).toBe(200);
});
