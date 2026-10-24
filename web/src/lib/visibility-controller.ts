import { computed, ref } from 'vue';
import { fetchWorkVisibility, changeWorkVisibility, fetchVisibilityOperation, VisibilityError, type WorkAccess, type WorkVisibility, type VisibilityCommand, type VisibilityResult } from './work-visibility';
import type { ProviderId } from './provider';

/** One author/work, one unresolved command. Never replace an uncertain mutation with a new intent. */
export function createVisibilityController(options:{id:string;provider:ProviderId;actor:string;token:()=>Promise<string|null>}) {
 const value=ref<WorkVisibility|null>(null);
 const phase=ref<'loading'|'ready'|'saving'|'pending'|'checking'|'unknown'|'retryable'|'error'>('loading');
 const message=ref('');
 const key=`hr.visibility.v1:${options.provider}:${options.actor}:${options.id}`;
 let command:VisibilityCommand|null=null;
 try {const saved=localStorage.getItem(key);if(saved)command=JSON.parse(saved);}catch{/* Unavailable storage does not change the server's authority. */}
 async function token(){const t=await options.token();if(!t)throw new Error('auth');return t;}
 function clear(){command=null;try{localStorage.removeItem(key);}catch{}}
 function remember(next:VisibilityCommand){command=next;try{localStorage.setItem(key,JSON.stringify(next));}catch{}}
 async function latest(t:string){const result=await fetchWorkVisibility(options.id,t,options.provider);if(!result.workVisibility)throw new Error('missing projection');value.value=result.workVisibility;}
 async function check():Promise<void>{
  if(!command)return load();
  phase.value='checking';message.value='';
  try {
   const t=await token();let result:VisibilityResult;
   try {result=await fetchVisibilityOperation(options.id,command.operationId,t,options.provider);}
   catch(e){
    if(e instanceof VisibilityError&&e.result.operation?.state==='conflict')result=e.result;
    else {await latest(t);phase.value=e instanceof VisibilityError&&e.status===404&&e.code==='visibility_operation_not_found'&&canResume()?'retryable':'unknown';return;}
   }
   if(result.operation?.operationId!==command.operationId)throw new Error('invalid receipt');
   // A receipt can describe an older command. Always read current policy before rendering completion.
   await latest(t);
   if((result.operation?.state==='complete'||result.operation?.state==='conflict')&&value.value?.syncState==='complete'){
    message.value=result.operation.state==='conflict'?'conflict':'';clear();phase.value='ready';
   }else phase.value='pending';
  }catch{phase.value='unknown';}
 }
 async function load():Promise<void>{
  if(command)return check();phase.value='loading';message.value='';
  try{await latest(await token());phase.value=value.value?.syncState==='complete'?'ready':'unknown';}catch{phase.value='error';}
 }
 function canResume(){
  const v=value.value,c=command;if(!v||!c||v.syncState!=='complete'||v.policyRevision!==c.expectedPolicyRevision||v.approvalRevision!==c.expectedApprovalRevision)return false;
  const action=c.action==='cancel_review'?'cancel_review':c.targetAccess==='public'?'restore_public':c.targetAccess==='private'?'set_private':'set_unlisted';
  return v.actions.includes(action);
 }
 async function resume(){if(phase.value!=='retryable'||!command)return;await check();if(phase.value==='retryable'&&command)await transmit(command);}
 async function send(next:VisibilityCommand){
  if(command||phase.value!=='ready'||!value.value||value.value.syncState!=='complete')return;
  remember(next);await transmit(next);
 }
 async function transmit(next:VisibilityCommand){
  phase.value='saving';message.value='';
  try {
   const t=await token();const result=await changeWorkVisibility(options.id,t,options.provider,next);
   if(result.operation?.operationId===next.operationId&&result.operation.state==='complete'&&result.workVisibility?.syncState==='complete'){
    value.value=result.workVisibility;clear();phase.value='ready';message.value='success';
   }else await check();
  }catch(e){
   if(e instanceof VisibilityError&&e.status>=400&&e.status<500&&!e.result.operation){
    // These are definitive command rejections. Refresh succeeds before any retry is offered.
    try{await latest(await token());if(value.value?.syncState!=='complete'){phase.value='unknown';return;}clear();phase.value='ready';message.value=e.code==='review_required'?'review_required':e.status===409?'conflict':'denied';}
    catch{phase.value='unknown';}
   }else await check();
  }
 }
 const revisions=()=>({operationId:crypto.randomUUID(),expectedPolicyRevision:value.value!.policyRevision,expectedApprovalRevision:value.value!.approvalRevision});
 async function apply(access:WorkAccess){
  if(phase.value!=='ready'||!value.value||command)return;
  const action=access==='public'?'restore_public':access==='private'?'set_private':'set_unlisted';
  if(!value.value.actions.includes(action))return;
  await send({...revisions(),targetAccess:access});
 }
 async function cancelReview(){if(phase.value==='ready'&&value.value?.actions.includes('cancel_review'))await send({...revisions(),action:'cancel_review'});}
 const resumeAction=computed(()=>phase.value==='retryable'?(command?.action==='cancel_review'?'cancelReview':command&&'targetAccess'in command?command.targetAccess==='private'?'private':command.targetAccess==='unlisted'?'link':'restore':''):'');
 return {resumeAction,value,phase,message,load,check,resume,apply,cancelReview};
}
