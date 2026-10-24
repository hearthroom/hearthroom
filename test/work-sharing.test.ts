import {createExecutionContext,env,waitOnExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import worker from '../src/index';
import {getCard,upsertCard} from '../src/cards';
import {identitiesFor,makeMember,resetDb,restoreUpstream,role,ratingBody} from './helpers';
import {reconcileWorkAccess} from '../src/work-reconcile';
import {hostGateway} from '../src/hosting';
import {unregister} from '../src/cards';

beforeEach(resetDb);
afterEach(()=>{vi.restoreAllMocks();restoreUpstream();});
async function fixture(unmanaged=false){
 const source=crypto.randomUUID(),work=crypto.randomUUID(),approved=crypto.randomUUID();
 const member=await makeMember(11);identitiesFor({harbor:{owner:11,readOnly:11,reader:42}});
 await upsertCard(env.DB,role({roleId:source,authorNumId:11}),Date.now(),{status:'approved'});
 const card=(await getCard(env.DB,source))!;
 await env.DB.prepare('UPDATE cards SET approved_hosted_role_id=?,approved_version_id=? WHERE id=?').bind(approved,crypto.randomUUID(),card.id).run();
 await env.DB.prepare('INSERT INTO works VALUES(?,?,?,?,?)').bind(work,member,'harbor',source,Date.now()).run();
 await env.DB.prepare("INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,approved_role_id) VALUES(?,'harbor',?,'private',2,'none',?)").bind(work,source,approved).run();
 await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at,decided_at) VALUES(?,?,'harbor',?,'initial','approved',1,2)").bind(crypto.randomUUID(),card.id,source).run();
 const current={sourceRoleId:source,workId:work,managed:true,access:'private',epoch:2,restriction:'none',state:'complete',replayed:false,
  revisionState:'same',restorable:true,restoreReason:'same',approvalRevision:'approved-opaque-revision',policyRevision:'policy-opaque-revision',providerRestriction:'none',approvedRoleId:approved};
 const receipts=new Map<string,Record<string,unknown>>();
 const behavior={lostReply:false,unavailable:false,commands:0};
 if(unmanaged){
  await env.DB.prepare('DELETE FROM managed_work_access').run();await env.DB.prepare('DELETE FROM review_submissions').run();await env.DB.prepare('DELETE FROM cards').run();await env.DB.prepare('DELETE FROM works').run();
  current.managed=false;current.workId='00000000-0000-0000-0000-000000000000';current.epoch=0;current.restorable=false;current.revisionState='unknown';current.restoreReason='not_approved';
  current.approvedRoleId='';
  vi.spyOn(hostGateway,'read').mockImplementation(async(_e,_t,id)=>role({roleId:id,authorNumId:11,name:'New private draft'}));
 }
 const network=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const path=new URL(String(input)).pathname;
  if(path==='/open/v1/hosting/work-access/batch'){
   const {items}=JSON.parse(String(init?.body)) as {items:{sourceRoleId:string;workId:string;targetRoleId:string}[]};
   return Response.json({items:items.map(item=>({...current,...item,shareRoleId:current.access==='public'?current.approvedRoleId:current.access==='unlisted'?source:'',targetReadable:current.access!=='private'&&current.restriction!=='suspended',listed:current.access==='public'&&current.restriction==='none'}))});
  }
  if(path.startsWith(`/open/v1/hosting/work-access/${source}/operations/`)){
   const receipt=receipts.get(path.split('/').at(-1)!);return receipt?Response.json(receipt):Response.json({error:'not_found'},{status:404});
  }
  if(path!==`/open/v1/hosting/work-access/${source}`)throw new Error('Unexpected owner fixture request');
  if((init?.method??'GET')==='GET'&&!new URL(String(input)).searchParams.has('include'))return Response.json(current);
  const bearer=new Headers(init?.headers).get('Authorization');
  const issuerPrepare=init?.method==='POST'&&JSON.parse(String(init.body)).action==='prepare'&&new Headers(init?.headers).get('X-Hosting-Key')==='fixture-issuer';
  if(!issuerPrepare&&bearer!=='Bearer owner'&&bearer!=='Bearer readOnly')return Response.json({error:'role_not_author'},{status:403});
  if(bearer==='Bearer readOnly'&&(new URL(String(input)).searchParams.get('intent')==='write'||init?.method==='POST'))return Response.json({error:'insufficient_scope'},{status:403});
  if(init?.method==='POST'){
   if(behavior.unavailable)return Response.json({error:'hosting_unavailable'},{status:503});
   const command=JSON.parse(String(init.body)) as {operationId:string;workId:string;expectedEpoch:number;expectedOwnerRevision?:string;action:string;access?:string;versionRoleId?:string};
   const prior=receipts.get(command.operationId);if(prior)return Response.json({...prior,replayed:true});
   if(command.expectedEpoch!==current.epoch||command.expectedOwnerRevision!==current.policyRevision)return Response.json({error:'work_access_conflict'},{status:409});
   behavior.commands++;
   if(command.action!=='prepare'){current.epoch++;current.policyRevision='policy-opaque-revision-'+current.epoch;}
   if(command.action==='bind'){current.managed=true;current.workId=command.workId;current.access=command.access!;current.approvedRoleId=command.versionRoleId??'';}
   current.access=command.action==='private'?'private':command.action==='unlisted'?'unlisted':command.action==='restore'?'public':current.access;
   const receipt={sourceRoleId:source,workId:current.workId,operationId:command.operationId,access:current.access,epoch:current.epoch,restriction:current.restriction,state:command.action==='prepare'?'prepared':'complete',replayed:false};
   receipts.set(command.operationId,receipt);
   if(behavior.lostReply){behavior.lostReply=false;throw new Error('Fixture reply lost after commit');}
   return Response.json(receipt);
  }
  return Response.json(current);
 });
 return {source,work,member,card,current,network,behavior};
}
it('only advertises author visibility controls when the server rollout flag is enabled',async()=>{
 const enabled=await request('/v1/providers','');expect(enabled.status).toBe(200);
 expect(await enabled.json()).toMatchObject({capabilities:{workVisibility:true}});
 const disabled=await request('/v1/providers','',undefined,false);const body=await disabled.json() as {capabilities?:{workVisibility?:boolean}};
 expect(body.capabilities?.workVisibility??false).toBe(false);
});
async function request(path:string,token='owner',body?:unknown,enabled=true){
 const ctx=createExecutionContext();const response=await worker.fetch(new Request('https://c.test'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{...env,HOSTING_SERVICE_KEY:'fixture-issuer',WORK_SHARING_ENABLED:enabled?'true':'false'},ctx);
 await waitOnExecutionContext(ctx);return response;
}
it('returns the owner-only full restore projection without changing policy or creating an operation',async()=>{
 const {source,card,member}=await fixture();
 const response=await request(`/v1/me/cards/${card.id}/visibility`);
 expect(response.status).toBe(200);
 const body=await response.json() as {workVisibility:Record<string,unknown>};
 expect(body.workVisibility).toMatchObject({access:'private',effectiveAccess:'owner',everPublic:true,revisionState:'same',restorable:true,restoreReason:'none',restriction:'none',review:'none',update:'none',syncState:'complete'});
 expect(body.workVisibility.actions).toContain('restore_public');expect(body.workVisibility.policyRevision).toMatch(/^[a-f0-9]{64}$/);
 expect(JSON.stringify(body)).not.toContain(member);expect(response.headers.get('Cache-Control')).toContain('no-store');
 expect((await env.DB.prepare('SELECT count(*) AS n FROM visibility_operations').first<{n:number}>())?.n).toBe(0);
 expect((await env.DB.prepare('SELECT access FROM managed_work_access WHERE source_role_id=?').bind(source).first<{access:string}>())?.access).toBe('private');
});

it('reads approval history and update review through canonical work lineage when reviews name hosted revisions',async()=>{
 const {source,work,member,card,current}=await fixture();
 await env.DB.prepare('DELETE FROM review_submissions').run();
 for(const [kind,status,created] of [['first','approved',1],['re','pending',9]] as const){
  const submission=crypto.randomUUID(),version=crypto.randomUUID(),hosted=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at) VALUES(?,?,'harbor',?,?,?,?)").bind(submission,card.id,hosted,kind,status,created).run();
  await env.DB.prepare("INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,hosted_revision_id,card_id,submission_id,state,created_at) VALUES(?,?,?,?,?,'harbor',?,?,?,?,?)").bind(version,work,member,crypto.randomUUID(),source,hosted,card.id,submission,status,created).run();
 }
 const f=await request(`/v1/me/cards/${card.id}/visibility`);
 const projection=await f.json() as {workVisibility:{everPublic:boolean;review:string;update:string}};
 expect(projection.workVisibility.everPublic).toBe(true);
 // Private/unlisted pending re-review is a public application, not a public update.
 expect(projection.workVisibility.review).toBe('pending');expect(projection.workVisibility.update).toBe('none');
 current.access='public';await env.DB.prepare("UPDATE managed_work_access SET access='public' WHERE work_id=?").bind(work).run();
 expect(await(await request(`/v1/me/cards/${card.id}/visibility`)).json()).toMatchObject({workVisibility:{review:'none',update:'pending',everPublic:true,syncState:'complete'}});
});

it('does not call a legacy public approval revoked merely because the source is not enrolled',async()=>{
 const {card,current}=await fixture();await env.DB.prepare('DELETE FROM managed_work_access').run();
 current.managed=false;current.epoch=0;current.workId='00000000-0000-0000-0000-000000000000';current.approvedRoleId='';current.restorable=false;current.restoreReason='not_approved';
 expect(await(await request(`/v1/me/cards/${card.id}/visibility`)).json()).toMatchObject({workVisibility:{access:'public',everPublic:true,review:'none'}});
});

it('registers an unreviewed unlisted share once without consuming publication quota or a first-publication timestamp',async()=>{
 const {source,behavior}=await fixture(true);const intent=await command(source);
 const response=await request(`/v1/me/cards/${source}/visibility`,'owner',intent);
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({workVisibility:{access:'unlisted',everPublic:false,restorable:false,syncState:'complete'}});
 const shared=await getCard(env.DB,source);expect(shared).toMatchObject({registered_at:0,status:'unshared',rating:'R',approved_version_id:null,approved_hosted_role_id:null});
 expect((await env.DB.prepare('SELECT count(*) AS n FROM card_registrations').first<{n:number}>())?.n).toBe(0);
 expect((await env.DB.prepare('SELECT count(*) AS n FROM hosting_versions').first<{n:number}>())?.n).toBe(0);
 expect((await env.DB.prepare('SELECT count(*) AS n FROM review_submissions').first<{n:number}>())?.n).toBe(0);
 expect((await request(`/v1/me/cards/${source}/visibility`,'owner',intent)).status).toBe(200);expect(behavior.commands).toBe(1);
 expect((await getCard(env.DB,source))?.id).toBe(shared?.id);
});

it('makes legacy withdrawal private without deleting the stable card or its favorites',async()=>{
 const {source,card,member,behavior,current}=await fixture();
 await env.DB.prepare('DELETE FROM managed_work_access').run();
 current.managed=false;current.epoch=0;current.workId='00000000-0000-0000-0000-000000000000';current.approvedRoleId='';
 vi.spyOn(hostGateway,'read').mockResolvedValue(role({roleId:source,authorNumId:11}));
 await env.DB.prepare('INSERT INTO member_favorites VALUES(?,?,?)').bind(member,card.id,1).run();
 await unregister(env.DB,card.id,11,'harbor',{...env,HOSTING_SERVICE_KEY:'fixture-issuer'},'owner');
 expect(await getCard(env.DB,card.id)).toMatchObject({id:card.id,status:'unshared'});
 expect(await env.DB.prepare('SELECT 1 FROM member_favorites WHERE member_id=? AND card_id=?').bind(member,card.id).first()).not.toBeNull();
 expect(behavior.commands).toBe(1);
});

async function command(cardId:string,targetAccess='unlisted'){
 const response=await request(`/v1/me/cards/${cardId}/visibility`);const body=await response.json() as {workVisibility:{policyRevision:string;approvalRevision:string}};
 return {operationId:crypto.randomUUID(),targetAccess,expectedPolicyRevision:body.workVisibility.policyRevision,expectedApprovalRevision:body.workVisibility.approvalRevision};
}
it('keeps author mutation disabled unless explicitly enabled',async()=>{
 const {card,behavior}=await fixture();const intent=await command(card.id);
 const response=await request(`/v1/me/cards/${card.id}/visibility`,'owner',intent,false);
 expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:'visibility_disabled'});expect(behavior.commands).toBe(0);
});
it('completes unlisted after Provider and D1 agree, with one durable command and stable community data',async()=>{
 const {card,work,behavior}=await fixture();
 await env.DB.prepare('UPDATE cards SET heat=777 WHERE id=?').bind(card.id).run();
 const intent=await command(card.id);
 const response=await request(`/v1/me/cards/${card.id}/visibility`,'owner',intent);
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({workVisibility:{access:'unlisted',syncState:'complete',review:'none'},operation:{operationId:intent.operationId,state:'complete'}});
 const stored=await getCard(env.DB,card.id);expect(stored).toMatchObject({id:card.id,heat:777,registered_at:card.registered_at});
 expect((await env.DB.prepare('SELECT access,epoch,sync_state FROM managed_work_access WHERE work_id=?').bind(work).first())).toMatchObject({access:'unlisted',epoch:3,sync_state:'complete'});
 const replay=await request(`/v1/me/cards/${card.id}/visibility`,'owner',intent);expect(replay.status).toBe(200);expect(behavior.commands).toBe(1);
 const conflict=await request(`/v1/me/cards/${card.id}/visibility`,'owner',{...intent,targetAccess:'private'});expect(conflict.status).toBe(409);expect(behavior.commands).toBe(1);
});
it('rejects a stale author projection before accepting a durable operation',async()=>{
 const {card,behavior}=await fixture();const intent=await command(card.id);
 const response=await request(`/v1/me/cards/${card.id}/visibility`,'owner',{...intent,expectedApprovalRevision:'stale'.repeat(13)});
 expect(response.status).toBe(409);expect(behavior.commands).toBe(0);
 expect((await env.DB.prepare('SELECT count(*) AS n FROM visibility_operations').first<{n:number}>())?.n).toBe(0);
});
it('does not invalidate an author snapshot because a scheduler changed only its attempt timestamp',async()=>{
 const {card}=await fixture();const intent=await command(card.id);
 await env.DB.prepare('UPDATE managed_work_access SET reconcile_at=?').bind(Date.now()).run();
 expect((await request(`/v1/me/cards/${card.id}/visibility`,'owner',intent)).status).toBe(200);
});
it('does not manufacture a cancellation when there is no pending review',async()=>{
 const {card,behavior}=await fixture();const {targetAccess,...base}=await command(card.id);
 const response=await request(`/v1/me/cards/${card.id}/visibility`,'owner',{...base,action:'cancel_review'});
 expect(response.status).toBe(409);expect(behavior.commands).toBe(0);
});
it('recovers a lost Provider reply through the original operation key without another command',async()=>{
 const {card,behavior}=await fixture();const intent=await command(card.id);behavior.lostReply=true;
 const response=await request(`/v1/me/cards/${card.id}/visibility`,'owner',intent);
 expect(response.status).toBe(202);expect(await response.json()).toMatchObject({operation:{operationId:intent.operationId,state:'pending'}});
 const recovered=await request(`/v1/me/cards/${card.id}/visibility/operations/${intent.operationId}`);
 expect(recovered.status).toBe(200);expect(await recovered.json()).toMatchObject({workVisibility:{access:'unlisted',syncState:'complete'},operation:{operationId:intent.operationId,state:'complete'}});
 expect(behavior.commands).toBe(1);
});

it('keeps the whole operation pending and atomically retries D1 finalization after a confirmed Provider change',async()=>{
 const {card,behavior}=await fixture();const intent=await command(card.id);
 await env.DB.exec("CREATE TRIGGER fixture_author_finalize_failure BEFORE UPDATE OF status ON cards WHEN NEW.status='unshared' BEGIN SELECT RAISE(FAIL,'fixture D1 finalize failure'); END;");
 try{
  const response=await request(`/v1/me/cards/${card.id}/visibility`,'owner',intent);
  expect(response.status).toBe(202);
  expect((await env.DB.prepare('SELECT state FROM author_visibility_operations').first())).toMatchObject({state:'pending'});
  expect((await env.DB.prepare('SELECT state FROM visibility_operations').first())).toMatchObject({state:'complete'});
  expect((await env.DB.prepare('SELECT sync_state,access FROM managed_work_access').first())).toMatchObject({sync_state:'changing',access:'private'});
  expect((await getCard(env.DB,card.id))?.status).toBe('approved');
 }finally{await env.DB.exec('DROP TRIGGER fixture_author_finalize_failure');}
 const response=await request(`/v1/me/cards/${card.id}/visibility/operations/${intent.operationId}`);
 expect(response.status).toBe(200);expect(behavior.commands).toBe(1);
});

it('cancels only pending review while keeping the current public access and approval history',async()=>{
 const {card,source,work,member,current,behavior}=await fixture();current.access='public';
 await env.DB.prepare("UPDATE managed_work_access SET access='public' WHERE work_id=?").bind(work).run();
 const pending=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at,claimed_by,claimed_at) VALUES(?,?,'harbor',?,'update','pending',9,'reviewer-fixture',10)").bind(pending,card.id,source).run();
 const version=crypto.randomUUID(),permit=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,card_id,submission_id,state,created_at) VALUES(?,?,?,?,?,'harbor',?,?,'pending',9)").bind(version,work,member,crypto.randomUUID(),source,card.id,pending).run();
 await env.DB.prepare("INSERT INTO work_publication_permits(version_id,operation_id,epoch,state) VALUES(?,?,2,'prepared')").bind(version,permit).run();
 const {targetAccess,...base}=await command(card.id);const intent={...base,action:'cancel_review'};
 const response=await request(`/v1/me/cards/${card.id}/visibility`,'owner',intent);
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({workVisibility:{access:'public',update:'none',everPublic:true}});
 expect((await env.DB.prepare('SELECT status,claimed_by,claimed_at FROM review_submissions WHERE id=?').bind(pending).first())).toMatchObject({status:'superseded',claimed_by:null,claimed_at:null});
 expect((await getCard(env.DB,card.id))?.status).toBe('approved');expect(behavior.commands).toBe(1);
 expect(await env.DB.prepare('SELECT state FROM hosting_versions WHERE version_id=?').bind(version).first()).toEqual({state:'superseded'});
 expect(await env.DB.prepare('SELECT state FROM work_publication_permits WHERE version_id=?').bind(version).first()).toEqual({state:'cancelled'});
});

it('does not accept an author write with a read-only bearer or implicitly submit a review',async()=>{
 const {card,current,behavior}=await fixture();const intent=await command(card.id,'public');
 expect((await request(`/v1/me/cards/${card.id}/visibility`,'readOnly')).status).toBe(200);
 expect((await request(`/v1/me/cards/${card.id}/visibility`,'readOnly',intent)).status).toBe(403);
 current.restorable=false;current.restoreReason='not_approved';
 const fresh=await command(card.id,'public');const response=await request(`/v1/me/cards/${card.id}/visibility`,'owner',fresh);
 expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:'review_required'});
 expect(behavior.commands).toBe(0);expect((await env.DB.prepare('SELECT count(*) AS n FROM author_visibility_operations').first<{n:number}>())?.n).toBe(0);
 expect((await env.DB.prepare('SELECT count(*) AS n FROM card_registrations').first<{n:number}>())?.n).toBe(0);
});

it('does not let a historical accepted receipt overwrite a newer private policy',async()=>{
 const {card,current,behavior}=await fixture();const intent=await command(card.id);behavior.lostReply=true;
 expect((await request(`/v1/me/cards/${card.id}/visibility`,'owner',intent)).status).toBe(202);
 current.access='private';current.epoch++;current.policyRevision='newer-private-revision';
 const response=await request(`/v1/me/cards/${card.id}/visibility/operations/${intent.operationId}`);
 expect(response.status).toBe(409);expect(behavior.commands).toBe(1);
 expect((await env.DB.prepare('SELECT access FROM managed_work_access').first())).toMatchObject({access:'private'});
 expect(await reconcileWorkAccess({...env,HOSTING_SERVICE_KEY:'fixture-issuer'})).toEqual({complete:1,pending:0});
 expect((await request(`/v1/me/cards/${card.id}/visibility/operations/${intent.operationId}`)).status).toBe(409);
 expect(await(await request(`/v1/me/cards/${card.id}/visibility`)).json()).toMatchObject({workVisibility:{access:'private',syncState:'complete'}});
});

it('recovers accepted author operations in the bounded scheduler without replaying an unaccepted command',async()=>{
 const {card,behavior}=await fixture();const intent=await command(card.id);behavior.unavailable=true;
 expect((await request(`/v1/me/cards/${card.id}/visibility`,'owner',intent)).status).toBe(202);
 await reconcileWorkAccess({...env,HOSTING_SERVICE_KEY:'fixture-issuer'});
 expect(behavior.commands).toBe(0);
 behavior.unavailable=false;behavior.lostReply=true;
 expect((await request(`/v1/me/cards/${card.id}/visibility`,'owner',intent)).status).toBe(202);
 expect((await reconcileWorkAccess({...env,HOSTING_SERVICE_KEY:'fixture-issuer'})).complete).toBe(1);
 expect(behavior.commands).toBe(1);
 expect((await request(`/v1/me/cards/${card.id}/visibility/operations/${intent.operationId}`)).status).toBe(200);
});
it('requires the actual author bearer rather than a local card ownership claim',async()=>{
 const {card,network}=await fixture();
 expect((await request(`/v1/me/cards/${card.id}/visibility`,'reader')).status).toBe(403);
 expect((await request(`/v1/me/cards/${card.id}/visibility`,'')).status).toBe(401);
 expect(network).toHaveBeenCalledTimes(1);
});
it('keeps an unknown full revision distinct from changed and disables restore',async()=>{
 const {card,current}=await fixture();current.revisionState='unknown';current.restorable=false;current.restoreReason='content_unavailable';
 const response=await request(`/v1/me/cards/${card.id}/visibility`);
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({workVisibility:{revisionState:'unknown',restorable:false,draftChanged:false,restoreReason:'revision_unknown'}});
});
it('distinguishes a missing operation on a verified owned source from a missing card',async()=>{
 const {card}=await fixture();
 const response=await request(`/v1/me/cards/${card.id}/visibility/operations/${crypto.randomUUID()}`);
 expect(response.status).toBe(404);expect(await response.json()).toMatchObject({error:'visibility_operation_not_found'});
});
it('does not report a stale D1 epoch as a completed sharing projection',async()=>{
 const {card,current}=await fixture();current.epoch=3;current.access='unlisted';
 const response=await request(`/v1/me/cards/${card.id}/visibility`);
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({workVisibility:{syncState:'changing',restorable:false,actions:[],effectiveAccess:'unavailable'}});
});

it('does not restore from a D1 approval pointer that differs from current Provider approval',async()=>{
 const {card,current}=await fixture();current.approvedRoleId=crypto.randomUUID();
 const response=await request(`/v1/me/cards/${card.id}/visibility`);
 expect(await response.json()).toMatchObject({workVisibility:{syncState:'changing',restorable:false,actions:[]}});
});

it('refreshes a complete projection after a source save advances only the Provider epoch',async()=>{
 const {work,card,current,behavior}=await fixture();current.epoch++;
 const result=await reconcileWorkAccess({...env,HOSTING_SERVICE_KEY:'fixture-issuer'});
 expect(result).toEqual({complete:1,pending:0});expect(behavior.commands).toBe(0);
 expect(await env.DB.prepare('SELECT epoch,sync_state FROM managed_work_access WHERE work_id=?').bind(work).first()).toEqual({epoch:3,sync_state:'complete'});
 expect(await(await request(`/v1/me/cards/${card.id}/visibility`)).json()).toMatchObject({workVisibility:{syncState:'complete',restorable:true}});
});

it.each(['private','unlisted','public'] as const)('naturally reads back saved %s content without waiting for maintenance',async access=>{
 const {work,card,current,behavior}=await fixture();current.access=access;
 await env.DB.prepare('UPDATE managed_work_access SET access=? WHERE work_id=?').bind(access,work).run();
 current.epoch+=3;current.revisionState='changed';current.restorable=false;current.restoreReason='content_changed';
 const response=await request(`/v1/me/cards/${card.id}/visibility`);
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({workVisibility:{access,syncState:'complete',actions:expect.arrayContaining(['set_private','set_unlisted',access==='public'?'submit_update':'submit_review'])}});
 expect(await env.DB.prepare('SELECT access,epoch,sync_state FROM managed_work_access WHERE work_id=?').bind(work).first()).toEqual({access,epoch:5,sync_state:'complete'});
 expect(behavior.commands).toBe(0);
});

it('does not retire a changing operation fence during an author read after saving',async()=>{
 const {work,card,current,behavior}=await fixture();current.epoch++;
 await env.DB.prepare("UPDATE managed_work_access SET sync_state='changing',sync_operation_id='original-operation' WHERE work_id=?").bind(work).run();
 expect(await(await request(`/v1/me/cards/${card.id}/visibility`)).json()).toMatchObject({workVisibility:{syncState:'changing',actions:[]}});
 expect(await env.DB.prepare('SELECT epoch,sync_state,sync_operation_id FROM managed_work_access WHERE work_id=?').bind(work).first()).toEqual({epoch:2,sync_state:'changing',sync_operation_id:'original-operation'});
 expect(behavior.commands).toBe(0);
});

it.each(['approval','moderation','offline','racing_command'])('keeps saved-content author readback fenced for %s',async mode=>{
 const {work,card,current,network,behavior}=await fixture();current.epoch++;
 if(mode==='approval')current.approvedRoleId=crypto.randomUUID();
 if(mode==='moderation')await env.DB.prepare('UPDATE managed_work_access SET moderation_revision=moderation_revision+1 WHERE work_id=?').bind(work).run();
 const original=network.getMockImplementation()!;
 network.mockImplementation(async(input,init)=>{
  if(String(input).endsWith('/work-access/batch')){
   if(mode==='offline')throw new Error('Synthetic issuer offline');
   if(mode==='racing_command')await env.DB.prepare("UPDATE managed_work_access SET sync_state='changing',sync_operation_id='original-key' WHERE work_id=?").bind(work).run();
  }
  return original(input,init);
 });
 expect(await(await request(`/v1/me/cards/${card.id}/visibility`)).json()).toMatchObject({workVisibility:{syncState:'changing',actions:[]}});
 expect(await env.DB.prepare('SELECT epoch FROM managed_work_access WHERE work_id=?').bind(work).first()).toEqual({epoch:2});
 expect(behavior.commands).toBe(0);
});

it('invalidates the old pending snapshot after saving without canceling it by a new Provider command',async()=>{
 const {card,current,behavior}=await fixture();
 await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at) VALUES(?,?,'harbor',?,'re','pending',99)").bind(crypto.randomUUID(),card.id,current.sourceRoleId).run();
 current.epoch++;current.revisionState='changed';current.restorable=false;current.restoreReason='content_changed';
 expect(await(await request(`/v1/me/cards/${card.id}/visibility`)).json()).toMatchObject({workVisibility:{syncState:'complete',review:'none',actions:expect.arrayContaining(['submit_review'])}});
 expect(await env.DB.prepare("SELECT count(*) AS n FROM review_submissions WHERE status='pending'").first()).toEqual({n:0});
 expect(await env.DB.prepare("SELECT count(*) AS n FROM review_submissions WHERE status='approved'").first()).toEqual({n:1});
 expect(behavior.commands).toBe(0);
});

it.each(['private','unlisted','public'] as const)('refreshes current %s without changing stable community identity or sending a command',async access=>{
 const {card,current,behavior}=await fixture();
 const before=await env.DB.prepare('SELECT id,registered_at,talk_num,approved_hosted_role_id FROM cards WHERE id=?').bind(card.id).first();
 current.epoch++;current.access=access;
 expect(await reconcileWorkAccess({...env,HOSTING_SERVICE_KEY:'fixture-issuer'})).toEqual({complete:1,pending:0});
 expect(await env.DB.prepare('SELECT id,registered_at,talk_num,approved_hosted_role_id FROM cards WHERE id=?').bind(card.id).first()).toEqual(before);
 expect(behavior.commands).toBe(0);
});

it('keeps a newer local fence when a command starts during the current-policy batch',async()=>{
 const {work,network}=await fixture();const original=network.getMockImplementation()!;
 network.mockImplementation(async(input,init)=>{
  if(String(input).endsWith('/work-access/batch'))await env.DB.prepare("UPDATE managed_work_access SET sync_state='changing',sync_operation_id='new-local-command' WHERE work_id=?").bind(work).run();
  return original(input,init);
 });
 expect(await reconcileWorkAccess({...env,HOSTING_SERVICE_KEY:'fixture-issuer'})).toEqual({complete:0,pending:1});
 expect(await env.DB.prepare('SELECT sync_state,sync_operation_id FROM managed_work_access WHERE work_id=?').bind(work).first()).toEqual({sync_state:'changing',sync_operation_id:'new-local-command'});
});

it.each(['approval','restriction','same_epoch','offline'])('does not relax or fabricate completion for unsafe refresh %s',async mode=>{
 const {work,current,network}=await fixture();
 if(mode==='approval'){current.epoch++;current.approvedRoleId=crypto.randomUUID();}
 if(mode==='restriction')await env.DB.prepare("UPDATE managed_work_access SET restriction='suspended' WHERE work_id=?").bind(work).run();
 if(mode==='same_epoch')current.access='unlisted';
 if(mode==='offline')network.mockRejectedValue(new Error('Fixture unavailable'));
 const before=await env.DB.prepare('SELECT access,epoch,restriction,sync_state FROM managed_work_access WHERE work_id=?').bind(work).first();
 expect(await reconcileWorkAccess({...env,HOSTING_SERVICE_KEY:'fixture-issuer'})).toEqual({complete:0,pending:1});
 expect(await env.DB.prepare('SELECT access,epoch,restriction,sync_state FROM managed_work_access WHERE work_id=?').bind(work).first()).toEqual(before);
});

async function submissionBody(cardId:string,source:string){
 const view=await(await request(`/v1/me/cards/${cardId}/visibility`)).json() as {workVisibility:{policyRevision:string;approvalRevision:string}};
 return {roleId:source,operationId:crypto.randomUUID(),...ratingBody(false),expectedPolicyRevision:view.workVisibility.policyRevision,expectedApprovalRevision:view.workVisibility.approvalRevision};
}
it('rejects stale submission consent before sealing, quota or review writes',async()=>{
 const {card,source}=await fixture();vi.spyOn(hostGateway,'read').mockImplementation(async(_e,_t,id)=>role({roleId:id,authorNumId:11}));
 const body=await submissionBody(card.id,source);body.expectedPolicyRevision='stale-opaque-revision';
 const response=await request('/v1/cards','owner',body);expect(response.status).toBe(409);
 for(const table of ['hosting_versions','card_registrations'])expect(await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).toEqual({n:0});
});
it('prepares a managed submission against the exact author consent without changing private access',async()=>{
 const {card,source,current}=await fixture();current.restorable=false;current.revisionState='changed';current.restoreReason='content_changed';vi.spyOn(hostGateway,'read').mockImplementation(async(_e,_t,id)=>role({roleId:id,authorNumId:11}));
 const body=await submissionBody(card.id,source);const response=await request('/v1/cards','owner',body);expect(response.status,await response.clone().text()).toBe(200);
 expect(current.access).toBe('private');
 expect(await env.DB.prepare('SELECT state FROM work_publication_permits').first()).toEqual({state:'prepared'});
 const changed={...body,expectedPolicyRevision:'different-opaque-revision'};expect((await request('/v1/cards','owner',changed)).status).toBe(409);
});
it('enrolls the first consented public application as private until an actual review approves it',async()=>{
 const {source,current}=await fixture(true);const body=await submissionBody(source,source);
 const response=await request('/v1/cards','owner',body);expect(response.status,await response.clone().text()).toBe(201);expect(current.access).toBe('private');
 expect(await env.DB.prepare('SELECT access,sync_state FROM managed_work_access').first()).toEqual({access:'private',sync_state:'complete'});
 expect(await env.DB.prepare('SELECT state FROM work_publication_permits').first()).toEqual({state:'prepared'});
 expect(await env.DB.prepare('SELECT status FROM review_submissions').first()).toEqual({status:'pending'});
});

it('resumes the original consent after a lost seal reply without rebinding or acquiring a later CAS',async()=>{
 const {source,behavior}=await fixture(true);const body=await submissionBody(source,source),seal=hostGateway.seal.bind(hostGateway);
 const spy=vi.spyOn(hostGateway,'seal').mockImplementationOnce(async(...args)=>{await seal(...args);throw new Error('Fixture seal reply lost');}).mockImplementation(seal);
 expect((await request('/v1/cards','owner',body)).status).toBe(503);
 const readback=await request(`/v1/me/cards/${source}/publication/operations/${body.operationId}`);
 expect(readback.status).toBe(200);expect(await readback.json()).toMatchObject({operation:{operationId:body.operationId,state:'pending'}});
 expect(await env.DB.prepare('SELECT count(*) AS n FROM card_registrations').first()).toEqual({n:0});
 const response=await request('/v1/cards','owner',body);expect(response.status,await response.clone().text()).toBe(201);expect(behavior.commands).toBe(2);
 expect(spy.mock.calls[0][4]).toBe(spy.mock.calls[1][4]);
 expect(await env.DB.prepare('SELECT count(*) AS n FROM hosting_versions').first()).toEqual({n:1});
 expect(await env.DB.prepare('SELECT count(*) AS n FROM card_registrations').first()).toEqual({n:1});
 expect(await(await request(`/v1/me/cards/${source}/publication/operations/${body.operationId}`)).json()).toMatchObject({operation:{state:'complete'},card:{status:'pending'}});
});
it('rejects a changed source between consent and prepare without auto-rebasing or using quota',async()=>{
 const {source,card,current}=await fixture();current.restorable=false;current.revisionState='changed';current.restoreReason='content_changed';
 vi.spyOn(hostGateway,'read').mockImplementation(async(_e,_t,id)=>role({roleId:id,authorNumId:11}));
 const body=await submissionBody(card.id,source),seal=hostGateway.seal.bind(hostGateway);
 vi.spyOn(hostGateway,'seal').mockImplementation(async(...args)=>{const receipt=await seal(...args);current.epoch++;current.policyRevision='newer-source-revision';return receipt;});
 expect((await request('/v1/cards','owner',body)).status).toBe(409);
 expect(await env.DB.prepare('SELECT count(*) AS n FROM card_registrations').first()).toEqual({n:0});
 expect(await env.DB.prepare("SELECT count(*) AS n FROM review_submissions WHERE status='pending'").first()).toEqual({n:0});
 expect(await(await request(`/v1/me/cards/${source}/publication/operations/${body.operationId}`)).json()).toMatchObject({operation:{state:'conflict'}});
});
it('distinguishes an unaccepted publication operation after checking the actual read owner',async()=>{
 const {source,card}=await fixture();
 const response=await request(`/v1/me/cards/${source}/publication/operations/${crypto.randomUUID()}`);
 expect(response.status).toBe(404);expect(await response.json()).toMatchObject({error:'publication_operation_not_found',workVisibility:{access:'private'}});
 expect((await request(`/v1/me/cards/${card.id}/publication/operations/${crypto.randomUUID()}`,'reader')).status).toBe(403);
});


it.each(['direct','crash-gap'])('resolves a definitive Provider CAS conflict without permanent pending after %s',async mode=>{
 const {card,source,current,network}=await fixture();const intent=await command(card.id);
 const prior=network.getMockImplementation()!;let switched=false;
 network.mockImplementation(async(input,init)=>{
  if(!switched&&init?.method==='POST'&&new URL(String(input)).pathname===`/open/v1/hosting/work-access/${source}`){switched=true;current.epoch++;current.policyRevision='concurrent-save-policy-revision';}
  return prior(input,init);
 });
 const response=await request(`/v1/me/cards/${card.id}/visibility`,'owner',intent);
 expect(response.status).toBe(409);
 const before=await env.DB.prepare('SELECT state FROM author_visibility_operations').first();
 const providerOp=await env.DB.prepare('SELECT state FROM visibility_operations').first();
 const syncBefore=await env.DB.prepare('SELECT epoch,sync_state FROM managed_work_access').first();
 if(mode==='crash-gap')await env.DB.prepare("UPDATE author_visibility_operations SET state='pending'").run();
 const readback=await request(`/v1/me/cards/${card.id}/visibility/operations/${intent.operationId}`);
 const reconcile=await reconcileWorkAccess({...env,HOSTING_SERVICE_KEY:'fixture-issuer'});
 const after=await env.DB.prepare('SELECT state FROM author_visibility_operations').first();
 const syncAfter=await env.DB.prepare('SELECT epoch,sync_state FROM managed_work_access').first();
 expect(before).toMatchObject({state:'conflict'});expect(providerOp).toMatchObject({state:'conflict'});
 expect(readback.status).toBe(409);expect(await readback.json()).toMatchObject({operation:{state:'conflict'}});
 expect(reconcile).toMatchObject({complete:1,pending:0});
 expect(after).toMatchObject({state:'conflict'});
 expect(syncAfter).toMatchObject({epoch:current.epoch,sync_state:'complete'});
});


it('recovers a definitively refused first bind without inventing a managed policy',async()=>{
 const {source,current,network}=await fixture(true);const intent=await command(source);
 const prior=network.getMockImplementation()!;let switched=false;
 network.mockImplementation(async(input,init)=>{
  if(!switched&&init?.method==='POST'&&new URL(String(input)).pathname===`/open/v1/hosting/work-access/${source}`){switched=true;current.policyRevision='concurrent-unmanaged-save-revision';}
  return prior(input,init);
 });
 const response=await request(`/v1/me/cards/${source}/visibility`,'owner',intent);
 expect(response.status).toBe(409);
 const op=await env.DB.prepare('SELECT state FROM author_visibility_operations').first();
 const low=await env.DB.prepare('SELECT state FROM visibility_operations').first();
 const before=await env.DB.prepare('SELECT epoch,sync_state FROM managed_work_access').first();
 const readback=await request(`/v1/me/cards/${source}/visibility/operations/${intent.operationId}`);
 const reconcile=await reconcileWorkAccess({...env,HOSTING_SERVICE_KEY:'fixture-issuer'});
 const after=await env.DB.prepare('SELECT epoch,sync_state FROM managed_work_access').first();
 const latest=await request(`/v1/me/cards/${source}/visibility`);
 expect(op).toMatchObject({state:'conflict'});expect(low).toMatchObject({state:'conflict'});expect(before).toMatchObject({epoch:0,sync_state:'changing'});expect(readback.status).toBe(409);expect(reconcile).toEqual({complete:1,pending:0});
 expect(after).toBeNull();expect(latest.status).toBe(200);
 const identity=await getCard(env.DB,source);
 expect(await env.DB.prepare('SELECT count(*) AS n FROM author_visibility_operations').first()).toEqual({n:1});
 const fresh=await command(source);expect(fresh.operationId).not.toBe(intent.operationId);
 expect((await request(`/v1/me/cards/${source}/visibility`,'owner',fresh)).status).toBe(200);
 expect((await getCard(env.DB,source))?.id).toBe(identity?.id);
 expect(await env.DB.prepare('SELECT count(*) AS n FROM review_submissions').first()).toEqual({n:0});
 expect(await env.DB.prepare('SELECT count(*) AS n FROM card_registrations').first()).toEqual({n:0});

});

it.each(['offline','receipt','managed','moderation','new_fence','other_intent','low_pending'])('retains a refused first-bind fence when cleanup proof is %s',async mode=>{
 const {source,current,network}=await fixture(true);const intent=await command(source);
 const prior=network.getMockImplementation()!;let switched=false;
 network.mockImplementation(async(input,init)=>{
  if(!switched&&init?.method==='POST'&&new URL(String(input)).pathname===`/open/v1/hosting/work-access/${source}`){switched=true;current.policyRevision='concurrent-unmanaged-save-revision';}
  return prior(input,init);
 });
 expect((await request(`/v1/me/cards/${source}/visibility`,'owner',intent)).status).toBe(409);
 const op=(await env.DB.prepare('SELECT * FROM author_visibility_operations').first<{work_id:string;provider_operation_id:string}>())!;
 if(mode==='managed'){current.managed=true;current.workId=op.work_id;current.epoch=1;}
 if(mode==='low_pending')await env.DB.prepare("UPDATE visibility_operations SET state='pending'").run();
 const postConflict=network.getMockImplementation()!;
 network.mockImplementation(async(input,init)=>{
  if(mode==='offline')throw new Error('Fixture Provider offline');
  const path=new URL(String(input)).pathname;
  if(mode==='receipt'&&path.endsWith('/operations/'+op.provider_operation_id))return Response.json({...current,workId:op.work_id,operationId:op.provider_operation_id,epoch:1,state:'complete'});
  if(path.endsWith('/work-access/batch')){
   if(mode==='moderation')await env.DB.prepare('UPDATE managed_work_access SET moderation_revision=moderation_revision+1').run();
   if(mode==='new_fence')await env.DB.prepare('UPDATE managed_work_access SET sync_operation_id=?').bind(crypto.randomUUID()).run();
   if(mode==='other_intent')await env.DB.prepare("INSERT INTO visibility_operations(work_id,operation_id,root_operation_id,command,intent_hash,state,updated_at) VALUES(?,?,?,'{\"action\":\"bind\",\"expectedEpoch\":0}','new-intent','pending',1)").bind(op.work_id,crypto.randomUUID(),crypto.randomUUID()).run();
  }
  return postConflict(input,init);
 });
 await reconcileWorkAccess({...env,HOSTING_SERVICE_KEY:'fixture-issuer'});
 expect(await env.DB.prepare('SELECT epoch,sync_state FROM managed_work_access').first()).toEqual({epoch:0,sync_state:'changing'});
 expect(await env.DB.prepare('SELECT state FROM author_visibility_operations').first()).toEqual({state:'conflict'});
});
