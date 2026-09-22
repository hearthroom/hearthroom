import { HttpError, pickLocale, type Localized } from '../types';
import { CLAIM_TTL_MS, STAMPS_REQUIRED } from '../review';
const MINUTE=60_000, DAY=86_400_000;
export const REMINDER_MS=30*MINUTE;
// Uses the query's n alias. Both list and delivery recheck the same eligibility.
export const reviewNotificationEligible = `(n.review_submission IS NULL OR EXISTS (
 SELECT 1 FROM review_submissions s JOIN reviewers r ON r.member_id=s.claimed_by AND r.revoked_at IS NULL
 JOIN cards c ON c.id=s.card_id
 WHERE s.id=n.review_submission AND s.status='pending' AND c.status<>'unshared' AND c.public_blocked=0
 AND s.claimed_by=n.member_id AND s.claim_generation=n.review_generation
 AND s.claimed_at > ?-${CLAIM_TTL_MS}))`;
export interface ReviewProjection {
 title:string; status:string; kind:string; adult:boolean; submittedAt:number;
 approvals:number; required:number; claimant:string|null; expiresAt:number|null; path:string;
}
interface Row {
 id:string; kind:'first'|'re'; status:string; nsfw:number; submitted_at:number;
 claimed_by:string|null; claimed_at:number|null; claim_generation:string;
 names:string|null; display_name:string|null; handle:string|null; reviewer:string|null;
 card_status:string|null; public_blocked:number|null; approvals:number; waiting_since:number;
}
const select=`SELECT s.*,c.status AS card_status,c.public_blocked,
 COALESCE(json_extract(v.public_role,'$.names'),c.names) AS names,m.display_name,m.handle,
 r.member_id AS reviewer,
 (SELECT COUNT(*) FROM review_stamps st WHERE st.submission_id=s.id AND st.verdict='approve') AS approvals,
 COALESCE((SELECT MAX(created_at) FROM review_stamps st WHERE st.submission_id=s.id AND st.verdict='approve'),s.submitted_at) AS waiting_since
 FROM review_submissions s LEFT JOIN cards c ON c.id=s.card_id
 LEFT JOIN hosting_versions v ON v.submission_id=s.id
 LEFT JOIN members m ON m.id=s.claimed_by
 LEFT JOIN reviewers r ON r.member_id=s.claimed_by AND r.revoked_at IS NULL`;
function live(r:Row,now:number){return r.status==='pending'&&!!r.reviewer&&!!r.claimed_by&&r.claimed_at!==null&&r.claimed_at+CLAIM_TTL_MS>now;}
function project(r:Row,now:number,lang:string):ReviewProjection {
 const invalid=!r.card_status||r.card_status==='unshared'||r.public_blocked;
 return {title:r.nsfw?'':(pickLocale(JSON.parse(r.names??'{}') as Localized,lang)||'').slice(0,180),
 status:invalid?'superseded':r.status,kind:r.kind,adult:!!r.nsfw,submittedAt:r.submitted_at,
 approvals:r.approvals,required:STAMPS_REQUIRED[r.kind],
 claimant:!invalid&&live(r,now)?(r.display_name||r.handle||'Reviewer').slice(0,80):null,
 expiresAt:!invalid&&live(r,now)?r.claimed_at!+CLAIM_TTL_MS:null,path:'/review/'+encodeURIComponent(r.id)};
}
export async function maintainReviewNotifications(db:D1Database,now:number){
 await db.batch([
  // Revocation is not a new grant; invalid ownership is released, never reassigned.
  db.prepare(`UPDATE review_submissions SET claimed_by=NULL,claimed_at=NULL,claim_generation=''
   WHERE claimed_by IS NOT NULL AND (claimed_at<=? OR NOT EXISTS(SELECT 1 FROM reviewers r WHERE r.member_id=claimed_by AND r.revoked_at IS NULL))`).bind(now-CLAIM_TTL_MS),
  db.prepare(`INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,review_submission,review_generation,review_link_version)
   SELECT 'review-reminder:'||s.id||':'||s.claim_generation,s.claimed_by,'review_reminder','/review/'||s.id,?,s.id,s.claim_generation,l.version
   FROM review_submissions s JOIN reviewers r ON r.member_id=s.claimed_by AND r.revoked_at IS NULL
   JOIN cards c ON c.id=s.card_id AND c.status<>'unshared' AND c.public_blocked=0
   JOIN community_preferences p ON p.member_id=s.claimed_by AND p.notifications=1
   LEFT JOIN discord_links l ON l.member_id=s.claimed_by AND l.state='active'
   WHERE s.status='pending' AND s.claimed_at<=? AND s.claimed_at>? AND s.claim_generation<>''`).bind(now,now-REMINDER_MS,now-CLAIM_TTL_MS),
  db.prepare('DELETE FROM review_deliveries WHERE terminal_at IS NOT NULL AND terminal_at<?').bind(now-30*DAY),
 ]);
 // One digest per Taipei calendar day, starting at 10:00. Never replay yesterday's digest.
 const taipei=new Date(now+8*60*MINUTE), day=taipei.toISOString().slice(0,10);
 if(taipei.getUTCHours()>=10) await db.prepare(`INSERT OR IGNORE INTO review_deliveries(id,kind,updated_at)
  SELECT ?,'digest',? WHERE EXISTS(SELECT 1 FROM review_submissions s JOIN cards c ON c.id=s.card_id
  WHERE s.status='pending' AND c.status<>'unshared' AND c.public_blocked=0 AND
  COALESCE((SELECT MAX(created_at) FROM review_stamps st WHERE st.submission_id=s.id AND st.verdict='approve'),s.submitted_at)<=?)`).bind('digest:'+day,now,now-DAY).run();
 await db.prepare("DELETE FROM review_deliveries WHERE kind='digest' AND id<>?").bind('digest:'+day).run();
}
export async function pendingReviewDeliveries(db:D1Database,now:number){
 await maintainReviewNotifications(db,now);
 const jobs=await db.prepare('SELECT id FROM review_deliveries WHERE due_at<=? AND lease_until<=? ORDER BY due_at,updated_at,id LIMIT 20').bind(now,now).all<{id:string}>();
 const stats=await db.prepare('SELECT COUNT(*) AS pending,MIN(updated_at) AS oldest FROM review_deliveries WHERE delivered_revision<revision').first<{pending:number;oldest:number|null}>();
 return {version:2,jobs:jobs.results,pending:stats?.pending??0,oldestAt:stats?.oldest??null};
}
interface Delivery {id:string;kind:string;submission_id:string|null;revision:number;delivered_revision:number;channel_id:string|null;message_id:string|null;lease:string;updated_at:number}
export async function leaseReviewDelivery(db:D1Database,id:string,channel:string,lang:string,now:number){
 if(!/^\d{17,20}$/.test(channel))throw new HttpError(400,'community_input');
 const token=crypto.randomUUID();
 const d=await db.prepare(`UPDATE review_deliveries SET lease=?,lease_until=? WHERE id=? AND due_at<=? AND lease_until<=?
  RETURNING id,kind,submission_id,revision,delivered_revision,channel_id,message_id,lease,updated_at`).bind(token,now+2*MINUTE,id,now,now).first<Delivery>();
 if(!d)throw new HttpError(409,'review_delivery_busy');
 const result=await reviewDeliveryProjection(db,d,lang,now);
 return {...result,id:d.id,kind:d.kind,revision:d.revision,changed:d.delivered_revision<d.revision,lease:d.lease,messageId:d.channel_id===channel?d.message_id:null,updatedAt:d.updated_at};
}
async function reviewDeliveryProjection(db:D1Database,d:Delivery,lang:string,now:number){
 if(d.kind==='main'){
  const row=await db.prepare(select+' WHERE s.id=?').bind(d.submission_id).first<Row>();
  return {projection:row?project(row,now,lang):{title:'',status:'superseded',kind:'first',adult:false,submittedAt:now,approvals:0,required:2,claimant:null,expiresAt:null,path:'/review/'+encodeURIComponent(d.submission_id??d.id)},digest:null};
 }
 // Aggregate across the entire queue; only the displayed examples are capped.
 const rows=await db.prepare(`SELECT COUNT(*) AS total,
 SUM(CASE WHEN s.claimed_by IS NOT NULL AND s.claimed_at>? AND EXISTS(SELECT 1 FROM reviewers r WHERE r.member_id=s.claimed_by AND r.revoked_at IS NULL) THEN 1 ELSE 0 END) AS claimed,
 SUM(CASE WHEN (s.claimed_by IS NULL OR s.claimed_at<=?) AND EXISTS(SELECT 1 FROM review_stamps st WHERE st.submission_id=s.id AND st.verdict='approve') THEN 1 ELSE 0 END) AS second
 FROM review_submissions s JOIN cards c ON c.id=s.card_id WHERE s.status='pending' AND c.status<>'unshared' AND c.public_blocked=0
 AND COALESCE((SELECT MAX(created_at) FROM review_stamps st WHERE st.submission_id=s.id AND st.verdict='approve'),s.submitted_at)<=?`).bind(now-CLAIM_TTL_MS,now-CLAIM_TTL_MS,now-DAY).first<{total:number;claimed:number;second:number}>();
 const oldest=await db.prepare(select+" WHERE s.status='pending' AND c.status<>'unshared' AND c.public_blocked=0 AND COALESCE((SELECT MAX(created_at) FROM review_stamps st WHERE st.submission_id=s.id AND st.verdict='approve'),s.submitted_at)<=? ORDER BY waiting_since,s.id LIMIT 5").bind(now-DAY).all<Row>();
 return {projection:null,digest:{total:rows?.total??0,claimed:rows?.claimed??0,second:rows?.second??0,items:oldest.results.map(r=>({...project(r,now,lang),waitingSince:r.waiting_since,escalated:r.waiting_since<=now-2*DAY}))}};
}
export async function checkReviewDelivery(db:D1Database,id:string,lease:string,revision:number,now:number){
 return !!await db.prepare('SELECT 1 FROM review_deliveries WHERE id=? AND lease=? AND lease_until>? AND revision=?').bind(id,lease,now,revision).first();
}
export async function finishReviewDelivery(db:D1Database,b:Record<string,unknown>,now:number){
 const id=String(b.id),lease=String(b.lease),revision=Number(b.revision);
 const current=await db.prepare('SELECT revision,lease_until FROM review_deliveries WHERE id=? AND lease=?').bind(id,lease).first<{revision:number;lease_until:number}>();
 if(!current)return {accepted:false};
 if(b.failed===true){await db.prepare('UPDATE review_deliveries SET lease_until=0,lease=NULL,due_at=CASE WHEN revision=? THEN ? ELSE 0 END WHERE id=? AND lease=?').bind(revision,now+MINUTE,id,lease).run();return {accepted:true};}
 if(!/^\d{17,20}$/.test(String(b.messageId))||!/^\d{17,20}$/.test(String(b.channel)))throw new HttpError(400,'community_input');
 if(current.revision!==revision||current.lease_until<=now){
  await db.prepare('UPDATE review_deliveries SET channel_id=?,message_id=?,lease=NULL,lease_until=0,due_at=0 WHERE id=? AND lease=?').bind(String(b.channel),String(b.messageId),id,lease).run();
  return {accepted:false};
 }
 const d=await db.prepare('SELECT kind,submission_id FROM review_deliveries WHERE id=?').bind(id).first<{kind:string;submission_id:string|null}>();
 const s=d?.submission_id?await db.prepare(select+' WHERE s.id=?').bind(d.submission_id).first<Row>():null;
 const terminal=d?.kind==='digest'||!s||project(s,now,'en').status!=='pending';
 const due=terminal?now+DAY:Math.min(now+10*MINUTE,s?.claimed_at&&live(s,now)?s.claimed_at+CLAIM_TTL_MS:now+10*MINUTE);
 const r=await db.prepare(`UPDATE review_deliveries SET channel_id=?,message_id=?,delivered_revision=?,lease=NULL,lease_until=0,due_at=?,terminal_at=CASE WHEN ? THEN COALESCE(terminal_at,?) ELSE NULL END
 WHERE id=? AND lease=? AND revision=?`).bind(String(b.channel),String(b.messageId),revision,d?.kind==='digest'?Number.MAX_SAFE_INTEGER:due,terminal?1:0,now,id,lease,revision).run();
 return {accepted:r.meta.changes===1};
}
