import {env} from 'cloudflare:test';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {resetDb,makeMember,role,GENERAL_RATING} from './helpers';
import {submitHosted,beginHostedEdit} from '../src/hosting';
import {claim,stamp} from '../src/review';
import {unregister} from '../src/cards';
import {opsMetrics} from '../src/ops-metrics';
import {reconcileWorkAccess} from '../src/work-reconcile';
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
 vi.spyOn(workPolicyGateway,'state').mockResolvedValue({sourceRoleId:draft.roleId,workId:submitted.workId,operationId:'',access:'unlisted',restriction:'none',epoch:1,state:'complete',replayed:false});
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

it('does not publish or award a managed review until Provider commit is durably confirmed',async()=>{
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
 const result=await stamp(env.DB,{submissionId:sub.submission_id,memberId:'reviewer',verdict:'approve',note:'',now:Date.now()},env);
 expect(result.submission.status).toBe('approved');expect(result.cardStatus).toBe('approved');
 expect(change.mock.calls.some(c=>c[3].action==='prepare')).toBe(true);
});

it('keeps edit cancellation pending until PG readback and prevents an old reviewer from publishing',async()=>{
 const memberId=await makeMember(10003);const draft=role({roleId:'managed-cancel',authorNumId:10003});vi.spyOn(upstream,'fetchRole').mockResolvedValue(draft);
 const submit=()=>submitHosted(env,{memberId,account:10003,role:draft,token:'fixture',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()});
 const initial=await submit();await beginHostedEdit(env.DB,memberId,draft.roleId,Date.now());
 const receipts=new Map<string,WorkPolicyReceipt>();let epoch=1;let loseCancel=true;
 const change=vi.spyOn(workPolicyGateway,'change').mockImplementation(async(_env,_provider,source,command)=>{
  if(command.action==='cancel')epoch++;
  const receipt:WorkPolicyReceipt={sourceRoleId:source,workId:command.workId,operationId:command.operationId,access:'private',restriction:'none',epoch,state:command.action==='prepare'?'prepared':'complete',replayed:false};
  receipts.set(command.operationId,receipt);
  if(command.action==='cancel'&&loseCancel){loseCancel=false;throw new Error('reply lost after PG commit')}
  return receipt;
 });
 vi.spyOn(workPolicyGateway,'operation').mockImplementation(async(_env,_provider,_source,_work,op)=>receipts.get(op)??null);
 vi.spyOn(workPolicyGateway,'state').mockImplementation(async()=>({sourceRoleId:draft.roleId,workId:initial.workId,operationId:'',access:'private',restriction:'none',epoch,state:'complete',replayed:false}));
 await enrollWorkAccess(env,{memberId,roleId:draft.roleId,operationId:crypto.randomUUID(),access:'private',token:'fixture'});
 const submitted=await submit();const sub=(await env.DB.prepare('SELECT submission_id FROM hosting_versions WHERE version_id=?').bind(submitted.versionId).first<{submission_id:string}>())!;
 await claim(env.DB,sub.submission_id,'old-reviewer',Date.now());
 const commit=vi.spyOn(workPolicyGateway,'commit');
 await expect(beginHostedEdit(env.DB,memberId,draft.roleId,Date.now(),'harbor',env)).rejects.toThrow('visibility_sync_pending');
 await expect(stamp(env.DB,{submissionId:sub.submission_id,memberId:'old-reviewer',verdict:'approve',note:'',now:Date.now()},env)).rejects.toThrow('visibility_operation_conflict');
 expect(commit).not.toHaveBeenCalled();
 expect((await beginHostedEdit(env.DB,memberId,draft.roleId,Date.now(),'harbor',env)).resubmit).toBe(true);
 expect(change.mock.calls.filter(c=>c[3].action==='cancel')).toHaveLength(1);
 expect(await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(sub.submission_id).first()).toEqual({status:'superseded'});
 await expect(stamp(env.DB,{submissionId:sub.submission_id,memberId:'old-reviewer',verdict:'approve',note:'',now:Date.now()},env)).rejects.toThrow('visibility_operation_conflict');
});
