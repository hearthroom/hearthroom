import {Hono} from 'hono';
import {requireMember} from './members';
import {ownerCardSource,readOwnerVisibility} from './work-sharing';
import {bumpOp} from './ops-metrics';
import {parseReviewReasons} from '../shared/review-reasons';
import {type Env,HttpError} from './types';

/** Author metadata only. Never select a review snapshot, stamp, claim or private document. */
export const reviewStatusRoutes=new Hono<{Bindings:Env}>();
reviewStatusRoutes.get('/v1/me/cards/:id/review-status',async c=>{
 c.header('Cache-Control','private, no-store');
 try{
  const member=await requireMember(c);
  if(member.provider!=='harbor')throw new HttpError(404,'card_not_found');
  const {source,row}=await ownerCardSource(c.env,c.req.param('id'));
  const token=c.req.header('Authorization')!.replace(/^Bearer\s+/i,'');
  // Same issuer owner/read-scope check as author visibility. A public card is not proof of ownership.
  const {workVisibility}=await readOwnerVisibility(c.env,source,token,row);
  const latest=row?await c.env.DB.prepare(`SELECT s.id,s.kind,s.status,s.submitted_at AS submittedAt,
   CASE WHEN s.status='rejected' THEN NULLIF(s.note,'') ELSE NULL END AS rejectionReason,
   CASE WHEN s.status='rejected' THEN s.reject_reasons ELSE NULL END AS rejectionCodes,
   v.version_id AS versionId,v.update_kind AS updateKind,
   CASE WHEN v.update_kind='minor' THEN 1 WHEN v.update_kind='major' THEN 0 ELSE NULL END AS silentUpdate
   FROM review_submissions s LEFT JOIN hosting_versions v ON v.submission_id=s.id
   LEFT JOIN works w ON w.id=v.work_id
   WHERE s.provider='harbor' AND s.card_id=? AND (s.source_role_id=? OR v.source_role_id=?)
    AND (v.version_id IS NULL OR (v.member_id=? AND w.member_id=?))
   ORDER BY s.submitted_at DESC,s.rowid DESC LIMIT 1`).bind(row.id,source,source,member.id,member.id).first<{
    id:string;kind:string;status:string;submittedAt:number;rejectionReason:string|null;rejectionCodes:string|null;
    versionId:string|null;updateKind:string|null;silentUpdate:number|null;
   }>():null;
  const publicVersionId=row?.status==='approved'&&workVisibility.effectiveAccess==='public'?row.approved_version_id:null;
  await bumpOp(c.env.DB,'review_status','read','success');
  // rejectionReasonCodes：審卡 V2 的駁回理由代碼（新增欄位，舊用戶端照舊讀 rejectionReason）
  const {rejectionCodes,...rest}=latest??{} as Record<string,unknown>;
  return c.json({publicVersionId:publicVersionId??null,latestSubmission:latest?{...rest,rejectionReasonCodes:parseReviewReasons(rejectionCodes as string|null),silentUpdate:latest.silentUpdate===null?null:latest.silentUpdate===1}:null});
 }catch(error){
  await bumpOp(c.env.DB,'review_status','read',error instanceof HttpError&&[401,403,404].includes(error.status)?'denied':'error');
  throw error;
 }
});

/** The receipt names the accepted submission, including its current state on an idempotent replay. */
export async function submissionReceipt(db:D1Database,versionId:string){
 const receipt=await db.prepare(`SELECT s.id AS submissionId,s.status AS submissionStatus
  FROM hosting_versions v JOIN review_submissions s ON s.id=v.submission_id WHERE v.version_id=?`)
  .bind(versionId).first<{submissionId:string;submissionStatus:string}>();
 if(!receipt)throw new HttpError(503,'visibility_sync_pending');
 return receipt;
}
