import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {resetDb,makeMember,role,GENERAL_RATING} from './helpers';
import {submitHosted,beginHostedEdit} from '../src/hosting';
import {claim,stamp} from '../src/review';
import {unregister} from '../src/cards';
import {opsMetrics} from '../src/ops-metrics';
import {reconcileWorkAccess} from '../src/work-reconcile';
import {fenceManagedWork} from '../src/work-fence';
import {upstream} from '../src/upstream';
import {type WorkPolicyReceipt,enrollWorkAccess,workPolicyGateway,runWorkPolicyOperation} from '../src/work-policy';

beforeEach(resetDb);afterEach(()=>vi.restoreAllMocks());
it('withdraws a managed work only after confirmed privacy, preserving the community identity',async()=>{
 const memberId=await makeMember(10004);const draft=role({roleId:'managed-withdraw',authorNumId:10004});
 vi.spyOn(upstream,'fetchRole').mockResolvedValue(draft);
 const submitted=await submitHosted(env,{memberId,account:10004,role:draft,token:'fixture',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()});
 const before=await env.DB.prepare('SELECT id,talk_num,registered_at FROM cards WHERE source_role_id=?').bind(draft.roleId).first();
 vi.spyOn(workPolicyGateway,'change').mockImplementation(async(_e,_p,source,c)=>{
  if(c.action==='private')throw new Error('unknown reply');
  return {sourceRoleId:source,workId:c.workId,operationId:c.operationId,access:'unlisted',restriction:'none',epoch:1,state:'complete',replayed:false};
 });
 await enrollWorkAccess(env,{memberId,roleId:draft.roleId,operationId:crypto.randomUUID(),access:'unlisted',token:'fixture'});
 vi.spyOn(workPolicyGateway,'state').mockRejectedValue(new Error('state endpoint offline'));
 const readback=vi.spyOn(workPolicyGateway,'operation').mockResolvedValue(null);
 await expect(unregister(env.DB,draft.roleId,10004,'harbor',env,'fixture')).rejects.toThrow('visibility_sync_pending');
 expect(await env.DB.prepare('SELECT id,talk_num,registered_at FROM cards WHERE source_role_id=?').bind(draft.roleId).first()).toEqual(before);
 expect(await reconcileWorkAccess(env)).toEqual({complete:0,pending:1});
 expect(workPolicyGateway.change).toHaveBeenCalledTimes(2);
 readback.mockImplementation(async(_e,_p,source,work,op)=>({sourceRoleId:source,workId:work,operationId:op,access:'private',restriction:'none',epoch:2,state:'complete',replayed:false}));
 expect(await reconcileWorkAccess(env)).toEqual({complete:1,pending:0});
 expect(await env.DB.prepare('SELECT id,talk_num,registered_at FROM cards WHERE source_role_id=?').bind(draft.roleId).first()).toEqual(before);
 expect(await env.DB.prepare('SELECT access,sync_state FROM managed_work_access WHERE work_id=?').bind(submitted.workId).first()).toEqual({access:'private',sync_state:'complete'});
});
it('persists an enrollment intent before contacting Provider, then reuses durable readback after an unknown result',async()=>{
 const memberId=await makeMember(10001);const draft=role({roleId:'managed-draft',authorNumId:10001});
 vi.spyOn(upstream,'fetchRole').mockResolvedValue(draft);
 await submitHosted(env,{memberId,account:10001,role:draft,token:'fixture',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()});
 const work=(await env.DB.prepare('SELECT id FROM works WHERE source_role_id=?').bind(draft.roleId).first<{id:string}>())!;
 const operationId=crypto.randomUUID();
 const receipt={sourceRoleId:draft.roleId,workId:work.id,operationId,access:'private' as const,restriction:'none' as const,epoch:1,state:'complete' as const,replayed:false};
 const change=vi.spyOn(workPolicyGateway,'change').mockImplementation(async()=>{
  expect(await env.DB.prepare('SELECT 1 FROM visibility_operations WHERE work_id=? AND operation_id=?').bind(work.id,operationId).first()).not.toBeNull();
  throw new Error('reply lost');
 });
 vi.spyOn(workPolicyGateway,'operation').mockResolvedValue(receipt);
 await expect(enrollWorkAccess(env,{memberId,roleId:draft.roleId,operationId,access:'private',token:'fixture'})).rejects.toThrow('visibility_sync_pending');
 expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_operations_total{operation="bind",outcome="pending"} 1');
 expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_pending_operations 1');
 expect(await env.DB.prepare('SELECT epoch,sync_state FROM managed_work_access WHERE work_id=?').bind(work.id).first()).toEqual({epoch:0,sync_state:'changing'});
 expect(await reconcileWorkAccess(env)).toEqual({complete:1,pending:0});
 expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_pending_operations 0');
 expect(change).toHaveBeenCalledTimes(1);
 expect(await env.DB.prepare('SELECT access,epoch FROM managed_work_access WHERE work_id=?').bind(work.id).first()).toEqual({access:'private',epoch:1});
 await expect(enrollWorkAccess(env,{memberId,roleId:draft.roleId,operationId,access:'unlisted',token:'fixture'})).rejects.toThrow('visibility_operation_conflict');
 const stored=await env.DB.prepare('SELECT command FROM visibility_operations WHERE work_id=?').bind(work.id).first<{command:string}>();expect(stored?.command).not.toContain('fixture');
});

it.each(['current','superseded'])('does not publish or award a managed review until Provider commit is durably confirmed and %s',async mode=>{
 const memberId=await makeMember(10002);const draft=role({roleId:'managed-review',authorNumId:10002});
 vi.spyOn(upstream,'fetchRole').mockResolvedValue(draft);
 const submit=()=>submitHosted(env,{memberId,account:10002,role:draft,token:'fixture',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()});
 const initial=await submit();await beginHostedEdit(env.DB,memberId,draft.roleId,Date.now());
 const change=vi.spyOn(workPolicyGateway,'change').mockImplementation(async(_env,_provider,source,command)=>({sourceRoleId:source,workId:command.workId,operationId:command.operationId,access:'private',restriction:'none',epoch:1,state:command.action==='prepare'?'prepared':'complete',replayed:false}));
 await enrollWorkAccess(env,{memberId,roleId:draft.roleId,operationId:crypto.randomUUID(),access:'private',token:'fixture'});
 vi.spyOn(workPolicyGateway,'state').mockResolvedValue({sourceRoleId:draft.roleId,workId:initial.workId,operationId:'',access:'private',restriction:'none',epoch:1,state:'complete',replayed:false});
 const submitted=await submit();
 const permit=await env.DB.prepare('SELECT operation_id FROM work_publication_permits WHERE version_id=?').bind(submitted.versionId).first<{operation_id:string}>();expect(permit).not.toBeNull();
 const sub=(await env.DB.prepare('SELECT submission_id FROM hosting_versions WHERE version_id=?').bind(submitted.versionId).first<{submission_id:string}>())!;
 await claim(env.DB,sub.submission_id,'reviewer',Date.now());
 vi.spyOn(workPolicyGateway,'operation').mockResolvedValue({sourceRoleId:draft.roleId,workId:submitted.workId,operationId:permit!.operation_id,access:'private',restriction:'none',epoch:1,state:'prepared',replayed:false});
 const commit=vi.spyOn(workPolicyGateway,'commit').mockRejectedValue(new Error('reply lost'));
 await expect(stamp(env.DB,{submissionId:sub.submission_id,memberId:'reviewer',verdict:'approve',note:'',now:Date.now()},env)).rejects.toThrow('visibility_sync_pending');
 expect((await env.DB.prepare('SELECT status,approved_version_id FROM cards WHERE source_role_id=?').bind(draft.roleId).first())).toEqual({status:'pending',approved_version_id:null});
 expect(await env.DB.prepare("SELECT 1 FROM community_awards WHERE badge='first_work' AND member_id=?").bind(memberId).first()).toBeNull();
 commit.mockResolvedValue({sourceRoleId:draft.roleId,workId:submitted.workId,operationId:permit!.operation_id,access:'public',restriction:'none',epoch:2,state:'complete',replayed:false});
 vi.mocked(workPolicyGateway.state).mockResolvedValue({sourceRoleId:draft.roleId,workId:submitted.workId,operationId:'',access:mode==='current'?'public':'private',restriction:'none',epoch:mode==='current'?2:3,state:'complete',replayed:false});
 if(mode==='superseded'){
  await expect(stamp(env.DB,{submissionId:sub.submission_id,memberId:'reviewer',verdict:'approve',note:'',now:Date.now()},env)).rejects.toThrow('visibility_operation_conflict');
  expect(await env.DB.prepare("SELECT 1 FROM community_awards WHERE badge='first_work' AND member_id=?").bind(memberId).first()).toBeNull();
  return;
 }
 const result=await stamp(env.DB,{submissionId:sub.submission_id,memberId:'reviewer',verdict:'approve',note:'',now:Date.now()},env);
 expect(result.submission.status).toBe('approved');expect(result.cardStatus).toBe('approved');
 expect(change.mock.calls.some(c=>c[3].action==='prepare')).toBe(true);
 // A private work may submit an update; rejecting it retains the old approved
 // identity without changing its access or attempting a fresh publication.
 await env.DB.prepare("UPDATE managed_work_access SET access='private',epoch=3 WHERE work_id=?").bind(submitted.workId).run();
 await env.DB.prepare("UPDATE cards SET status='unshared' WHERE source_role_id=?").bind(draft.roleId).run();
 const update=await submit();const next=(await env.DB.prepare('SELECT submission_id FROM hosting_versions WHERE version_id=?').bind(update.versionId).first<{submission_id:string}>())!;
 await claim(env.DB,next.submission_id,'reviewer-2',Date.now());
 const rejected=await stamp(env.DB,{submissionId:next.submission_id,memberId:'reviewer-2',verdict:'reject',note:'fixture rejection',now:Date.now()},env);
 expect(rejected.submission.status).toBe('rejected');expect(rejected.cardStatus).toBe('unshared');

});

it.each(['edit','withdraw'])('keeps %s cancellation pending until PG readback and prevents an old reviewer from publishing',async action=>{
 const memberId=await makeMember(10003);const draft=role({roleId:'managed-cancel',authorNumId:10003});vi.spyOn(upstream,'fetchRole').mockResolvedValue(draft);
 const submit=()=>submitHosted(env,{memberId,account:10003,role:draft,token:'fixture',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()});
 const initial=await submit();await beginHostedEdit(env.DB,memberId,draft.roleId,Date.now());
 const receipts=new Map<string,WorkPolicyReceipt>();let epoch=1;let loseCancel=true;
 const change=vi.spyOn(workPolicyGateway,'change').mockImplementation(async(_env,_provider,source,command)=>{
  if(command.action==='cancel'||command.action==='private')epoch++;
  const receipt:WorkPolicyReceipt={sourceRoleId:source,workId:command.workId,operationId:command.operationId,access:'private',restriction:'none',epoch,state:command.action==='prepare'?'prepared':'complete',replayed:false};
  receipts.set(command.operationId,receipt);
  if((command.action==='cancel'||command.action==='private')&&loseCancel){loseCancel=false;throw new Error('reply lost after PG commit')}
  return receipt;
 });
 vi.spyOn(workPolicyGateway,'operation').mockImplementation(async(_env,_provider,_source,_work,op)=>receipts.get(op)??null);
 vi.spyOn(workPolicyGateway,'state').mockImplementation(async()=>({sourceRoleId:draft.roleId,workId:initial.workId,operationId:'',access:'private',restriction:'none',epoch,state:'complete',replayed:false}));
 await enrollWorkAccess(env,{memberId,roleId:draft.roleId,operationId:crypto.randomUUID(),access:'private',token:'fixture'});
 const submitted=await submit();const sub=(await env.DB.prepare('SELECT submission_id FROM hosting_versions WHERE version_id=?').bind(submitted.versionId).first<{submission_id:string}>())!;
 await claim(env.DB,sub.submission_id,'old-reviewer',Date.now());
 const commit=vi.spyOn(workPolicyGateway,'commit');
 const cancel=()=>action==='edit'?beginHostedEdit(env.DB,memberId,draft.roleId,Date.now(),'harbor',env):unregister(env.DB,draft.roleId,10003,'harbor',env,'fixture');
 await expect(cancel()).rejects.toThrow('visibility_sync_pending');
 await expect(stamp(env.DB,{submissionId:sub.submission_id,memberId:'old-reviewer',verdict:'approve',note:'',now:Date.now()},env)).rejects.toThrow('visibility_operation_conflict');
 expect(commit).not.toHaveBeenCalled();
 await cancel();
 expect(change.mock.calls.filter(c=>c[3].action===(action==='edit'?'cancel':'private'))).toHaveLength(1);
 expect(await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(sub.submission_id).first()).toEqual({status:'superseded'});
 await expect(stamp(env.DB,{submissionId:sub.submission_id,memberId:'old-reviewer',verdict:'approve',note:'',now:Date.now()},env)).rejects.toThrow('visibility_operation_conflict');
});

it('fences a delayed moderation intent against a newer dismissal even when projected restriction already matches',async()=>{
 const memberId=await makeMember(10005);const draft=role({roleId:'managed-moderation-aba',authorNumId:10005});vi.spyOn(upstream,'fetchRole').mockResolvedValue(draft);
 await submitHosted(env,{memberId,account:10005,role:draft,token:'fixture',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()});
 const change=vi.spyOn(workPolicyGateway,'change').mockImplementation(async(_e,_p,source,c)=>({sourceRoleId:source,workId:c.workId,operationId:c.operationId,access:'private',restriction:c.restriction??'none',epoch:c.action==='bind'?1:2,state:'complete',replayed:false}));
 await enrollWorkAccess(env,{memberId,roleId:draft.roleId,operationId:crypto.randomUUID(),access:'private',token:'fixture'});
 await env.DB.prepare('INSERT INTO moderation_state(provider,source_role_id) VALUES(?,?)').bind('harbor',draft.roleId).run();
 await env.DB.prepare('UPDATE moderation_state SET public_blocked=1 WHERE source_role_id=?').bind(draft.roleId).run();
 await env.DB.prepare('UPDATE moderation_state SET public_blocked=0 WHERE source_role_id=?').bind(draft.roleId).run();
 vi.spyOn(workPolicyGateway,'state').mockResolvedValue({sourceRoleId:draft.roleId,workId:change.mock.calls[0][3].workId,operationId:'',access:'private',restriction:'none',epoch:1,state:'complete',replayed:false});
 await expect(fenceManagedWork(env,'harbor',draft.roleId,'old-suspend','restrict',{restriction:'suspended',moderationRevision:0})).rejects.toThrow('visibility_operation_conflict');
 expect(change).toHaveBeenCalledTimes(1);
 expect(await reconcileWorkAccess(env)).toEqual({complete:1,pending:0});
 expect(change.mock.calls[1][3].restriction).toBe('none');
});

it('recovers dirty moderation before an author command whose Provider result is absent',async()=>{
 const memberId=await makeMember(10006);const draft=role({roleId:'managed-priority',authorNumId:10006});vi.spyOn(upstream,'fetchRole').mockResolvedValue(draft);
 await submitHosted(env,{memberId,account:10006,role:draft,token:'fixture',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()});
 const change=vi.spyOn(workPolicyGateway,'change').mockImplementation(async(_e,_p,source,c)=>{
  if(c.action==='private')throw new Error('request never reached PG');
  return {sourceRoleId:source,workId:c.workId,operationId:c.operationId,access:'unlisted',restriction:c.restriction??'none',epoch:c.action==='bind'?1:2,state:'complete',replayed:false};
 });
 vi.spyOn(workPolicyGateway,'operation').mockResolvedValue(null);
 await enrollWorkAccess(env,{memberId,roleId:draft.roleId,operationId:crypto.randomUUID(),access:'unlisted',token:'fixture'});
 await expect(unregister(env.DB,draft.roleId,10006,'harbor',env,'fixture')).rejects.toThrow('visibility_sync_pending');
 // The moderation transaction committed, then its HTTP handler crashed before syncCase.
 await env.DB.prepare('INSERT INTO moderation_state(provider,source_role_id) VALUES(?,?)').bind('harbor',draft.roleId).run();
 await env.DB.prepare('UPDATE moderation_state SET public_blocked=1 WHERE source_role_id=?').bind(draft.roleId).run();
 expect(await reconcileWorkAccess(env)).toEqual({complete:1,pending:0});
 expect(change.mock.calls.at(-1)?.[3]).toMatchObject({action:'restrict',restriction:'suspended'});
 expect(await env.DB.prepare('SELECT restriction,moderation_revision,confirmed_moderation_revision FROM managed_work_access WHERE source_role_id=?').bind(draft.roleId).first()).toEqual({restriction:'suspended',moderation_revision:1,confirmed_moderation_revision:1});
});
