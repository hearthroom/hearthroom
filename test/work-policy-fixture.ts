import {workPolicyGateway,type WorkOwnerView,type WorkPolicyCommand,type WorkPolicyReceipt} from '../src/work-policy';
import {upstream} from '../src/upstream';
import {HttpError,type Env} from '../src/types';
import type {ProviderId} from '../src/providers';

// Opt-in protocol fixture for legacy social/review tests. Real ownership, hash,
// grant, race and recovery proof lives in the PG/HTTP and cross-service suites.
let cleanup:(()=>void)|undefined;
export function restoreLegacyPolicyFixture(){cleanup?.();cleanup=undefined;}
export function legacyPolicyFixture(){
 restoreLegacyPolicyFixture();const gateway={...workPolicyGateway},fetcher=globalThis.fetch;
 const policies=new Map<string,WorkOwnerView>(),operations=new Map<string,WorkPolicyReceipt>(),commands=new Map<string,WorkPolicyCommand>();
 const operationKey=(source:string,id:string)=>source+':'+id;
 const empty=(source:string):WorkOwnerView=>({sourceRoleId:source,workId:'00000000-0000-0000-0000-000000000000',operationId:'',access:'private',restriction:'none',epoch:0,state:'complete',replayed:false,managed:false,approvedRoleId:'',policyRevision:'fixture-owner-revision:'+source+':0',approvalRevision:'fixture-approval-revision:'+source,revisionState:'unknown',restorable:false,restoreReason:'not_approved',providerRestriction:'none'});
 const current=(source:string)=>policies.get(source)??empty(source);
 const owner=async(env:Env,provider:ProviderId,source:string,token:string)=>{
  const [identity,role]=await Promise.all([upstream.fetchMe(env,token,provider),upstream.fetchRole(env,source,provider)]);
  if(identity.accountNumId!==role.authorNumId)throw new HttpError(403,'not_the_author');return {...current(source)};
 };
 workPolicyGateway.owner=owner;
 workPolicyGateway.owners=async(env,provider,sources,token)=>Promise.all(sources.map(source=>owner(env,provider,source,token)));
 workPolicyGateway.state=async(_env,_provider,source)=>policies.has(source)?{...current(source)}:null;
 workPolicyGateway.operation=async(_e,_p,source,_work,id)=>operations.get(operationKey(source,id))??null;
 workPolicyGateway.change=async(env,provider,source,command,token)=>{
  const key=operationKey(source,command.operationId),prior=operations.get(key);
  if(prior)return {...prior,replayed:true};
  const before=current(source);
  if(command.expectedEpoch!==before.epoch||command.expectedOwnerRevision&&command.expectedOwnerRevision!==before.policyRevision)throw new HttpError(409,'visibility_operation_conflict');
  if(token)await owner(env,provider,source,token);
  const after={...before,managed:true,workId:command.workId,operationId:command.operationId,epoch:before.epoch+(command.action==='prepare'?0:1)};
  if(command.action==='bind'){after.access=command.access!;after.approvedRoleId=command.versionRoleId??'';after.restriction=command.restriction??'none';}
  if(command.action==='private'||command.action==='unlisted')after.access=command.action;
  if(command.action==='restore')after.access='public';
  if(command.action==='restrict')after.restriction=command.restriction!;
  if(command.action==='correct_review'&&before.approvedRoleId===command.versionRoleId){after.approvedRoleId=command.approvedRoles?.[0]??'';if(!after.approvedRoleId&&after.access==='public')after.access='private';}
  after.policyRevision='fixture-owner-revision:'+source+':'+after.epoch;
  after.state=command.action==='prepare'?'prepared':'complete';policies.set(source,after);
  const receipt={...after};operations.set(key,receipt);commands.set(key,command);return receipt;
 };
 workPolicyGateway.commit=async(_env,_provider,source,work,id)=>{
  const key=operationKey(source,id),prior=operations.get(key),command=commands.get(key),before=current(source);
  if(prior?.state==='complete')return prior;
  if(!prior||!command||before.epoch!==command.expectedEpoch||before.restriction!=='none')throw new HttpError(409,'visibility_operation_conflict');
  const after:WorkOwnerView={...before,workId:work,access:'public',approvedRoleId:command.versionRoleId!,epoch:before.epoch+1,state:'complete'};
  after.policyRevision='fixture-owner-revision:'+source+':'+after.epoch;policies.set(source,after);operations.set(key,after);return after;
 };
 globalThis.fetch=async(input,init)=>{
  if(new URL(String(input)).pathname.endsWith('/hosting/work-access/batch')){
   const body=JSON.parse(String(init?.body)) as {items:{sourceRoleId:string;workId:string;targetRoleId:string}[]};
   return Response.json({items:body.items.map(item=>{
    const p=current(item.sourceRoleId),granted=item.targetRoleId===p.approvedRoleId;
    const readable=p.managed&&p.workId===item.workId&&p.restriction!=='suspended'&&(p.access==='public'?granted:p.access==='unlisted'&&(granted||item.targetRoleId===item.sourceRoleId));
    return {...item,managed:p.managed,access:p.access,restriction:p.restriction,epoch:p.epoch,approvedRoleId:p.approvedRoleId,shareRoleId:p.access==='public'?p.approvedRoleId:p.access==='unlisted'?item.sourceRoleId:'',targetReadable:readable,listed:readable&&p.access==='public'&&p.restriction==='none'};
   })});
  }
  return fetcher(input,init);
 };
 cleanup=()=>{Object.assign(workPolicyGateway,gateway);globalThis.fetch=fetcher;};
}
