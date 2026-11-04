import { auditStmtIfChanged } from './audit';
import { HttpError } from './types';
import type { ProviderId } from './providers';

export async function reviewLengthExempt(db:D1Database,provider:string,roleId:string):Promise<boolean>{
 return !!await db.prepare(`SELECT 1 FROM review_length_exemptions e JOIN card_numbers n ON n.num=e.card_number
  WHERE n.provider=? AND n.source_role_id=? AND e.enabled=1`).bind(provider,roleId).first();
}
export async function reviewLengthExemptForCard(db:D1Database,cardNumber:string):Promise<boolean>{
 return !!await db.prepare('SELECT 1 FROM review_length_exemptions WHERE card_number=? AND enabled=1').bind(cardNumber).first();
}
export async function exemptionCard(db:D1Database,number:string){
 if(!/^[1-9]\d{0,14}$/.test(number))throw new HttpError(404,'card_not_found');
 const card=await db.prepare('SELECT num,provider,source_role_id FROM card_numbers WHERE num=?').bind(Number(number)).first<{num:number;provider:ProviderId;source_role_id:string}>();
 if(!card)throw new HttpError(404,'card_not_found');
 return card;
}
interface State {enabled:number;revision:number;actor:string|null;reason:string;updated_at:number|null}
async function state(db:D1Database,num:number):Promise<State>{
 return await db.prepare(`SELECT e.enabled,e.revision,m.handle AS actor,e.reason,e.updated_at FROM review_length_exemptions e
  JOIN members m ON m.id=e.actor_member_id WHERE e.card_number=?`).bind(num).first<State>()??{enabled:0,revision:0,actor:null,reason:'',updated_at:null};
}
export async function readLengthExemption(db:D1Database,num:number){
 const current=await state(db,num);
 const events=await db.prepare(`SELECT a.action,a.reason,a.created_at AS at,m.handle AS actor FROM audit_log a LEFT JOIN members m ON m.id=a.actor_member_id
  WHERE a.subject_kind='review_length_exemption' AND a.subject_id=? ORDER BY a.created_at DESC,a.rowid DESC LIMIT 100`).bind(String(num)).all();
 return {cardNumber:num,enabled:!!current.enabled,revision:current.revision,updatedAt:current.updated_at,actor:current.actor,reason:current.reason,history:events.results};
}
const metric=(db:D1Database,operation:string,outcome:string)=>db.prepare(`INSERT INTO ops_metrics(metric,operation,outcome,value)
 SELECT 'review_length_exemption',?,?,1 WHERE changes()>0 ON CONFLICT(metric,operation,outcome) DO UPDATE SET value=value+1`).bind(operation,outcome);
export async function setLengthExemption(db:D1Database,num:number,actor:string,body:Record<string,unknown>,now:number):Promise<'success'|'replay'>{
 const {enabled,revision,operationId}=body;
 if(typeof enabled!=='boolean'||!Number.isSafeInteger(revision)||Number(revision)<0||typeof operationId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(operationId))throw new HttpError(400,'invalid_arguments');
 if(enabled&&(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>2000))throw new HttpError(400,'moderation_reason_required');
 const reason=enabled?(body.reason as string).trim():'';
 const action=enabled?'enable':'disable';
 const replay=async()=>{
  const row=await db.prepare('SELECT subject_kind,subject_id,action,reason,before_json,after_json FROM audit_log WHERE actor_member_id=? AND operation_id=?').bind(actor,operationId).first<{subject_kind:string;subject_id:string;action:string;reason:string;before_json:string;after_json:string}>();
  if(!row)return false;
  if(row.subject_kind!=='review_length_exemption'||row.subject_id!==String(num)||row.action!==action||row.reason!==reason||JSON.parse(row.before_json).revision!==revision)throw new HttpError(409,'review_length_exemption_conflict');
  return true;
 };
 if(await replay())return 'replay';
 const before=await state(db,num);
 if(before.revision!==revision)throw new HttpError(409,'review_length_exemption_conflict');
 const next=Number(revision)+1;
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO review_length_exemptions(card_number,enabled,revision,actor_member_id,reason,updated_at)
    SELECT ?,?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM review_length_exemptions WHERE card_number=?) ON CONFLICT(card_number) DO UPDATE SET enabled=excluded.enabled,revision=?,actor_member_id=excluded.actor_member_id,reason=excluded.reason,updated_at=excluded.updated_at WHERE review_length_exemptions.revision=?`)
    .bind(num,Number(enabled),next,actor,reason,now,revision,num,next,revision),
   auditStmtIfChanged(db,{subjectKind:'review_length_exemption',subjectId:String(num),actorMemberId:actor,actorKind:'human',action,reason,before:{enabled:!!before.enabled,revision},after:{enabled,revision:next},operationId,now}),
   metric(db,action,'success'),
  ]);
  if(!result[0].meta.changes)throw new HttpError(409,'review_length_exemption_conflict');
 }catch(error){if(await replay())return 'replay';throw error;}
 return 'success';
}
