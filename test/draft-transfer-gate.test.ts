import { env } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';

it('durably fences target identity and writers while preserving unrelated cards and batch atomicity', async()=>{
 const db=env.DB;
 await db.prepare("INSERT INTO card_numbers(num,provider,source_role_id) VALUES(9000001,'harbor','gate-target'),(9000002,'harbor','gate-other')").run();
 await db.prepare("INSERT INTO draft_transfer_gate_events(request_id,scope,provider,source_role_id,card_num,operation,generation,phase,baseline_digest,receipt_hash,evidence_hash,payload,created_at) VALUES('request-hold','test-db','harbor','gate-target',9000001,'operation',1,'held','','','','hold',0)").run();
 await expect(db.prepare("INSERT INTO works VALUES('blocked','member','harbor','gate-target',0)").run()).rejects.toThrow('draft_transfer_held');
 await expect(db.prepare('DELETE FROM card_numbers WHERE num=9000001').run()).rejects.toThrow('draft_transfer_held');
 await db.prepare("INSERT INTO works VALUES('other','member','harbor','gate-other',0)").run();
 await expect(db.prepare("UPDATE works SET source_role_id='gate-target' WHERE id='other'").run()).rejects.toThrow('draft_transfer_held');
 await expect(db.batch([db.prepare("INSERT INTO works VALUES('side-effect','member','harbor','unrelated',0)"),db.prepare("INSERT INTO works VALUES('blocked2','member','harbor','gate-target',0)")])).rejects.toThrow('draft_transfer_held');
 expect(await db.prepare("SELECT id FROM works WHERE id='side-effect'").first()).toBeNull();
 await expect(db.prepare("UPDATE draft_transfer_gate_events SET phase='released'").run()).rejects.toThrow('draft_transfer_gate_immutable');
 await expect(db.prepare('DELETE FROM draft_transfer_gate_events').run()).rejects.toThrow('draft_transfer_gate_immutable');
});

import { controlTransferGate, transferGateRoutes } from '../src/draft-transfer-gate';
import { opsMetrics } from '../src/ops-metrics';

it('includes a pending reward correction in the held work inventory and fences its writes', async () => {
 const db=env.DB;
 await db.prepare("INSERT INTO members(id,handle,created_at) VALUES('gate-topup-author','gatetopupauthor',0),('gate-topup-admin','gatetopupadmin',0)").run();
 await db.prepare("INSERT INTO card_numbers(num,provider,source_role_id) VALUES(9000081,'harbor','gate-topup-role')").run();
 await db.prepare("INSERT INTO card_reward_campaigns(id,slug,starts_at,ends_at,weekly_limit,reward,created_at,updated_at) VALUES('gate-topup-campaign','gate-topup-campaign',0,1,6,20000,0,0)").run();
 await db.prepare(`INSERT INTO card_rewards(id,campaign_id,work_key,card_id,member_id,recipient_account_no,amount,status,requested_by,created_at,updated_at)
 VALUES('gate-original','gate-topup-campaign','harbor:gate-topup-role',9000081,'gate-topup-author',1,10000,'paid','gate-topup-admin',0,0)`).run();
 await db.prepare(`INSERT INTO card_reward_topups(id,reward_id,target_amount,amount,requested_by,created_at)
 VALUES('gate-topup','gate-original',20000,10000,'gate-topup-admin',0)`).run();
 const b={scope:'test-db',provider:'harbor',sourceRoleId:'gate-topup-role',cardNum:9000081,operation:'gate-topup-operation',generation:1};
 const state=await controlTransferGate(db,'test-db',{...b,action:'held',requestId:'gate-topup-hold'});
 expect(state).toMatchObject({counts:{card_reward_topups:1},blockers:expect.arrayContaining(['card_reward_topups'])});
 await expect(db.prepare("UPDATE card_reward_topups SET error='changed' WHERE id='gate-topup'").run()).rejects.toThrow('draft_transfer_held');
 await expect(db.prepare("DELETE FROM card_reward_topups WHERE id='gate-topup'").run()).rejects.toThrow('draft_transfer_held');
 await expect(db.prepare("INSERT INTO card_reward_topups SELECT 'gate-topup-other',reward_id,target_amount,amount,status,provider_entry_id,error,requested_by,created_at,settled_at FROM card_reward_topups WHERE id='gate-topup'").run()).rejects.toThrow('draft_transfer_held');
});

it('binds durable transitions to exact operation, generation and primary closure, replays without unlocking',async()=>{
 const db=env.DB;
 await db.prepare("INSERT INTO card_numbers(num,provider,source_role_id) VALUES(9000011,'harbor','control-target')").run();
 const b={scope:'test-db',provider:'harbor',sourceRoleId:'control-target',cardNum:9000011,operation:'operation-control',generation:1};
 const held=await controlTransferGate(db,'test-db',{...b,action:'held',requestId:'control-hold-1'});
 expect(held).toMatchObject({phase:'held',blockers:[]});
 const status=await controlTransferGate(db,'test-db',{...b,action:'status'}) as {digest:string};
 await expect(controlTransferGate(db,'test-db',{...b,generation:2,action:'status'})).rejects.toThrow('draft_transfer_gate_conflict');
 await expect(controlTransferGate(db,'wrong-db',{...b,action:'status'})).rejects.toThrow('draft_transfer_input');
 await expect(controlTransferGate(db,'test-db',{...b,action:'prepared',requestId:'control-prepare-1',baselineDigest:'0'.repeat(64)})).rejects.toThrow('draft_transfer_baseline_changed');
 await controlTransferGate(db,'test-db',{...b,action:'prepared',requestId:'control-prepare-1',baselineDigest:status.digest});
 await expect(controlTransferGate(db,'test-db',{...b,action:'released',requestId:'control-release-1',baselineDigest:status.digest})).rejects.toThrow('draft_transfer_release_evidence');
 const release={...b,action:'released',requestId:'control-release-1',baselineDigest:status.digest,receiptHash:'a'.repeat(64),evidenceHash:'b'.repeat(64),resolution:'verified_no_apply'};
 await controlTransferGate(db,'test-db',release);
 await controlTransferGate(db,'test-db',{...b,generation:2,action:'held',requestId:'control-hold-2'});
 expect(await controlTransferGate(db,'test-db',release)).toMatchObject({replayed:true,phase:'held',generation:2});
 await expect(db.prepare("INSERT INTO works VALUES('still-held','member','harbor','control-target',0)").run()).rejects.toThrow('draft_transfer_held');
 await expect(controlTransferGate(db,'test-db',{...release,evidenceHash:'c'.repeat(64)})).rejects.toThrow('draft_transfer_gate_conflict');
 expect(await opsMetrics(db)).toContain('hearthroom_draft_transfer_gate_total{operation="transition",outcome="success"}');
});

it('rejects ordinary users and fails closed when primary read cannot be opened',async()=>{
 const values={...env,DRAFT_TRANSFER_CONTROL_SECRET:'s'.repeat(32),DRAFT_TRANSFER_CONTROL_SCOPE:'test-db',DRAFT_TRANSFER_CONTROL_CARD_NUM:'100216'};
 let response=await transferGateRoutes.request('https://local/internal/community/draft-transfer-gate',{method:'POST',headers:{Authorization:'Bearer ordinary'},body:'{}'},values);
 expect(response.status).toBe(403);
 expect(await opsMetrics(env.DB)).toContain('hearthroom_draft_transfer_gate_total{operation="transition",outcome="denied"}');
 response=await transferGateRoutes.request('https://local/internal/community/draft-transfer-gate',{method:'POST',headers:{Authorization:'Bearer '+'s'.repeat(32)},body:'{}'},{...values,DB:{prepare:env.DB.prepare.bind(env.DB),withSession(){throw new Error('primary unavailable');}} as unknown as D1Database});
 expect(response.status).toBe(503);
 expect(await response.json()).toEqual({error:'draft_transfer_control_error'});
});

afterEach(async()=>{
 vi.restoreAllMocks();
 const active=await env.DB.prepare('SELECT * FROM draft_transfer_gate_active').all<{scope:string;provider:string;source_role_id:string;card_num:number;operation:string;generation:number;phase:string}>();
 for(const row of active.results){
  const b={scope:row.scope,provider:row.provider,sourceRoleId:row.source_role_id,cardNum:row.card_num,operation:row.operation,generation:row.generation};
  const state=await controlTransferGate(env.DB,row.scope,{...b,action:'status'}) as {digest:string};
  if(row.phase==='held')await controlTransferGate(env.DB,row.scope,{...b,action:'prepared',requestId:crypto.randomUUID(),baselineDigest:state.digest});
  await controlTransferGate(env.DB,row.scope,{...b,action:'released',requestId:crypto.randomUUID(),baselineDigest:state.digest,receiptHash:'a'.repeat(64),evidenceHash:'b'.repeat(64),resolution:'verified_no_apply'});
 }
});

import { submitHosted, hostGateway } from '../src/hosting';
import { makeMember, role, GENERAL_RATING } from './helpers';
import { upstream } from '../src/upstream';

it.each(['sealed','lost-response'])('holds stale in-flight %s without cleanup, registry or quota side effects',async(outcome)=>{
 const memberId=await makeMember(outcome==='sealed'?99101:99102);
 const sourceRoleId='inflight-'+outcome;
 const num=outcome==='sealed'?9000021:9000022;
 await env.DB.prepare('INSERT INTO card_numbers(num,provider,source_role_id) VALUES(?,\'harbor\',?)').bind(num,sourceRoleId).run();
 let arrived!:()=>void,finish!:(value:{workId:string;versionId:string;hostedRevisionId:string})=>void,fail!:(e:Error)=>void;
 const started=new Promise<void>(r=>{arrived=r;});let work='',version='';
 vi.spyOn(hostGateway,'seal').mockImplementation(async(_env,_token,_source,w,v)=>{work=w;version=v;arrived();return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});});
 vi.spyOn(hostGateway,'read').mockImplementation(async(_env,_token,id)=>role({roleId:id,authorNumId:99101}));
 vi.spyOn(upstream,'readForReview').mockResolvedValue({document:{roleDetailDesc:'字'.repeat(3001)},hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
 const pending=submitHosted(env,{memberId,account:99101,role:role({roleId:sourceRoleId,authorNumId:99101}),token:'synthetic',rating:GENERAL_RATING,operationId:crypto.randomUUID(),now:Date.now()});
 // Attach the rejection assertion before releasing the simulated remote request.
 const rejected=expect(pending).rejects.toThrow('draft_transfer_held');
 await started;
 const b={scope:'test-db',provider:'harbor',sourceRoleId,cardNum:num,operation:'operation-'+outcome,generation:1};
 const state=await controlTransferGate(env.DB,'test-db',{...b,action:'held',requestId:'hold-'+outcome});
 expect(state).toMatchObject({phase:'held',blockers:expect.arrayContaining(['works','hosting_versions'])});
 if(outcome==='sealed')finish({workId:work,versionId:version,hostedRevisionId:'sealed-'+version});else fail(new Error('remote response lost'));
 await rejected;
 expect(await env.DB.prepare('SELECT state FROM hosting_versions WHERE version_id=?').bind(version).first()).toEqual({state:'preparing'});
 expect(await env.DB.prepare('SELECT id FROM cards WHERE id=?').bind(num).first()).toBeNull();
 expect(await env.DB.prepare('SELECT source_role_id FROM card_registrations WHERE source_role_id=?').bind(sourceRoleId).first()).toBeNull();
 expect((await controlTransferGate(env.DB,'test-db',{...b,action:'status'}))).toMatchObject({phase:'held'});
});

it('freezes reverse aliases and every retained version state, including writes from an old reviewer',async()=>{
 const db=env.DB;
 await db.prepare("INSERT INTO card_numbers(num,provider,source_role_id) VALUES(9000031,'harbor','alias-target')").run();
 await db.prepare("INSERT INTO works VALUES('alias-work','member','harbor','alias-target',0)").run();
 await db.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,updated_at) VALUES('alias-work','harbor',1,'alias-copy',0)").run();
 await db.prepare("INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,state,created_at) VALUES('alias-version','alias-work','member','alias-operation','alias-copy','harbor','failed',0)").run();
 await db.prepare("INSERT INTO hosting_replicas(version_id,provider,source_role_id,hosted_revision_id,state,created_at) VALUES('alias-version','harbor','alias-copy','alias-sealed','ready',0)").run();
 await db.prepare("INSERT INTO hosting_transfers(version_id,provider,external_id,operation_id,draft_role_id,updated_at) VALUES('alias-version','harbor',1,'alias-transfer','alias-draft',0)").run();
 await db.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at) VALUES('alias-submission',9000031,'harbor','alias-sealed','first','pending',0)").run();
 await db.prepare("INSERT INTO review_snapshots(submission_id,detail,created_at) VALUES('alias-submission','synthetic',0)").run();
 await db.prepare("INSERT INTO originality_texts(submission_id,card_id,member_id,algorithm,unit_count,created_at) VALUES('alias-submission',9000031,'member','synthetic',1,0)").run();
 await db.prepare("INSERT INTO originality_prints(hash,text_id) SELECT 123,id FROM originality_texts WHERE submission_id='alias-submission'").run();
 await db.prepare("INSERT INTO card_registrations(provider,author_num_id,source_role_id,registered_at) VALUES('harbor',1,'alias-copy',0)").run();
 const b={scope:'test-db',provider:'harbor',sourceRoleId:'alias-target',cardNum:9000031,operation:'operation-alias',generation:1};
 const state=await controlTransferGate(db,'test-db',{...b,action:'held',requestId:'request-alias'});
 expect(state).toMatchObject({blockers:expect.arrayContaining(['works','work_copies','hosting_versions','hosting_replicas','hosting_transfers','review_submissions','originality_prints'])});
 // BEFORE triggers also reject an INSERT SELECT of an existing key before uniqueness checks.
 for(const [table,key,column] of [
  ['works',"id='alias-work'",'id'],['work_copies',"work_id='alias-work'",'role_id'],
  ['hosting_versions',"version_id='alias-version'",'state'],['hosting_replicas',"version_id='alias-version'",'state'],
  ['hosting_transfers',"version_id='alias-version'",'state'],['review_submissions',"id='alias-submission'",'claimed_by'],
  ['review_snapshots',"submission_id='alias-submission'",'detail'],['review_deliveries',"submission_id='alias-submission'",'revision'],
  ['originality_texts',"submission_id='alias-submission'",'unit_count'],['originality_prints','hash=123','hash'],
  ['card_registrations',"source_role_id='alias-copy'",'registered_at'],
 ]){
  await expect(db.prepare(`INSERT INTO ${table} SELECT * FROM ${table} WHERE ${key}`).run()).rejects.toThrow('draft_transfer_held');
  await expect(db.prepare(`UPDATE ${table} SET ${column}=${column} WHERE ${key}`).run()).rejects.toThrow();
  await expect(db.prepare(`DELETE FROM ${table} WHERE ${key}`).run()).rejects.toThrow('draft_transfer_held');
 }
 await expect(db.prepare("INSERT INTO moderation_blocked_versions(version_id,case_id) VALUES('alias-version','unrelated-case')").run()).rejects.toThrow('draft_transfer_held');
 await expect(db.prepare("UPDATE works SET source_role_id='escape' WHERE id='alias-work'").run()).rejects.toThrow('draft_transfer_held');
 await expect(db.prepare("INSERT INTO review_stamps(submission_id,member_id,verdict,note,created_at) VALUES('alias-submission','reviewer','approve','',0)").run()).rejects.toThrow();
});

it('rejects direct reward, moderation and replacement writes before any durable mutation',async()=>{
 const db=env.DB;
 await db.prepare("INSERT INTO card_numbers(num,provider,source_role_id) VALUES(9000041,'harbor','direct-target')").run();
 const b={scope:'test-db',provider:'harbor',sourceRoleId:'direct-target',cardNum:9000041,operation:'operation-direct',generation:1};
 await controlTransferGate(db,'test-db',{...b,action:'held',requestId:'request-direct'});
 for(const sql of [
  "INSERT INTO cards(id,provider,source_role_id) VALUES(9000041,'harbor','direct-target')",
  "INSERT INTO card_rewards(card_id,work_key) VALUES(9000041,'harbor:direct-target')",
  "INSERT INTO moderation_state(provider,source_role_id) VALUES('harbor','direct-target')",
  "INSERT INTO moderation_cases(provider,source_role_id) VALUES('harbor','direct-target')",
  "INSERT INTO moderation_events(provider,source_role_id) VALUES('harbor','direct-target')",
  "INSERT INTO moderation_compensation(provider,source_role_id) VALUES('harbor','direct-target')",
 ])await expect(db.prepare(sql).run()).rejects.toThrow('draft_transfer_held');
 await expect(db.prepare("INSERT OR REPLACE INTO draft_transfer_gate_events SELECT * FROM draft_transfer_gate_events WHERE request_id='request-direct'").run()).rejects.toThrow('draft_transfer_gate_conflict');
 const triggers=await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'draft_transfer_hold_%'").all<{name:string}>();
 // 22 guarded tables, including the independent reward correction ledger.
 expect(triggers.results.length).toBe(66);
});

import worker from '../src/index';

it('opens the control primary from the original binding through the full Worker fetch path',async()=>{
 const constraints:string[]=[];
 const db={prepare:env.DB.prepare.bind(env.DB),withSession(constraint:string){constraints.push(constraint);return env.DB.withSession(constraint as any);}} as unknown as D1Database;
 await env.DB.prepare("INSERT INTO card_numbers(num,provider,source_role_id) VALUES(9000091,'harbor','full-worker-control')").run();
 const values={...env,DB:db,DRAFT_TRANSFER_CONTROL_SECRET:'s'.repeat(32),DRAFT_TRANSFER_CONTROL_SCOPE:'test-db',DRAFT_TRANSFER_CONTROL_CARD_NUM:'9000091'};
 const response=await worker.fetch(new Request('https://local/internal/community/draft-transfer-gate',{method:'POST',headers:{Authorization:'Bearer '+'s'.repeat(32),'Content-Type':'application/json'},body:JSON.stringify({scope:'test-db',provider:'harbor',sourceRoleId:'full-worker-control',cardNum:9000091,operation:'full-worker-operation',generation:1,action:'held',requestId:'full-worker-request'})}),values as any,{} as ExecutionContext);
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({phase:'held',blockers:[]});
 expect(constraints).toEqual(['first-primary']);
});

it('keeps control primary failures closed through the full Worker fetch path',async()=>{
 const open=vi.fn(()=>{throw new Error('primary unavailable');});
 const values={...env,DB:{prepare:env.DB.prepare.bind(env.DB),withSession:open} as unknown as D1Database,DRAFT_TRANSFER_CONTROL_SECRET:'s'.repeat(32),DRAFT_TRANSFER_CONTROL_SCOPE:'test-db',DRAFT_TRANSFER_CONTROL_CARD_NUM:'100216'};
 const response=await worker.fetch(new Request('https://local/internal/community/draft-transfer-gate',{method:'POST',headers:{Authorization:'Bearer '+'s'.repeat(32),'Content-Type':'application/json'},body:'{}'}),values as any,{} as ExecutionContext);
 expect(response.status).toBe(503);
 expect(await response.json()).toEqual({error:'draft_transfer_control_error'});
 expect(open).toHaveBeenCalledExactlyOnceWith('first-primary');
});
