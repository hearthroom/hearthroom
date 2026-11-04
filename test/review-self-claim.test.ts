import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { legacyPolicyFixture } from './work-policy-fixture';
import { bearer, identities, makeMember, makeReviewer, ratingBody, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite, role } from './helpers';
import { upsertCard } from '../src/cards';

const AUTHOR=10001, OTHER=20001;
const roles=['reviewer','manager','owner'] as const;
beforeEach(async()=>{
 await resetDb();legacyPolicyFixture();
 identities({author:AUTHOR,other:OTHER});
 rolesOnMainSite({roleId:'self-guard-role',authorNumId:AUTHOR});
 reviewUpstream();reviewOn();
 await makeReviewer(AUTHOR);await makeReviewer(OTHER);
});
afterEach(()=>{restoreUpstream();reviewOff();});
const request=(id:string,action:'claim'|'stamp',token:string,body:object={})=>SELF.fetch(`https://c.test/v1/review/${id}/${action}`,{
 method:'POST',headers:{...bearer(token),'Content-Type':'application/json'},body:JSON.stringify(body),
});
async function staffRole(role:string){await env.DB.prepare('UPDATE reviewers SET role=? WHERE member_id IN (?,?)').bind(role,`member-${AUTHOR}`,`member-${OTHER}`).run();}
async function submit(){
 const res=await SELF.fetch('https://c.test/v1/cards',{method:'POST',headers:{...bearer('author'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'self-guard-role',...ratingBody(false),operationId:crypto.randomUUID()})});
 expect(res.status).toBe(201);
 return (await env.DB.prepare('SELECT id FROM review_submissions').first<{id:string}>())!.id;
}
async function snapshot(id:string){return {
 submission:await env.DB.prepare('SELECT * FROM review_submissions WHERE id=?').bind(id).first(),
 cards:(await env.DB.prepare('SELECT * FROM cards ORDER BY id').all()).results,
 stamps:(await env.DB.prepare('SELECT * FROM review_stamps ORDER BY submission_id,member_id').all()).results,
 decisions:(await env.DB.prepare('SELECT * FROM work_review_decisions ORDER BY submission_id').all()).results,
};}

it.each(roles)('%s cannot claim their own submitted card and leaves the claim unchanged',async(role)=>{
 await staffRole(role);const id=await submit(),before=await snapshot(id);
 const res=await request(id,'claim','author');
 expect(res.status).toBe(403);expect(await res.json()).toMatchObject({error:'moderation_self_review'});
 expect(await snapshot(id)).toEqual(before);
});

it.each(roles.flatMap(role=>(['approve','reject'] as const).map(verdict=>({role,verdict}))))('$role cannot $verdict a historical self-claim or change publication',async({role,verdict})=>{
 await staffRole(role);const id=await submit();
 // Historical pre-fix state, not a self-claim performed through the fixed endpoint.
 await env.DB.prepare('UPDATE review_submissions SET claimed_by=?,claimed_at=?,claim_generation=? WHERE id=?').bind(`member-${AUTHOR}`,Date.now(),'historical-self-claim',id).run();
 const before=await snapshot(id);
 const res=await request(id,'stamp','author',{verdict,note:verdict==='reject'?'Synthetic rejection':'',generation:'historical-self-claim'});
 expect(res.status).toBe(403);expect(await res.json()).toMatchObject({error:'moderation_self_review'});
 expect(await snapshot(id)).toEqual(before);
});

it.each(roles)('%s can still claim and approve another author through the real handlers',async(role)=>{
 await staffRole(role);const id=await submit();
 const res=await request(id,'claim','other');expect(res.status).toBe(200);
 const {generation}=await res.json() as {generation:string};
 const stamped=await request(id,'stamp','other',{verdict:'approve',generation});expect(stamped.status).toBe(200);
 expect(await stamped.json()).toMatchObject({status:'approved',cardStatus:'approved'});
 expect(await env.DB.prepare('SELECT member_id FROM review_stamps WHERE submission_id=?').bind(id).first('member_id')).toBe(`member-${OTHER}`);
});

it.each(['identity','connection','work'] as const)('legacy card author uses the same %s ownership resolution as moderation',async(source)=>{
 const now=Date.now(),author=await makeMember(AUTHOR);
 await upsertCard(env.DB,role({roleId:'legacy-role',authorNumId:source==='identity'?AUTHOR:777}),now,{status:'pending'});
 const card=await env.DB.prepare("SELECT id FROM cards WHERE source_role_id='legacy-role'").first<{id:number}>();
 if(source==='connection')await env.DB.prepare("INSERT INTO member_connections(provider,external_id,owner_member_id,linked_at) VALUES('harbor','777',?,?)").bind(author,now).run();
 if(source==='work')await env.DB.prepare("INSERT INTO works(id,member_id,source_provider,source_role_id,created_at) VALUES('legacy-work',?,'harbor','legacy-role',?)").bind(author,now).run();
 await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,content_hash,submitted_at,review_length_total) VALUES('legacy-submission',?,'harbor','legacy-role','first','pending','legacy-hash',?,3001)").bind(card!.id,now).run();
 expect((await request('legacy-submission','claim','author')).status).toBe(403);
 await env.DB.prepare("UPDATE review_submissions SET claimed_by=?,claimed_at=?,claim_generation='legacy-generation' WHERE id='legacy-submission'").bind(author,now).run();
 const before=await snapshot('legacy-submission');
 expect((await request('legacy-submission','stamp','author',{verdict:'approve',generation:'legacy-generation'})).status).toBe(403);
 expect(await snapshot('legacy-submission')).toEqual(before);
});
