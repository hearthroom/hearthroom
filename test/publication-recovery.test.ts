import {env,SELF} from 'cloudflare:test';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {resetDb,makeMember,role,GENERAL_RATING} from './helpers';
import {beginHostedEdit,submitHosted,hostGateway} from '../src/hosting';
import {workPolicyGateway,type WorkPolicyReceipt} from '../src/work-policy';
import {opsMetrics} from '../src/ops-metrics';
import {upstream} from '../src/upstream';

beforeEach(resetDb);afterEach(()=>vi.restoreAllMocks());
async function orphan(){
 const memberId=await makeMember(10001),draft=role({roleId:'orphan-fixture',authorNumId:10001});
 const work=crypto.randomUUID(),version=crypto.randomUUID(),operation=crypto.randomUUID(),permit=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO works VALUES(?,?,?,?,?)').bind(work,memberId,'harbor',draft.roleId,Date.now()).run();
 await env.DB.prepare("INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction) VALUES(?,'harbor',?,'public',3,'none')").bind(work,draft.roleId).run();
 await env.DB.prepare("INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,rating,rating_answers,created_at) VALUES(?,?,?,?,?,'harbor','G',?,?)").bind(version,work,memberId,operation,draft.roleId,JSON.stringify(GENERAL_RATING.answers),Date.now()-86400000).run();
 await env.DB.prepare("INSERT INTO work_publication_permits(version_id,operation_id,epoch,state) VALUES(?,?,3,'prepared')").bind(version,permit).run();
 return {memberId,draft,work,version,operation,permit};
}
it('retires an unsubmitted preparation only after canonical cancellation, then rejects its late resurrection',async()=>{
 const x=await orphan();let epoch=3;const receipts=new Map<string,WorkPolicyReceipt>();let lose=true;
 const change=vi.spyOn(workPolicyGateway,'change').mockImplementation(async(_e,_p,source,c)=>{
  expect(c).toMatchObject({action:'cancel',permitId:x.permit,expectedEpoch:3});
  const receipt:WorkPolicyReceipt={sourceRoleId:source,workId:x.work,operationId:c.operationId,access:'public',restriction:'none',epoch:++epoch,state:'complete',replayed:false};
  receipts.set(c.operationId,receipt);if(lose){lose=false;throw new Error('reply lost');}return receipt;
 });
 vi.spyOn(workPolicyGateway,'operation').mockImplementation(async(_e,_p,_s,_w,op)=>op===x.permit?{sourceRoleId:x.draft.roleId,workId:x.work,operationId:op,access:'public',restriction:'none',epoch:3,state:'prepared',replayed:false}:receipts.get(op)??null);
 const edit=()=>beginHostedEdit(env.DB,x.memberId,x.draft.roleId,Date.now(),'harbor',env);
 await expect(edit()).rejects.toThrow('visibility_sync_pending');
 expect(await env.DB.prepare('SELECT state FROM hosting_versions WHERE version_id=?').bind(x.version).first()).toEqual({state:'cancelling'});
 // Even a second browser cannot acquire the work while Provider result is unknown.
 await expect(env.DB.prepare("INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,created_at) VALUES(?,?,?,?,?,'harbor',?)").bind(crypto.randomUUID(),x.work,x.memberId,crypto.randomUUID(),x.draft.roleId,Date.now()).run()).rejects.toThrow();
 await edit();expect(change).toHaveBeenCalledTimes(1);
 expect(await env.DB.prepare('SELECT state FROM hosting_versions WHERE version_id=?').bind(x.version).first()).toEqual({state:'superseded'});
 expect(await env.DB.prepare('SELECT state FROM work_publication_permits WHERE version_id=?').bind(x.version).first()).toEqual({state:'cancelled'});
 expect(await env.DB.prepare('SELECT access,epoch,sync_state FROM managed_work_access WHERE work_id=?').bind(x.work).first()).toEqual({access:'public',epoch:4,sync_state:'complete'});
 await expect(env.DB.prepare("UPDATE hosting_versions SET state='preparing' WHERE version_id=?").bind(x.version).run()).rejects.toThrow();
 await expect(env.DB.prepare("UPDATE hosting_versions SET submission_id='late-submission',state='pending' WHERE version_id=?").bind(x.version).run()).rejects.toThrow();
 expect(await opsMetrics(env.DB)).toContain('hearthroom_publication_recovery_total{operation="cancel",outcome="complete"} 1');
 // An old request must fail before another seal or a new review can be created.
 const seal=vi.spyOn(hostGateway,'seal');
 await expect(submitHosted(env,{memberId:x.memberId,account:10001,role:x.draft,token:'fixture',rating:GENERAL_RATING,operationId:x.operation,now:Date.now()})).rejects.toMatchObject({status:409});
 expect(seal).not.toHaveBeenCalled();
 await env.DB.prepare("INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,created_at) VALUES(?,?,?,?,?,'harbor',?)").bind(crypto.randomUUID(),x.work,x.memberId,crypto.randomUUID(),x.draft.roleId,Date.now()).run();
});

it('uses an epoch fence without inventing a missing Provider permit',async()=>{
 const x=await orphan();
 vi.spyOn(workPolicyGateway,'operation').mockResolvedValue(null);
 const change=vi.spyOn(workPolicyGateway,'change').mockImplementation(async(_e,_p,source,c)=>{
  expect(c.permitId).toBeUndefined();
  return {sourceRoleId:source,workId:c.workId,operationId:c.operationId,access:'public',restriction:'none',epoch:4,state:'complete',replayed:false};
 });
 await beginHostedEdit(env.DB,x.memberId,x.draft.roleId,Date.now(),'harbor',env);
 expect(change).toHaveBeenCalledTimes(1);
 expect(await env.DB.prepare('SELECT state FROM hosting_versions WHERE version_id=?').bind(x.version).first()).toEqual({state:'superseded'});
});

it('keeps a cancellation fenced when Provider readback is unavailable',async()=>{
 const x=await orphan();
 vi.spyOn(workPolicyGateway,'operation').mockRejectedValue(new Error('offline'));
 const change=vi.spyOn(workPolicyGateway,'change');
 await expect(beginHostedEdit(env.DB,x.memberId,x.draft.roleId,Date.now(),'harbor',env)).rejects.toThrow();
 expect(change).not.toHaveBeenCalled();
 expect(await env.DB.prepare('SELECT state FROM hosting_versions WHERE version_id=?').bind(x.version).first()).toEqual({state:'cancelling'});
 expect(await opsMetrics(env.DB)).toContain('hearthroom_publication_recovery_total{operation="cancel",outcome="pending"} 1');
});

it('recovers the original unknown bind before fencing an unsubmitted preparation',async()=>{
 const x=await orphan(),bind=crypto.randomUUID();
 await env.DB.prepare('DELETE FROM work_publication_permits WHERE version_id=?').bind(x.version).run();
 await env.DB.prepare("UPDATE managed_work_access SET epoch=0,sync_state='changing',sync_operation_id=? WHERE work_id=?").bind(bind,x.work).run();
 const command={workId:x.work,operationId:bind,expectedEpoch:0,action:'bind',access:'public'};
 // Use the real durable intent helper to keep this scenario's bind resumable.
 const {workPolicyIntentStatement}=await import('../src/work-policy');
 await (await workPolicyIntentStatement(env,'harbor',x.draft.roleId,command as any)).run();
 vi.spyOn(workPolicyGateway,'operation').mockImplementation(async(_e,_p,source,work,op)=>op===bind?{sourceRoleId:source,workId:work,operationId:op,access:'public',restriction:'none',epoch:1,state:'complete',replayed:false}:null);
 const change=vi.spyOn(workPolicyGateway,'change').mockImplementation(async(_e,_p,source,c)=>{
  expect(c.action).toBe('cancel');expect(c.expectedEpoch).toBe(1);
  return {sourceRoleId:source,workId:c.workId,operationId:c.operationId,access:'public',restriction:'none',epoch:2,state:'complete',replayed:false};
 });
 await beginHostedEdit(env.DB,x.memberId,x.draft.roleId,Date.now(),'harbor',env);
 expect(change).toHaveBeenCalledTimes(1);
 expect(await env.DB.prepare('SELECT state FROM hosting_versions WHERE version_id=?').bind(x.version).first()).toEqual({state:'superseded'});
});

it('checks ownership before any retirement or cancellation',async()=>{
 const x=await orphan(),change=vi.spyOn(workPolicyGateway,'change');
 await expect(beginHostedEdit(env.DB,'other-member',x.draft.roleId,Date.now(),'harbor',env)).rejects.toMatchObject({status:403});
 expect(change).not.toHaveBeenCalled();
 expect(await env.DB.prepare('SELECT state FROM hosting_versions WHERE version_id=?').bind(x.version).first()).toEqual({state:'preparing'});
});

it('exposes durable pending and retired readback through the authenticated HTTP route with bounded metrics',async()=>{
 const x=await orphan();
 vi.spyOn(upstream,'fetchMe').mockResolvedValue({accountNumId:10001});
 vi.spyOn(workPolicyGateway,'owner').mockResolvedValue({workId:x.work,epoch:3} as any);
 const read=()=>SELF.fetch(`https://fixture.test/v1/me/cards/${x.draft.roleId}/publication/operations/${x.operation}`,{headers:{Authorization:'Bearer fixture'}});
 let response=await read();expect(response.status).toBe(200);
 expect(await response.json()).toEqual({operation:{operationId:x.operation,state:'pending'}});
 await env.DB.prepare("UPDATE hosting_versions SET state='superseded' WHERE version_id=?").bind(x.version).run();
 response=await read();expect(response.status).toBe(200);
 expect(await response.json()).toEqual({operation:{operationId:x.operation,state:'conflict'}});
 const metrics=await opsMetrics(env.DB);
 expect(metrics).toContain('hearthroom_publication_recovery_total{operation="read",outcome="pending"} 1');
 expect(metrics).toContain('hearthroom_publication_recovery_total{operation="read",outcome="conflict"} 1');
 expect(metrics).not.toContain(x.operation);
});

it('does not misreport unrelated database insertion failures as an existing pending review',async()=>{
 const memberId=await makeMember(10001),draft=role({roleId:'database-failure-fixture',authorNumId:10001});
 await env.DB.prepare("CREATE TRIGGER fixture_hosting_insert_failure BEFORE INSERT ON hosting_versions BEGIN SELECT RAISE(ABORT,'fixture_disk_failure'); END").run();
 try{
  await expect(submitHosted(env,{memberId,account:10001,role:draft,token:'fixture',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()})).rejects.not.toMatchObject({message:'submission_pending'});
 }finally{await env.DB.prepare('DROP TRIGGER fixture_hosting_insert_failure').run();}
});

it('distinguishes another browser encountering an unfinished preparation from an incompatible operation replay',async()=>{
 const x=await orphan();
 await expect(submitHosted(env,{memberId:x.memberId,account:10001,role:x.draft,token:'fixture',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()})).rejects.toMatchObject({status:409,message:'hosting_preparation_unfinished'});
 expect(await env.DB.prepare('SELECT state FROM hosting_versions WHERE version_id=?').bind(x.version).first()).toEqual({state:'preparing'});
 expect(await opsMetrics(env.DB)).toContain('hearthroom_publication_recovery_total{operation="submit",outcome="pending"} 1');
});

it.each(['cancel','finalize'] as const)('keeps the real final submission transaction coherent when %s wins the edit race',async winner=>{
 const x=await orphan();let epoch=3;
 const prepared:WorkPolicyReceipt={sourceRoleId:x.draft.roleId,workId:x.work,operationId:x.permit,access:'public',restriction:'none',epoch:3,state:'prepared',replayed:false};
 vi.spyOn(hostGateway,'seal').mockResolvedValue({workId:x.work,versionId:x.version,hostedRevisionId:'sealed-fixture'});
 vi.spyOn(hostGateway,'read').mockResolvedValue({...x.draft,roleId:'sealed-fixture'});
 vi.spyOn(upstream,'readForReview').mockResolvedValue({document:{roleDetailDesc:'這是只用於交易競態驗證的合成角色設定，包含足夠長的背景與角色互動規則。'.repeat(100)},hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
 vi.spyOn(workPolicyGateway,'state').mockImplementation(async()=>({...prepared,epoch}));
 vi.spyOn(workPolicyGateway,'operation').mockImplementation(async(_e,_p,_s,_w,operation)=>operation===x.permit?prepared:null);
 vi.spyOn(workPolicyGateway,'change').mockImplementation(async(_e,_p,source,command)=>{
  if(command.action==='prepare')return prepared;
  expect(command.action).toBe('cancel');epoch++;
  return {sourceRoleId:source,workId:x.work,operationId:command.operationId,access:'public',restriction:'none',epoch,state:'complete',replayed:false};
 });
 let ready!:()=>void,resume!:()=>void,held=false;
 const atFinalBatch=new Promise<void>(resolve=>{ready=resolve}),release=new Promise<void>(resolve=>{resume=resolve});
 const delayed={prepare:env.DB.prepare.bind(env.DB),batch:async(statements:D1PreparedStatement[])=>{
  if(!held&&statements.length>=6){held=true;ready();await release;}
  return env.DB.batch(statements);
 }} as D1Database;
 const submitted=submitHosted({...env,DB:delayed},{memberId:x.memberId,account:10001,role:x.draft,token:'fixture',rating:GENERAL_RATING,operationId:x.operation,now:Date.now()});
 const outcome=submitted.then(value=>({value,error:null}),error=>({value:null,error}));
 await atFinalBatch;
 if(winner==='cancel')await beginHostedEdit(env.DB,x.memberId,x.draft.roleId,Date.now(),'harbor',env);
 resume();const result=await outcome;
 if(winner==='cancel'){
  expect(result.error).toMatchObject({status:409,message:'hosting_operation_conflict'});
  // This is the actual submitHosted/upsertCard final batch, not a hand-built
  // approximation: its first registration and all private review data roll back.
  for(const table of ['cards','card_registrations','review_submissions','review_snapshots','originality_texts','originality_prints']){
   expect(await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first(),table).toEqual({n:0});
  }
 }else{
  expect(result.error).toBeNull();expect(result.value?.versionId).toBe(x.version);
  expect((await env.DB.prepare('SELECT count(*) AS n FROM originality_prints').first<{n:number}>())!.n).toBeGreaterThan(0);
  await beginHostedEdit(env.DB,x.memberId,x.draft.roleId,Date.now(),'harbor',env);
  expect(await env.DB.prepare('SELECT status FROM review_submissions').first()).toEqual({status:'superseded'});
  expect(await env.DB.prepare('SELECT count(*) AS n FROM card_registrations').first()).toEqual({n:1});
  expect(await env.DB.prepare('SELECT count(*) AS n FROM review_snapshots').first()).toEqual({n:0});
 }
 expect(await env.DB.prepare('SELECT state FROM hosting_versions WHERE version_id=?').bind(x.version).first()).toEqual({state:'superseded'});
 expect(await env.DB.prepare('SELECT access FROM managed_work_access WHERE work_id=?').bind(x.work).first()).toEqual({access:'public'});
});
