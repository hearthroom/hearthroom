import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { legacyPolicyFixture } from './work-policy-fixture';
import { bearer, identities, makeReviewer, ratingBody, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite, role } from './helpers';
import { upsertCard } from '../src/cards';
import { opsMetrics } from '../src/ops-metrics';

const AUTHOR=10001, OTHER=20001;
const roles=['reviewer','manager','owner'] as const;
beforeEach(async()=>{
 await resetDb();legacyPolicyFixture();
 identities({author:AUTHOR,other:OTHER});
 rolesOnMainSite({roleId:'self-review-role',authorNumId:AUTHOR});
 reviewUpstream();reviewOn();
 await makeReviewer(AUTHOR);await makeReviewer(OTHER);
});
afterEach(()=>{restoreUpstream();reviewOff();});
const request=(id:string,action:'claim'|'stamp',token:string,body:object={})=>SELF.fetch(`https://c.test/v1/review/${id}/${action}`,{
 method:'POST',headers:{...bearer(token),'Content-Type':'application/json'},body:JSON.stringify(body),
});
async function staffRole(role:string){await env.DB.prepare('UPDATE reviewers SET role=? WHERE member_id IN (?,?)').bind(role,`member-${AUTHOR}`,`member-${OTHER}`).run();}
async function submit(){
 const res=await SELF.fetch('https://c.test/v1/cards',{method:'POST',headers:{...bearer('author'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'self-review-role',...ratingBody(false),operationId:crypto.randomUUID()})});
 expect(res.status).toBe(201);
 return (await env.DB.prepare('SELECT id FROM review_submissions').first<{id:string}>())!.id;
}
async function snapshot(id:string){return {
 submission:await env.DB.prepare('SELECT * FROM review_submissions WHERE id=?').bind(id).first(),
 cards:(await env.DB.prepare('SELECT * FROM cards ORDER BY id').all()).results,
 stamps:(await env.DB.prepare('SELECT * FROM review_stamps ORDER BY submission_id,member_id').all()).results,
 decisions:(await env.DB.prepare('SELECT * FROM work_review_decisions ORDER BY submission_id').all()).results,
};}

it.each(roles.flatMap(role=>(['author','other'] as const).map(token=>({role,token}))))('$role can claim and approve $token cards with a durable reviewer/author record',async({role,token})=>{
 await staffRole(role);const id=await submit();
 const res=await request(id,'claim',token);expect(res.status).toBe(200);
 const {generation}=await res.json() as {generation:string};
 expect(generation).toBeTruthy();
 expect(await env.DB.prepare('SELECT claimed_by FROM review_submissions WHERE id=?').bind(id).first('claimed_by')).toBe(`member-${token==='author'?AUTHOR:OTHER}`);
 const stamped=await request(id,'stamp',token,{verdict:'approve',generation});expect(stamped.status).toBe(200);
 expect(await stamped.json()).toMatchObject({status:'approved',cardStatus:'approved'});
 const record=await env.DB.prepare(`SELECT st.member_id AS reviewer,v.member_id AS author,st.verdict,s.status,c.status AS cardStatus
  FROM review_stamps st JOIN review_submissions s ON s.id=st.submission_id
  JOIN hosting_versions v ON v.submission_id=s.id JOIN cards c ON c.id=s.card_id WHERE s.id=?`).bind(id).first();
 expect(await opsMetrics(env.DB)).toContain('hearthroom_review_length_checks_total{phase="stamp",outcome="eligible"} 1');
 expect(record).toEqual({reviewer:`member-${token==='author'?AUTHOR:OTHER}`,author:`member-${AUTHOR}`,verdict:'approve',status:'approved',cardStatus:'approved'});
});

it.each(roles.flatMap(role=>(['approve','reject'] as const).map(verdict=>({role,verdict}))))('$role can $verdict a historical self-claim and retains the stamp',async({role,verdict})=>{
 await staffRole(role);const id=await submit();
 await env.DB.prepare('UPDATE review_submissions SET claimed_by=?,claimed_at=?,claim_generation=? WHERE id=?').bind(`member-${AUTHOR}`,Date.now(),'historical-self-claim',id).run();
 const note=verdict==='reject'?'Synthetic rejection':'';
 const res=await request(id,'stamp','author',{verdict,note,generation:'historical-self-claim'});
 expect(res.status).toBe(200);
 expect(await res.json()).toMatchObject({status:verdict==='approve'?'approved':'rejected',cardStatus:verdict==='approve'?'approved':'rejected'});
 expect(await env.DB.prepare('SELECT member_id,verdict,note FROM review_stamps WHERE submission_id=?').bind(id).first()).toEqual({member_id:`member-${AUTHOR}`,verdict,note});
});

it.each(['identity','connection','work'] as const)('legacy %s ownership does not prevent self-review',async(source)=>{
 const now=Date.now(),author=`member-${AUTHOR}`;
 await upsertCard(env.DB,role({roleId:'legacy-role',authorNumId:source==='identity'?AUTHOR:777}),now,{status:'pending'});
 const card=await env.DB.prepare("SELECT id FROM cards WHERE source_role_id='legacy-role'").first<{id:number}>();
 if(source==='connection')await env.DB.prepare("INSERT INTO member_connections(provider,external_id,owner_member_id,linked_at) VALUES('harbor','777',?,?)").bind(author,now).run();
 if(source==='work')await env.DB.prepare("INSERT INTO works(id,member_id,source_provider,source_role_id,created_at) VALUES('legacy-work',?,'harbor','legacy-role',?)").bind(author,now).run();
 await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,content_hash,submitted_at,review_length_total) VALUES('legacy-submission',?,'harbor','legacy-role','first','pending','legacy-hash',?,3001)").bind(card!.id,now).run();
 const claim=await request('legacy-submission','claim','author');expect(claim.status).toBe(200);
 const {generation}=await claim.json() as {generation:string};
 const stamp=await request('legacy-submission','stamp','author',{verdict:'approve',generation});expect(stamp.status).toBe(200);
 expect(await stamp.json()).toMatchObject({status:'approved',cardStatus:'approved'});
});

it('still rejects non-reviewers and stale or missing claims without mutation',async()=>{
 const id=await submit();await env.DB.prepare('DELETE FROM reviewers WHERE member_id=?').bind(`member-${AUTHOR}`).run();
 const before=await snapshot(id);
 expect((await request(id,'claim','author')).status).toBe(403);
 expect((await request(id,'stamp','author',{verdict:'approve',generation:'stale'})).status).toBe(403);
 expect(await snapshot(id)).toEqual(before);
 await makeReviewer(AUTHOR);
 expect((await request(id,'stamp','author',{verdict:'approve',generation:'stale'})).status).toBe(409);
 const claim=await request(id,'claim','author');expect(claim.status).toBe(200);
 const claimed=await snapshot(id);
 expect((await request(id,'stamp','author',{verdict:'approve',generation:'stale'})).status).toBe(409);
 expect(await snapshot(id)).toEqual(claimed);
});
