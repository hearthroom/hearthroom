import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {REWARD_ELIGIBLE} from './card-reward';
import {hostingKey} from './hosting';
import {bumpOp} from './ops-metrics';
import {type Env,HttpError} from './types';

export const CARD_REWARD_PUBLICATION_PATH='/internal/community/card-reward-publication';
const encoder=new TextEncoder();
async function sameSecret(actual:string,expected:string):Promise<boolean>{
 const [a,b]=await Promise.all([actual,expected].map(value=>crypto.subtle.digest('SHA-256',encoder.encode(value))));
 return crypto.subtle.timingSafeEqual(a,b);
}

// The Provider calls this while holding the source lock. Read only D1 authority;
// never call the Provider back, project policy, or change an author's draft here.
export const cardRewardPublicationRoutes=new Hono<{Bindings:Env}>();
cardRewardPublicationRoutes.post(CARD_REWARD_PUBLICATION_PATH,bodyLimit({maxSize:4096}),async c=>{
 c.header('Cache-Control','private, no-store');
 let outcome:'allow'|'denied'|'unavailable'='denied';
 try{
  const key=hostingKey(c.env,'harbor');
  if(!key||!c.env.HARBOR_CARD_REWARDS_CLIENT_ID)throw new HttpError(503,'card_reward_publication_unavailable');
  if(!await sameSecret(c.req.header('Authorization')??'','Bearer '+key))throw new HttpError(403,'card_reward_publication_denied');
  const b=await c.req.json().catch(()=>null) as Record<string,unknown>|null;
  if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['clientId','key','sourceRoleId','accountNo','amount','publicDays','campaignRef','contentRef'].includes(k))
   ||b.clientId!==c.env.HARBOR_CARD_REWARDS_CLIENT_ID
   ||typeof b.key!=='string'||!(/^[A-Za-z0-9_-]{1,128}$/).test(b.key)
   ||typeof b.sourceRoleId!=='string'||!b.sourceRoleId||b.sourceRoleId.length>128
   ||!Number.isSafeInteger(b.accountNo)||Number(b.accountNo)<=0||!Number.isSafeInteger(b.amount)||Number(b.amount)<=0
   ||!Number.isSafeInteger(b.publicDays)||Number(b.publicDays)<1||Number(b.publicDays)>3650
   ||typeof b.campaignRef!=='string'||b.campaignRef.length>128||typeof b.contentRef!=='string'||b.contentRef.length>128)throw new HttpError(404,'card_reward_publication_not_found');
  // No unconstrained fallback: stale approval cannot authorize a new payment.
  const db=c.env.DB.withSession('first-primary');
  const row=await db.prepare(`SELECT c.approved_hosted_role_id AS approvedRoleId FROM card_rewards r
   JOIN cards c ON c.id=r.card_id JOIN (${REWARD_ELIGIBLE}) e ON e.card_id=r.card_id
    AND e.campaign_id=r.campaign_id AND e.work_key=r.work_key AND e.member_id=r.member_id AND e.author_num_id=r.recipient_account_no
   WHERE r.id=?3 AND r.status IN ('pending','blocked_insufficient') AND r.retention_role_id=?4 AND c.source_role_id=?4
    AND r.recipient_account_no=?5 AND r.amount=?6 AND r.public_days=?7 AND r.campaign_id=?8 AND r.work_key=?9
    AND c.status='approved' AND c.board_hidden=0 AND c.public_blocked=0
    AND c.approved_hosted_role_id IS NOT NULL AND c.approved_hosted_role_id<>''
    AND NOT EXISTS(SELECT 1 FROM managed_work_access p WHERE p.provider=c.provider AND p.source_role_id=c.source_role_id)`)
   .bind(Date.now(),null,b.key,b.sourceRoleId,b.accountNo,b.amount,b.publicDays,b.campaignRef,b.contentRef).first<{approvedRoleId:string}>();
  if(!row)throw new HttpError(404,'card_reward_publication_not_found');
  outcome='allow';return c.json({approvedRoleId:row.approvedRoleId});
 }catch(error){
  const known=error instanceof HttpError;
  if(!known||error.status>=500)outcome='unavailable';
  return c.json({error:known?error.message:'card_reward_publication_unavailable'},known?error.status:503);
 }finally{
  await bumpOp(c.env.DB,'card_reward_publication','admission',outcome).catch(()=>{});
 }
});
