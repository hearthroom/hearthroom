import { env, SELF } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { bearer, identities, makeMember, makeReviewer, resetDb, restoreUpstream, role, GENERAL_RATING, rolesOnMainSite, ratingBody, reviewOn, reviewOff } from './helpers';
import { ensureCardNumber } from '../src/cards';
import { hostGateway, submitHosted } from '../src/hosting';
import { upstream } from '../src/upstream';
import { claim, stamp } from '../src/review';

let number:number, other:number;
const request=(id:number|string, token='manager', body?:unknown)=>SELF.fetch(`https://c.test/v1/moderation/review-length-exemptions/${id}`,{
  method:body===undefined?'GET':'POST', headers:{...bearer(token),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),
});
const change=(enabled=true,extra:Record<string,unknown>={})=>({enabled,reason:enabled?'Synthetic special format':'',revision:0,operationId:crypto.randomUUID(),...extra});
beforeEach(async()=>{
  await resetDb(); await makeMember(10001); await makeMember(10002);
  for(const id of [2,3,4])await makeReviewer(id);
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id='member-3'").run();
  await env.DB.prepare("UPDATE reviewers SET role='owner' WHERE member_id='member-4'").run();
  identities({author:10001,stranger:10002,reviewer:2,manager:3,owner:4});
  number=await ensureCardNumber(env.DB,'harbor','short-draft');
  other=await ensureCardNumber(env.DB,'harbor','other-draft');
});
afterEach(()=>{restoreUpstream();reviewOff();vi.restoreAllMocks();});

it('LE01 enforces active human manager/owner on reads and writes without side effects',async()=>{
  for(const token of ['author','reviewer','stranger']){
    expect((await request(number,token)).status).toBe(403);
    expect((await request(number,token,change())).status).toBe(403);
    expect((await request(number,token,change(false))).status).toBe(403);
  }
  expect((await SELF.fetch(`https://c.test/v1/moderation/review-length-exemptions/${number}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(change())})).status).toBe(401);
  expect((await request(number,'owner',change())).status).toBe(200);
  await env.DB.prepare("UPDATE reviewers SET revoked_at=1 WHERE member_id='member-3'").run();
  expect((await request(other,'manager',change())).status).toBe(403);
  await env.DB.prepare("INSERT INTO review_agents(member_id,granted_by,granted_at) VALUES('member-4','member-3',1)").run();
  expect((await request(other,'owner',change())).status).toBe(403);
  expect(await env.DB.prepare("SELECT count(*) n FROM audit_log WHERE subject_kind='review_length_exemption'").first('n')).toBe(1);
});

it('LE02 finds only an exact public number before any submission and never returns private content',async()=>{
  const read=vi.spyOn(hostGateway,'read');
  expect(await env.DB.prepare('SELECT count(*) n FROM cards').first('n')).toBe(0);
  const response=await request(number);expect(response.status).toBe(200);
  expect(await response.json()).toEqual({cardNumber:number,enabled:false,revision:0,updatedAt:null,actor:null,reason:'',history:[]});
  for(const id of ['short-draft','1000','100001x','0100001','999999'])expect((await request(id)).status).toBe(404);
  expect(read).not.toHaveBeenCalled();
});

it('LE03 validates reasons and payloads, persists original statistics and rejects stale revisions',async()=>{
  for(const reason of [undefined,'','   ',7,'x'.repeat(2001)])expect((await request(number,'manager',change(true,{reason}))).status).toBe(400);
  expect((await request(number,'manager',change(true,{enabled:'true'}))).status).toBe(400);
  expect((await request(number,'manager',change(true,{revision:-1}))).status).toBe(400);
  const response=await request(number,'manager',change());expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({enabled:true,revision:1,actor:expect.any(String),reason:'Synthetic special format'});
  expect((await request(number,'owner',change(false))).status).toBe(409);
  expect((await request(number,'owner',change(false,{revision:1}))).status).toBe(200);
  expect(await request(number).then(r=>r.json())).toMatchObject({enabled:false,revision:2});
});

it('LE05 audits actor, time, card, reason, before/after and replays without duplicating or crossing operations',async()=>{
  const body=change();expect((await request(number,'manager',body)).status).toBe(200);
  expect((await request(number,'manager',body)).status).toBe(200);
  expect((await request(other,'manager',body)).status).toBe(409);
  expect((await request(number,'manager',{...body,enabled:false})).status).toBe(409);
  expect((await request(number,'manager',{...body,reason:'changed'})).status).toBe(409);
  const audit=await env.DB.prepare("SELECT * FROM audit_log WHERE subject_kind='review_length_exemption'").first<any>();
  expect(audit).toMatchObject({subject_id:String(number),actor_member_id:'member-3',action:'enable',reason:body.reason,operation_id:body.operationId,created_at:expect.any(Number)});
  expect(JSON.parse(audit.before_json)).toMatchObject({enabled:false,revision:0});
  expect(JSON.parse(audit.after_json)).toMatchObject({enabled:true,revision:1});
  const history=await request(number).then(r=>r.json()) as any;
  expect(history.history).toHaveLength(1);expect(history.history[0]).toMatchObject({action:'enable',reason:body.reason,at:audit.created_at,actor:expect.any(String)});
  expect(JSON.stringify(history)).not.toContain('member-3');
  const metrics=await SELF.fetch('https://c.test/metrics').then(r=>r.text());
  expect(metrics).toContain('hearthroom_review_length_exemption_operations_total{operation="enable",outcome="success"} 1');
  expect(metrics).toContain('hearthroom_review_length_exemption_operations_total{operation="enable",outcome="replay"} 1');
});

it('LE05 rolls back the state on audit failure and succeeds after removing the fault',async()=>{
  await env.DB.exec("CREATE TRIGGER exemption_audit_fault BEFORE INSERT ON audit_log WHEN NEW.subject_kind='review_length_exemption' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;");
  const body=change();
  try{
    expect((await request(number,'manager',body)).status).toBe(503);
    expect(await request(number).then(r=>r.json())).toMatchObject({enabled:false,revision:0,history:[]});
  }finally{await env.DB.exec('DROP TRIGGER exemption_audit_fault');}
  expect((await request(number,'manager',body)).status).toBe(200);
});

it('LE05 rolls back audit on state failure and succeeds after removing the fault',async()=>{
  await env.DB.exec("CREATE TRIGGER exemption_state_fault BEFORE INSERT ON review_length_exemptions BEGIN SELECT RAISE(ABORT,'synthetic state failure'); END;");
  const body=change();
  try{
    expect((await request(number,'manager',body)).status).toBe(503);
    expect(await env.DB.prepare("SELECT count(*) n FROM audit_log WHERE subject_kind='review_length_exemption'").first('n')).toBe(0);
  }finally{await env.DB.exec('DROP TRIGGER exemption_state_fault');}
  expect((await request(number,'manager',body)).status).toBe(200);
});

function shortSettings(){
  vi.spyOn(hostGateway,'seal').mockImplementation(async(_e,_t,_r,workId,versionId)=>({workId,versionId,hostedRevisionId:'frozen-'+versionId}));
  vi.spyOn(hostGateway,'read').mockImplementation(async(_e,_t,id)=>role({roleId:id,authorNumId:10001}));
  vi.spyOn(upstream,'readForReview').mockImplementation(async(_e,_t,id)=>({document:{roleDetailDesc:id.startsWith('frozen-')?'字'.repeat(2):'字'.repeat(3)},hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}}));
}
const submit=()=>submitHosted(env,{memberId:'member-10001',account:10001,role:role({roleId:'short-draft',authorNumId:10001}),token:'author',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()});

it('LE04 bypasses draft, immutable and approval gates for the same card only, preserving actual counts',async()=>{
  shortSettings();expect((await request(number,'manager',change())).status).toBe(200);
  await submit();
  const s=await env.DB.prepare('SELECT id,review_length_total FROM review_submissions').first<any>();
  expect(s.review_length_total).toBe(2);
  await claim(env.DB,s.id,'member-2',Date.now());
  await stamp(env.DB,{submissionId:s.id,memberId:'member-2',verdict:'approve',note:'',now:Date.now()},env);
  const {opsMetrics}=await import('../src/ops-metrics');const metrics=await opsMetrics(env.DB);
  for(const phase of ['draft','sealed','stamp'])expect(metrics).toContain(`hearthroom_review_length_checks_total{phase="${phase}",outcome="exempt"} 1`);
  await expect(submitHosted(env,{memberId:'member-10001',account:10001,role:role({roleId:'other-draft',authorNumId:10001}),token:'author',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()})).rejects.toMatchObject({message:'review_length_insufficient'});
});

it('LE06 revocation restores approval and future draft/sealed gates without retracting earlier public versions',async()=>{
  shortSettings();await request(number,'manager',change());await submit();
  const s=await env.DB.prepare('SELECT id FROM review_submissions').first<any>();
  await claim(env.DB,s.id,'member-2',Date.now());
  expect((await request(number,'manager',change(false,{revision:1}))).status).toBe(200);
  await expect(stamp(env.DB,{submissionId:s.id,memberId:'member-2',verdict:'approve',note:'',now:Date.now()},env)).rejects.toMatchObject({message:'review_length_insufficient'});
  expect(await env.DB.prepare('SELECT count(*) n FROM review_stamps').first('n')).toBe(0);
  // Remove only this synthetic pending submission so a fresh admission reaches the draft gate.
  await env.DB.prepare("UPDATE review_submissions SET status='superseded' WHERE id=?").bind(s.id).run();
  await expect(submit()).rejects.toMatchObject({message:'review_length_insufficient'});
});

it('LE07 gives only the authenticated author a boolean, without staff metadata or forged input',async()=>{
  shortSettings();await request(number,'manager',change());
  const own=(token:string,id='short-draft')=>SELF.fetch(`https://c.test/v1/me/review-length-exemptions/${id}`,{headers:bearer(token)});
  expect(await own('author').then(r=>r.json())).toEqual({enabled:true});
  expect((await own('stranger')).status).toBe(404);
  expect(await own('author','other-draft').then(r=>r.json())).toEqual({enabled:false});
});

it('LE04 does not accept client-forged eligibility or waive the rating and adult-review rules',async()=>{
  shortSettings();reviewOn();rolesOnMainSite({roleId:'short-draft',authorNumId:10001});
  const publish=(extra:Record<string,unknown>)=>SELF.fetch('https://c.test/v1/cards',{method:'POST',headers:{...bearer('author'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'short-draft',operationId:crypto.randomUUID(),...extra})});
  const forged=await publish({...ratingBody(false),exempt:true,eligible:true,lengthExempt:true});
  expect(forged.status).toBe(400);expect(await forged.json()).toMatchObject({error:'review_length_insufficient'});
  await request(number,'manager',change());
  expect(await publish({}).then(r=>r.json())).toMatchObject({error:'rating_required'});
  expect((await publish(ratingBody(true))).status).toBe(201);
  const s=await env.DB.prepare('SELECT id FROM review_submissions').first<any>();
  const adult=await SELF.fetch(`https://c.test/v1/review/${s.id}/claim`,{method:'POST',headers:bearer('manager')});
  expect(adult.status).toBe(403);expect(await adult.json()).toMatchObject({error:'age_verification_required'});
});

it('LE06 reads fresh state after seal rather than reusing the exempt draft decision',async()=>{
  shortSettings();await request(number,'manager',change());
  vi.mocked(hostGateway.seal).mockImplementation(async(_e,_t,_r,workId,versionId)=>{
    expect((await request(number,'owner',change(false,{revision:1}))).status).toBe(200);
    return {workId,versionId,hostedRevisionId:'frozen-'+versionId};
  });
  await expect(submit()).rejects.toMatchObject({message:'review_length_insufficient'});
  expect(await env.DB.prepare('SELECT count(*) n FROM review_submissions').first('n')).toBe(0);
  const {opsMetrics}=await import('../src/ops-metrics');
  expect(await opsMetrics(env.DB)).toContain('hearthroom_review_length_checks_total{phase="sealed",outcome="insufficient"} 1');
});
