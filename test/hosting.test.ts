import { env, SELF } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { resetDb, role, makeMember, reviewOn, reviewOff } from './helpers';
import { submitHosted, hostingDecision, hostGateway } from '../src/hosting';
import { claim, stamp, statusAmong } from '../src/review';
import { getCard } from '../src/cards';
import { upstream } from '../src/upstream';

beforeEach(resetDb);
afterEach(()=>{vi.restoreAllMocks();reviewOff();delete (env as {HOSTING_SERVICE_KEY?:string}).HOSTING_SERVICE_KEY;delete (env as {HOSTING_SERVICE_KEY_LUNATALK?:string}).HOSTING_SERVICE_KEY_LUNATALK;});
it('reviews the sealed revision once, keeps published version during updates, and revokes on withdrawal',async()=>{
 const memberId=await makeMember(10001);
 const me=role({roleId:'draft',authorNumId:10001});
 vi.spyOn(hostGateway,'seal').mockImplementation(async(_env,_token,roleId,workId,versionId)=>({workId,versionId,hostedRevisionId:'sealed-'+versionId}));
 vi.spyOn(hostGateway,'read').mockImplementation(async(_env,_token,id)=>({...me,roleId:id,names:{...me.names,zh:'Frozen title'}}));
 const read=vi.spyOn(upstream,'readForReview').mockResolvedValue({document:{roleDetailDesc:'PRIVATE'},hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
 const input={memberId,account:10001,role:me,token:'author',nsfw:false,operationId:crypto.randomUUID(),now:Date.now()};
 const first=await submitHosted(env,input);
 expect(read.mock.calls[0][2]).toBe(first.hostedRevisionId);
 expect((await hostingDecision(env.DB,first.versionId)).status).toBe('pending');
 expect(await submitHosted(env,input)).toEqual(first);
 expect(hostGateway.seal).toHaveBeenCalledTimes(1);
 await expect(submitHosted(env,{...input,nsfw:true})).rejects.toThrow('hosting_operation_conflict');
 await expect(submitHosted(env,{...input,operationId:crypto.randomUUID()})).rejects.toThrow('submission_pending');
 const sub=await env.DB.prepare('SELECT id FROM review_submissions').first<{id:string}>();
 for (const reviewer of ['first','second']){
  await claim(env.DB,sub!.id,reviewer,Date.now());
  await stamp(env.DB,{submissionId:sub!.id,memberId:reviewer,verdict:'approve',note:'',now:Date.now()});
 }
 expect((await hostingDecision(env.DB,first.versionId)).status).toBe('approved');
 const second=await submitHosted(env,{...input,operationId:crypto.randomUUID(),nsfw:true});
 expect(second.versionId).not.toBe(first.versionId);
 expect((await statusAmong(env.DB,['draft'])).get('draft')).toMatchObject({status:'approved',updateStatus:'pending'});
 expect((await getCard(env.DB,'draft','harbor'))?.status).toBe('approved');
 expect((await hostingDecision(env.DB,first.versionId)).status).toBe('approved');
 const update=await env.DB.prepare("SELECT id FROM review_submissions WHERE status='pending'").first<{id:string}>();
 await claim(env.DB,update!.id,'third',Date.now());
 await stamp(env.DB,{submissionId:update!.id,memberId:'third',verdict:'reject',note:'revise',now:Date.now()});
 expect((await hostingDecision(env.DB,first.versionId)).status).toBe('approved');
 expect((await hostingDecision(env.DB,second.versionId)).status).toBe('rejected');
 expect((await getCard(env.DB,'draft','harbor'))?.nsfw).toBe(0);
 await env.DB.prepare("DELETE FROM cards WHERE source_role_id='draft'").run();
 expect((await hostingDecision(env.DB,first.versionId)).status).toBe('revoked');
});
it('a failed seal remains retryable and concurrent retries leave only one private snapshot',async()=>{
 const memberId=await makeMember(10001);
 const me=role({roleId:'draft',authorNumId:10001});
 vi.spyOn(hostGateway,'seal').mockRejectedValueOnce(new Error('offline')).mockImplementation(async(_env,_token,_id,workId,versionId)=>({workId,versionId,hostedRevisionId:'sealed-'+versionId}));
 vi.spyOn(hostGateway,'read').mockImplementation(async(_env,_token,id)=>({...me,roleId:id}));
 vi.spyOn(upstream,'readForReview').mockResolvedValue({hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
 const input={memberId,account:10001,role:me,token:'author',nsfw:false,operationId:crypto.randomUUID(),now:Date.now()};
 await expect(submitHosted(env,input)).rejects.toThrow('offline');
 const next={...input,operationId:crypto.randomUUID()};
 const results=await Promise.all([submitHosted(env,next),submitHosted(env,next)]);
 expect(results[0]).toEqual(results[1]);
 expect((await env.DB.prepare('SELECT count(*) n FROM review_snapshots').first<{n:number}>())?.n).toBe(1);
 expect((await env.DB.prepare('SELECT count(*) n FROM review_submissions').first<{n:number}>())?.n).toBe(1);
});

it.each(['harbor','lunatalk'] as const)('HTTP submits a private %s draft and exposes only approved hosted choices',async(provider)=>{
 (env as {HOSTING_SERVICE_KEY?:string}).HOSTING_SERVICE_KEY='fixture';(env as {HOSTING_SERVICE_KEY_LUNATALK?:string}).HOSTING_SERVICE_KEY_LUNATALK='luna-fixture';reviewOn();
 vi.spyOn(upstream,'fetchMe').mockResolvedValue({accountNumId:10001});
 vi.spyOn(upstream,'fetchRole').mockImplementation(async(_env,id)=>{if(id==='private-draft')throw new Error('private draft');return role({roleId:id,authorNumId:10001})});
 vi.spyOn(hostGateway,'seal').mockImplementation(async(_env,_token,_id,workId,versionId)=>({workId,versionId,hostedRevisionId:'sealed-'+versionId}));
 vi.spyOn(hostGateway,'read').mockImplementation(async(_env,_token,id)=>role({roleId:id,authorNumId:10001}));
 vi.spyOn(upstream,'readForReview').mockResolvedValue({hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
 const headers={Authorization:'Bearer author','X-Provider':provider,'Content-Type':'application/json'};
 const response=await SELF.fetch('https://c.test/v1/cards',{method:'POST',headers,body:JSON.stringify({roleId:'private-draft',nsfw:false,operationId:crypto.randomUUID()})});
 expect(response.status).toBe(201);
 expect(upstream.fetchRole).not.toHaveBeenCalled();
 const result=await response.json() as {versionId:string};
 const sub=await env.DB.prepare('SELECT id FROM review_submissions').first<{id:string}>();
 for(const memberId of ['a','b']){await claim(env.DB,sub!.id,memberId,Date.now());await stamp(env.DB,{submissionId:sub!.id,memberId,verdict:'approve',note:'',now:Date.now()});}
 const decision=await SELF.fetch('https://c.test/v1/hosting/versions/'+result.versionId+'/decision');
 expect(decision.headers.get('cache-control')).toContain('no-store');
 const receipt=await decision.json() as {hostedRevisionId:string};
 const choices=await SELF.fetch('https://c.test/v1/cards/'+receipt.hostedRevisionId+'/platforms',{headers});
 expect(await choices.json()).toEqual({platforms:[{provider,roleId:receipt.hostedRevisionId,playable:true}]});
 const publicCard=await SELF.fetch('https://c.test/v1/cards/'+receipt.hostedRevisionId,{headers});
 expect(publicCard.status).toBe(200);
 expect((await publicCard.json() as {roleId:string}).roleId).toBe(receipt.hostedRevisionId);
});
it('a failed review transaction cannot consume a listing slot or leave an empty card',async()=>{
 const memberId=await makeMember(10001);
 const me=role({roleId:'draft',authorNumId:10001});
 vi.spyOn(hostGateway,'seal').mockImplementation(async(_env,_token,_id,workId,versionId)=>({workId,versionId,hostedRevisionId:'sealed-'+versionId}));
 vi.spyOn(hostGateway,'read').mockImplementation(async(_env,_token,id)=>({...me,roleId:id}));
 vi.spyOn(upstream,'readForReview').mockResolvedValue({hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
 await env.DB.prepare("CREATE TRIGGER fixture_snapshot_failure BEFORE INSERT ON review_snapshots BEGIN SELECT RAISE(ABORT,'fixture_failure'); END").run();
 try {
  await expect(submitHosted(env,{memberId,account:10001,role:me,token:'author',nsfw:false,operationId:crypto.randomUUID(),now:Date.now()})).rejects.toThrow();
  expect((await env.DB.prepare('SELECT count(*) n FROM cards').first<{n:number}>())?.n).toBe(0);
  expect((await env.DB.prepare('SELECT count(*) n FROM card_registrations').first<{n:number}>())?.n).toBe(0);
 } finally { await env.DB.prepare('DROP TRIGGER fixture_snapshot_failure').run(); }
});

it('never caches an unknown review version decision',async()=>{
 const response=await SELF.fetch('https://c.test/v1/hosting/versions/'+crypto.randomUUID()+'/decision');
 expect(response.status).toBe(404);
 expect(await response.json()).toEqual({error:'version_not_found'});
 expect(response.headers.get('cache-control')).toContain('no-store');
});
