import { auditStmtIfChanged } from './audit';
import { cardAuthorMemberId, type CommentCard } from './comments';
import { bumpOp } from './ops-metrics';
import { HttpError } from './types';
import { CARD_PIN_LIMIT } from '../shared/card-comment-pin';
/** The conditional update serializes slot admission in D1; no count-then-write race. */
export async function setCardCommentPin(db:D1Database,card:CommentCard,commentId:string,memberId:string,pin:boolean,now:number) {
 const action=pin?'pin':'unpin';
 try {
  if(await cardAuthorMemberId(db,card)!==memberId)throw new HttpError(403,'comment_pin_forbidden');
  const row=await db.prepare(`SELECT pinned_at FROM comments WHERE id=? AND card_id=? AND post_id IS NULL AND workshop_id IS NULL AND root_id IS NULL AND parent_id IS NULL AND status='visible' AND deleted_at IS NULL`).bind(commentId,card.id).first<{pinned_at:number|null}>();
  if(!row)throw new HttpError(404,'comment not found');
  const auditId=crypto.randomUUID();
  const writes=[
   db.prepare(`UPDATE comments SET pinned_at=CASE WHEN ?1 IS NULL THEN NULL ELSE MAX(?1,COALESCE((SELECT MAX(pinned_at)+1 FROM comments WHERE card_id=?3),?1)) END WHERE id=?2 AND card_id=?3 AND post_id IS NULL AND workshop_id IS NULL AND root_id IS NULL AND parent_id IS NULL AND status='visible' AND deleted_at IS NULL AND (?1 IS NULL AND pinned_at IS NOT NULL OR ?1 IS NOT NULL AND pinned_at IS NULL AND (SELECT COUNT(*) FROM comments WHERE card_id=?3 AND pinned_at IS NOT NULL)<?4)`).bind(pin?now:null,commentId,card.id,CARD_PIN_LIMIT),
   auditStmtIfChanged(db,{id:auditId,subjectKind:'comment',subjectId:commentId,actorMemberId:memberId,actorKind:'human',action,before:{pinned:!pin},after:{pinned:pin},operationId:auditId,now}),
  ];
  if(pin)writes.push(
   db.prepare(`INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,actor_id,card_id,extra,delivered,push_at)
    SELECT 'comment-pin:'||id,member_id,'comment_pinned','/cards/'||card_id||'#comments',?1,?2,card_id,json_object('comment',id),1,?1 FROM comments
    WHERE id=?3 AND pin_notified=0 AND member_id<>?2 AND EXISTS(SELECT 1 FROM audit_log WHERE id=?4)
    AND NOT EXISTS(SELECT 1 FROM community_preferences p WHERE p.member_id=comments.member_id AND p.notifications=0)`).bind(now,memberId,commentId,auditId),
   db.prepare(`UPDATE comments SET pin_notified=1 WHERE id=? AND EXISTS(SELECT 1 FROM audit_log WHERE id=?)`).bind(commentId,auditId),
  );
  const result=await db.batch(writes);
  if(!result[0]!.meta.changes){
   const current=await db.prepare('SELECT pinned_at,status,deleted_at FROM comments WHERE id=?').bind(commentId).first<{pinned_at:number|null;status:string;deleted_at:number|null}>();
   if(!current||current.status!=='visible'||current.deleted_at!==null)throw new HttpError(404,'comment not found');
   if(pin&&current.pinned_at===null)throw new HttpError(409,'comment_pin_limit',undefined,{limit:CARD_PIN_LIMIT});
  }
  await bumpOp(db,'comment_pin',action,'ok');
  return {isPinned:pin};
 }catch(err){
  await bumpOp(db,'comment_pin',action,err instanceof HttpError&&err.status===409?'limit':err instanceof HttpError&&err.status<500?'forbidden':'error');
  throw err;
 }
}
