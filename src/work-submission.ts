import {Hono} from 'hono';
import {getCard,toCard} from './cards';
import {requireMember} from './members';
import {ownerCardSource,readOwnerVisibility} from './work-sharing';
import {policyOperationId,workPolicyGateway} from './work-policy';
import {type Env,HttpError} from './types';
import {bumpOp} from './ops-metrics';

export const workSubmissionRoutes=new Hono<{Bindings:Env}>();
workSubmissionRoutes.get('/v1/me/cards/:id/publication/operations/:operationId',async c=>{
 c.header('Cache-Control','private, no-store');
 const member=await requireMember(c);if(member.provider!=='harbor')throw new HttpError(404,'card_not_found');
 const {source,row}=await ownerCardSource(c.env,c.req.param('id')),token=c.req.header('Authorization')!.replace(/^Bearer\s+/i,'');
 const current=await workPolicyGateway.owner(c.env,'harbor',source,token);
 const operationId=c.req.param('operationId');
 const version=await c.env.DB.prepare('SELECT version_id,work_id,source_role_id,submission_id,visibility_consent,state FROM hosting_versions WHERE member_id=? AND operation_id=?').bind(member.id,operationId).first<{version_id:string;work_id:string;source_role_id:string;submission_id:string|null;visibility_consent:string|null;state:string}>();
 if(!version||version.source_role_id!==source){
  const latest=await readOwnerVisibility(c.env,source,token,row);
  return c.json({error:'publication_operation_not_found',workVisibility:latest.workVisibility},404);
 }
 if(version.submission_id){
  const review=await c.env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(version.submission_id).first<{status:string}>();
  if(!review)throw new HttpError(503,'visibility_sync_pending');
  if(review.status==='superseded'){await bumpOp(c.env.DB,'publication_recovery','read','conflict');return c.json({operation:{operationId,state:'conflict'}});}
  const card=await getCard(c.env.DB,source,'harbor');if(!card)throw new HttpError(503,'visibility_sync_pending');
  // Complete means the application was accepted, never that access is public.
  await bumpOp(c.env.DB,'publication_recovery','read','complete');
  return c.json({operation:{operationId,state:'complete'},card:{...toCard(card,c.req.query('lang')||'zh-Hant'),status:card.status}});
 }
 if(version.state==='superseded'){await bumpOp(c.env.DB,'publication_recovery','read','conflict');return c.json({operation:{operationId,state:'conflict'}});}
 if(version.state==='cancelling'){await bumpOp(c.env.DB,'publication_recovery','read','pending');throw new HttpError(503,'visibility_sync_pending');}
 let state:'pending'|'conflict'='pending';
 if(version.visibility_consent){
  const consent=JSON.parse(version.visibility_consent) as {providerEpoch:number;providerRevision:string};
  if(consent.providerEpoch===0){
   const bind=await workPolicyGateway.operation(c.env,'harbor',source,version.work_id,await policyOperationId('submission-enroll:'+version.version_id));
   if(bind){if(bind.state!=='complete'||current.workId!==version.work_id||current.epoch!==bind.epoch)state='conflict';}
   else if(current.managed||current.epoch!==0||current.policyRevision!==consent.providerRevision)state='conflict';
  }else if(!current.managed||current.workId!==version.work_id||current.epoch!==consent.providerEpoch||current.policyRevision!==consent.providerRevision)state='conflict';
 }
 await bumpOp(c.env.DB,'publication_recovery','read',state);
 return c.json({operation:{operationId,state}});
});
