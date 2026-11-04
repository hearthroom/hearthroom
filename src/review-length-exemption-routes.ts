import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireReviewer, reviewerRole, requireMember, providerOf } from './members';
import { exemptionCard, readLengthExemption, setLengthExemption, reviewLengthExempt } from './review-length-exemption';
import { bumpOp } from './ops-metrics';
import { hostGateway } from './hosting';
import { upstream } from './upstream';
import { HttpError, type Env } from './types';

export const lengthExemptionRoutes=new Hono<{Bindings:Env}>();
lengthExemptionRoutes.use('/v1/moderation/review-length-exemptions/*',bodyLimit({maxSize:16000}));
for(const method of ['get','post'] as const)lengthExemptionRoutes[method]('/v1/moderation/review-length-exemptions/:number',async c=>{
 c.header('Cache-Control','private, no-store');
 let operation='read';
 let committed=false;
 try{
  const body=method==='post'?await c.req.json<Record<string,unknown>>().catch(()=>null):null;
  if(method==='post')operation=body?.enabled===false?'disable':'enable';
  const member=await requireReviewer(c);
  const role=await reviewerRole(c.env.DB,member.id);
  if(role!=='manager'&&role!=='owner')throw new HttpError(403,'moderation_manager_required');
  const card=await exemptionCard(c.env.DB,c.req.param('number'));
  if(method==='post'){
   if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'invalid_arguments');
   const result=await setLengthExemption(c.env.DB,card.num,member.id,body,Date.now());
   committed=true;
   if(result==='replay')await bumpOp(c.env.DB,'review_length_exemption',operation,'replay');
  }else await bumpOp(c.env.DB,'review_length_exemption','read','success');
  return c.json(await readLengthExemption(c.env.DB,card.num));
 }catch(error){
  if(!committed)await bumpOp(c.env.DB,'review_length_exemption',operation,error instanceof HttpError?(error.status===409?'conflict':'denied'):'error');
  if(error instanceof HttpError)throw error;
  // D1 errors can embed bound values. Keep private audit reasons out of generic error logs.
  throw new HttpError(503,'review_length_exemption_unavailable');
 }
});
lengthExemptionRoutes.get('/v1/me/review-length-exemptions/:roleId',async c=>{
 c.header('Cache-Control','private, no-store');
 await requireMember(c);
 const provider=providerOf(c),token=c.req.header('Authorization')!.replace(/^Bearer\s+/i,'');
 const me=await upstream.fetchMe(c.env,token,provider);
 const roleId=c.req.param('roleId');
 const role=await hostGateway.read(c.env,token,roleId,provider);
 if(role.roleId!==roleId||role.authorNumId!==me.accountNumId)throw new HttpError(404,'card_not_found');
 return c.json({enabled:await reviewLengthExempt(c.env.DB,provider,roleId)});
});
