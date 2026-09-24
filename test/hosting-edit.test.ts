import { env, SELF } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { resetDb, role, makeMember } from './helpers';
import { submitHosted, hostingDecision, hostGateway, beginHostedEdit } from '../src/hosting';
import { claim, stamp, pendingSubmissionOf } from '../src/review';
import { getCard, syncStatement } from '../src/cards';
import { upstream } from '../src/upstream';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
async function setup() {
 const memberId = await makeMember(10001);
 const draft = role({roleId:'draft',authorNumId:10001});
 vi.spyOn(hostGateway,'seal').mockImplementation(async(_env,_token,_id,workId,versionId)=>({workId,versionId,hostedRevisionId:'sealed-'+versionId}));
 vi.spyOn(hostGateway,'read').mockImplementation(async(_env,_token,id)=>({...draft,roleId:id}));
 vi.spyOn(upstream,'readForReview').mockResolvedValue({document:{roleDetailDesc:'fixture'},hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
 const submit = (nsfw=false) => submitHosted(env,{memberId,account:10001,role:draft,token:'fixture',nsfw,operationId:crypto.randomUUID(),now:Date.now()});
 const pending = async () => (await pendingSubmissionOf(env.DB,(await getCard(env.DB,'draft','harbor'))!.id))!;
 const approve = async () => { const s=await pending(); for(const memberId of s.kind==='first'?['a','b']:['c']) {await claim(env.DB,s.id,memberId,Date.now());if((await stamp(env.DB,{submissionId:s.id,memberId,verdict:'approve',note:'',now:Date.now()})).submission.status!=='pending')break;} };
 return {memberId,draft,submit,pending,approve};
}
it('editing a pending update retires its review, preserves A, and a fresh review promotes B',async()=>{
 const f=await setup();const a=await f.submit();await f.approve();
 f.draft.names.en='B';const b=await f.submit(true);const old=await f.pending();
 await claim(env.DB,old.id,'old-reviewer',Date.now());
 expect(await beginHostedEdit(env.DB,f.memberId,'draft',Date.now())).toEqual({resubmit:true,nsfw:true});
 expect((await hostingDecision(env.DB,a.versionId)).status).toBe('approved');
 expect((await hostingDecision(env.DB,b.versionId)).status).toBe('superseded');
 await expect(stamp(env.DB,{submissionId:old.id,memberId:'old-reviewer',verdict:'approve',note:'',now:Date.now()})).rejects.toThrow('already decided');
 expect(await env.DB.prepare('SELECT 1 FROM review_snapshots WHERE submission_id=?').bind(old.id).first()).toBeNull();
 // A failed or interrupted save can resume without losing the re-review obligation.
 expect(await beginHostedEdit(env.DB,f.memberId,'draft',Date.now())).toEqual({resubmit:true,nsfw:true});
 f.draft.names.en='B revised';const next=await f.submit(true);await f.approve();
 const card=(await getCard(env.DB,'draft','harbor'))!;
 expect(card.approved_version_id).toBe(next.versionId);
 expect(JSON.parse(card.names).en).toBe('B revised');
 expect(card.nsfw).toBe(1);
 expect((await env.DB.prepare('SELECT search_text FROM cards WHERE id=?').bind(card.id).first<{search_text:string}>())?.search_text).toContain('B revised');
 expect((await getCard(env.DB,a.hostedRevisionId,'harbor'))?.approved_version_id).toBe(next.versionId);
 expect((await hostingDecision(env.DB,a.versionId)).status).toBe('approved');
});
it('editing an approved draft does not start review, and another member cannot cancel a pending review',async()=>{
 const f=await setup();const a=await f.submit();await f.approve();
 expect(await beginHostedEdit(env.DB,f.memberId,'draft',Date.now())).toEqual({resubmit:false});
 const b=await f.submit();
 await expect(beginHostedEdit(env.DB,'other','draft',Date.now())).rejects.toThrow('not the author');
 expect((await hostingDecision(env.DB,b.versionId)).status).toBe('pending');
 expect((await hostingDecision(env.DB,a.versionId)).status).toBe('approved');
});
it('the database refuses a stale stamp or decision after a pending revision is superseded',async()=>{
 const f=await setup();await f.submit();const old=await f.pending();
 await beginHostedEdit(env.DB,f.memberId,'draft',Date.now());
 await expect(env.DB.prepare("INSERT INTO review_stamps(submission_id,member_id,verdict,note,created_at) VALUES (?,'stale','approve','',0)").bind(old.id).run()).rejects.toThrow('submission already decided');
 await expect(env.DB.prepare("UPDATE review_submissions SET status='approved' WHERE id=?").bind(old.id).run()).rejects.toThrow('submission already decided');
 expect((await getCard(env.DB,'draft','harbor'))!.approved_version_id).toBeNull();
});

it('HTTP edit requires the source author and preserves the public play choice',async()=>{
 const f=await setup();const a=await f.submit();await f.approve();await f.submit();
 vi.spyOn(upstream,'fetchRole').mockImplementation(async(_env,id)=>role({roleId:id,authorNumId:10001}));
 await env.DB.prepare("INSERT INTO member_connections VALUES ('harbor','10001',?,0)").bind(f.memberId).run();
 (env as {HOSTING_SERVICE_KEY?:string}).HOSTING_SERVICE_KEY='fixture';
 const identity=vi.spyOn(upstream,'fetchMe').mockResolvedValue({accountNumId:10002});
 const url='https://c.test/v1/cards/draft/edit';
 const headers={Authorization:'Bearer fixture','X-Provider':'harbor'};
 try {
  expect((await SELF.fetch(url,{method:'POST'})).status).toBe(401);
  expect((await SELF.fetch(url,{method:'POST',headers})).status).toBe(403);
  identity.mockResolvedValue({accountNumId:10001});
  const response=await SELF.fetch(url,{method:'POST',headers});
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({resubmit:true,nsfw:false});
  const choices=await SELF.fetch('https://c.test/v1/cards/draft/platforms',{headers});
  expect(await choices.json()).toEqual({platforms:[{provider:'harbor',roleId:a.hostedRevisionId,playable:true}]});
 } finally {delete (env as {HOSTING_SERVICE_KEY?:string}).HOSTING_SERVICE_KEY;}
});

it('a delayed sync of A cannot overwrite the public projection after B is approved',async()=>{
 const f=await setup();await f.submit();await f.approve();
 const card=(await getCard(env.DB,'draft','harbor'))!;
 const delayed=syncStatement(env.DB,card.id,0,role({roleId:card.approved_hosted_role_id!,nameEn:'A'}),Date.now());
 f.draft.names.en='B';await f.submit();await f.approve();
 await delayed.run();
 expect(JSON.parse((await getCard(env.DB,'draft','harbor'))!.names).en).toBe('B');
});

it('rejects stale legacy review writes after migration supersedes the old submission',async()=>{
 const {upsertCard}=await import('../src/cards');
 const {createSubmission}=await import('../src/review');
 const card=await upsertCard(env.DB,role({roleId:'legacy',authorNumId:10001}),1,{status:'approved'});
 const sub=await createSubmission(env.DB,{cardId:card.id,provider:'harbor',roleId:'legacy',kind:'re',contentHash:'old',now:1,nsfw:false});
 await env.DB.prepare("UPDATE review_submissions SET status='superseded' WHERE id=?").bind(sub.id).run();
 await expect(env.DB.prepare("INSERT INTO review_stamps(submission_id,member_id,verdict,note,created_at) VALUES (?,'stale','approve','',0)").bind(sub.id).run()).rejects.toThrow('submission already decided');
 await expect(env.DB.prepare("UPDATE review_submissions SET status='approved' WHERE id=?").bind(sub.id).run()).rejects.toThrow('submission already decided');
});
