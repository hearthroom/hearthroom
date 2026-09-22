import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireReviewer, requireMember, isReviewer, memberNsfw } from './members';
import { pickLocale, HttpError, type Env, type Localized } from './types';

export const moderationRoutes = new Hono<{ Bindings: Env }>();
type Action = 'delist' | 'suspend' | 'restore_listing' | 'restore_public';
type StaffRole = 'reviewer' | 'manager' | 'owner';
interface CaseRow { card_number:number;nsfw:number;public_evidence:string;id:string; provider:string; source_role_id:string; version_id:string; title:string; author_member_id:string; action:Action; reason:string; created_by:string; status:string; created_at:number; decided_at:number|null; resolution:string|null }
interface ManagedCard { featured_at:number|null; summaries:string;avatar_url:string|null;search_text:string;card_number:number;id:string; provider:string; source_role_id:string; approved_version_id:string|null; reviewed_hash:string; names:string; tags:string; status:string; board_hidden:number; public_blocked:number; nsfw:number; author_member_id:string }
const CARD = `SELECT c.*,(SELECT num FROM card_numbers WHERE provider=c.provider AND source_role_id=c.source_role_id) AS card_number,COALESCE(w.member_id,ac.owner_member_id,ai.member_id,'') AS author_member_id FROM cards c
 LEFT JOIN works w ON w.source_provider=c.provider AND w.source_role_id=c.source_role_id
 LEFT JOIN member_connections ac ON ac.provider=c.provider AND ac.external_id=CAST(c.author_num_id AS TEXT)
 LEFT JOIN member_identities ai ON ai.provider=c.provider AND ai.external_id=CAST(c.author_num_id AS TEXT)`;
const reasonOf = (v:unknown) => { if(typeof v!=='string'||!v.trim()||v.length>2000)throw new HttpError(400,'moderation_reason_required');return v.trim(); };
const operationOf = (v:unknown) => { if(typeof v!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(v))throw new HttpError(400,'invalid_arguments');return v; };
async function roleOf(db:D1Database,id:string):Promise<StaffRole>{return (await db.prepare('SELECT role FROM reviewers WHERE member_id=? AND revoked_at IS NULL').bind(id).first<{role:StaffRole}>())?.role ?? 'reviewer';}
async function manager(db:D1Database,id:string){if(await roleOf(db,id)==='reviewer')throw new HttpError(403,'moderation_manager_required');}
async function cardOf(db:D1Database,id:string){const row=await db.prepare(CARD+' WHERE c.id=?').bind(id).first<ManagedCard>();if(!row)throw new HttpError(404,'card not found');return row;}
async function caseOf(db:D1Database,id:string){const row=await db.prepare('SELECT * FROM moderation_cases WHERE id=?').bind(id).first<CaseRow>();if(!row)throw new HttpError(404,'not_found');return row;}
async function guardCard(db:D1Database,card:ManagedCard,memberId:string){
 if(card.author_member_id===memberId)throw new HttpError(403,'moderation_self_review');
 if(card.nsfw===1&&(await memberNsfw(db,memberId)).ageVerifiedAt===null)throw new HttpError(403,'age_verification_required');
}
async function guardCase(db:D1Database,row:CaseRow,memberId:string){
 if(row.nsfw===1&&(await memberNsfw(db,memberId)).ageVerifiedAt===null)throw new HttpError(403,'age_verification_required');
 if(row.author_member_id===memberId)throw new HttpError(403,'moderation_self_review');
 const card=await db.prepare(CARD+' WHERE c.provider=? AND c.source_role_id=?').bind(row.provider,row.source_role_id).first<ManagedCard>();
 if(card)await guardCard(db,card,memberId);
}
const publicCase=(r:CaseRow,memberId:string)=>({id:r.id,cardNumber:r.card_number,action:r.action,title:r.title,reason:r.reason,status:r.status,createdAt:r.created_at,decidedAt:r.decided_at,version:r.version_id,createdByMe:r.created_by===memberId,resolution:r.resolution});
const projection=(r:ManagedCard,lang:string)=>({id:r.id,provider:r.provider,featured:r.featured_at!=null,name:pickLocale(JSON.parse(r.names) as Localized,lang),tags:JSON.parse(r.tags) as string[],status:r.status,boardHidden:!!r.board_hidden,publicBlocked:!!r.public_blocked,version:r.approved_version_id||r.reviewed_hash});
async function mutate<T>(run:()=>Promise<T>):Promise<T>{try{return await run();}catch(e){if(e instanceof HttpError)throw e;if(/moderation_conflict|UNIQUE constraint/.test(String(e)))throw new HttpError(409,'moderation_conflict');throw e;}}

moderationRoutes.use('/v1/moderation/*',bodyLimit({maxSize:16000}));
moderationRoutes.use('/v1/moderation/*',async(c,next)=>{
 c.header('Cache-Control','private, no-store');
 await next();
 const op=c.req.path.endsWith('/vote')?'vote':c.req.path.endsWith('/resolve')?'resolve':c.req.path.endsWith('/tags')?'tags':c.req.path.endsWith('/compensation')?'compensation':c.req.path.endsWith('/staff')?'staff':c.req.method==='POST'?'propose':'read';
 const outcome=c.res.status<400?'success':c.res.status<500?'denied':'error';
 try{await c.env.DB.prepare('INSERT INTO moderation_metrics VALUES(?,?,1) ON CONFLICT(operation,outcome) DO UPDATE SET value=value+1').bind(op,outcome).run();}catch{console.warn('Moderation request metric unavailable');}
});
export async function reviewSummary(db:D1Database,member:{id:string}){
 if(!await isReviewer(db,member.id))return {reviewer:false,pending:0,cases:0,reviews:0};
 const role=await roleOf(db,member.id);const age=(await memberNsfw(db,member.id)).ageVerifiedAt!==null;
 const cases=await db.prepare(`SELECT count(*) n FROM moderation_cases k
 LEFT JOIN cards c ON c.provider=k.provider AND c.source_role_id=k.source_role_id
 WHERE k.author_member_id<>? AND (k.nsfw=0 OR ?) AND k.created_by<>?
 AND NOT EXISTS(SELECT 1 FROM moderation_votes v WHERE v.case_id=k.id AND v.member_id=?)
 AND (k.status='pending' OR (k.status='disputed' AND ?))`).bind(member.id,Number(age),member.id,member.id,Number(role!=='reviewer')).first<{n:number}>();
 const reviews=await db.prepare(`SELECT count(*) n FROM review_submissions s JOIN cards c ON c.id=s.card_id
 WHERE s.status='pending' AND (s.nsfw=0 OR ?) AND (s.claimed_by IS NULL OR s.claimed_by=? OR s.claimed_at<?)
 AND NOT EXISTS(SELECT 1 FROM review_stamps st WHERE st.submission_id=s.id AND st.member_id=?)
 AND NOT EXISTS(SELECT 1 FROM member_identities i WHERE i.member_id=? AND i.provider=c.provider AND i.external_id=CAST(c.author_num_id AS TEXT))
 AND NOT EXISTS(SELECT 1 FROM member_connections i WHERE i.owner_member_id=? AND i.provider=c.provider AND i.external_id=CAST(c.author_num_id AS TEXT))`).bind(Number(age),member.id,Date.now()-45*60*1000,member.id,member.id,member.id).first<{n:number}>();
 return {reviewer:true,role,cases:cases?.n??0,reviews:reviews?.n??0,pending:(cases?.n??0)+(reviews?.n??0)};
}
moderationRoutes.get('/v1/moderation/summary',async c=>c.json(await reviewSummary(c.env.DB,await requireMember(c))));
moderationRoutes.get('/v1/moderation/cases',async c=>{
 const member=await requireReviewer(c);const role=await roleOf(c.env.DB,member.id);const age=(await memberNsfw(c.env.DB,member.id)).ageVerifiedAt!==null;
 const history=c.req.query('history')==='1';const offset=Math.max(0,Math.floor(Number(c.req.query('offset'))||0));
 const rows=await c.env.DB.prepare(`SELECT * FROM moderation_cases WHERE (nsfw=0 OR ?) AND ${history?"status IN ('confirmed','dismissed')":"status IN ('pending','disputed')"} ORDER BY (action='suspend') DESC,created_at DESC LIMIT 31 OFFSET ?`).bind(Number(age),offset).all<CaseRow>();
 const items=await Promise.all(rows.results.slice(0,30).map(async r=>({...publicCase(r,member.id),
   canVote:r.status==='pending'&&r.author_member_id!==member.id&&!await c.env.DB.prepare('SELECT 1 FROM moderation_votes WHERE case_id=? AND member_id=?').bind(r.id,member.id).first(),
   canResolve:role!=='reviewer'&&r.status==='disputed'&&r.author_member_id!==member.id&&r.created_by!==member.id&&!await c.env.DB.prepare('SELECT 1 FROM moderation_votes WHERE case_id=? AND member_id=?').bind(r.id,member.id).first(),
   votes:(await c.env.DB.prepare('SELECT vote,reason,created_at AS at FROM moderation_votes WHERE case_id=? ORDER BY created_at').bind(r.id).all()).results,
 })));
 return c.json({items,hasNext:rows.results.length>30});
});
moderationRoutes.get('/v1/moderation/cards',async c=>{
 const member=await requireReviewer(c);const age=(await memberNsfw(c.env.DB,member.id)).ageVerifiedAt!==null;const q=(c.req.query('q')??'').trim().slice(0,100);const offset=Math.max(0,Math.floor(Number(c.req.query('offset'))||0));
 const rows=await c.env.DB.prepare(CARD+` WHERE c.status='approved' AND (c.nsfw=0 OR ?) AND (?='' OR c.names LIKE ? ESCAPE '\\' OR c.id=? OR EXISTS(SELECT 1 FROM card_numbers n WHERE n.provider=c.provider AND n.source_role_id=c.source_role_id AND CAST(n.num AS TEXT)=?)) ORDER BY c.registered_at DESC LIMIT 31 OFFSET ?`).bind(Number(age),q,'%'+q.replace(/[\\%_]/g,'\\$&')+'%',q,q,offset).all<ManagedCard>();
 return c.json({items:rows.results.slice(0,30).map(r=>projection(r,c.req.query('lang')||'zh-Hant')),hasNext:rows.results.length>30});
});
moderationRoutes.get('/v1/moderation/cards/:id',async c=>{
 const member=await requireReviewer(c);const db=c.env.DB;const card=await cardOf(db,c.req.param('id'));
 if(card.nsfw===1&&(await memberNsfw(db,member.id)).ageVerifiedAt===null)throw new HttpError(403,'age_verification_required');
 const cases=await db.prepare('SELECT * FROM moderation_cases WHERE provider=? AND source_role_id=? ORDER BY created_at DESC LIMIT 100').bind(card.provider,card.source_role_id).all<CaseRow>();
 const events=await db.prepare('SELECT action,reason,before_value AS beforeValue,after_value AS afterValue,created_at AS at FROM moderation_events WHERE provider=? AND source_role_id=? ORDER BY created_at DESC LIMIT 100').bind(card.provider,card.source_role_id).all();
 const reviews=await db.prepare('SELECT id,kind,status,submitted_at AS submittedAt,decided_at AS decidedAt,note,content_hash AS version FROM review_submissions WHERE card_id=? ORDER BY submitted_at DESC LIMIT 100').bind(card.id).all();
 return c.json({card:projection(card,c.req.query('lang')||'zh-Hant'),cases:cases.results.map(r=>publicCase(r,member.id)),events:events.results,reviews:reviews.results});
});
moderationRoutes.get('/v1/moderation/cases/:id/evidence',async c=>{
 const member=await requireReviewer(c);const row=await caseOf(c.env.DB,c.req.param('id'));
 if(row.nsfw===1&&(await memberNsfw(c.env.DB,member.id)).ageVerifiedAt===null)throw new HttpError(403,'age_verification_required');
 return c.json({...JSON.parse(row.public_evidence),cardNumber:row.card_number,version:row.version_id});
});
moderationRoutes.post('/v1/moderation/cases',async c=>{
 const member=await requireReviewer(c);const db=c.env.DB;const body=await c.req.json<Record<string,unknown>>();
 const reason=reasonOf(body.reason);const op=operationOf(body.operationId);const action=body.action as Action;
 if(!['delist','suspend','restore_listing','restore_public'].includes(action))throw new HttpError(400,'invalid_arguments');
 const card=await cardOf(db,String(body.cardId));await guardCard(db,card,member.id);
 const existing=await db.prepare('SELECT * FROM moderation_cases WHERE created_by=? AND operation_id=?').bind(member.id,op).first<CaseRow>();
 if(existing){if(existing.provider!==card.provider||existing.source_role_id!==card.source_role_id||existing.action!==action||existing.reason!==reason)throw new HttpError(409,'moderation_conflict');return c.json(publicCase(existing,member.id));}
 if(card.status!=='approved'||(action==='delist'&&card.board_hidden)||(action==='suspend'&&card.public_blocked)||(action==='restore_listing'&&!card.board_hidden)||(action==='restore_public'&&!card.public_blocked))throw new HttpError(409,'moderation_conflict');
 const frozen=card.approved_version_id?await db.prepare('SELECT public_role FROM hosting_versions WHERE version_id=?').bind(card.approved_version_id).first<{public_role:string}>():null;
 const published=frozen?JSON.parse(frozen.public_role):null;
 const evidence=JSON.stringify({names:JSON.parse(card.names),summaries:JSON.parse(card.summaries),tags:JSON.parse(card.tags),avatarUrl:card.avatar_url,nsfw:!!card.nsfw,welcome:published?.welcome??'',searchText:card.search_text??''});
 const id=crypto.randomUUID();const now=Date.now();
 await mutate(()=>db.batch([
  db.prepare('INSERT OR IGNORE INTO moderation_state(provider,source_role_id) VALUES(?,?)').bind(card.provider,card.source_role_id),
  ... (action==='suspend'?[db.prepare("UPDATE moderation_cases SET status='dismissed',decided_at=?,resolution='Superseded by urgent suspension' WHERE provider=? AND source_role_id=? AND status IN ('pending','disputed') AND action IN ('delist','restore_listing')").bind(now,card.provider,card.source_role_id)]:[]),
  db.prepare('INSERT INTO moderation_cases(id,provider,source_role_id,version_id,title,author_member_id,action,reason,created_by,operation_id,created_at,card_number,nsfw,public_evidence) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,card.provider,card.source_role_id,card.approved_version_id||card.reviewed_hash,pickLocale(JSON.parse(card.names),'zh-Hant'),card.author_member_id,action,reason,member.id,op,now,card.card_number,card.nsfw,evidence),
  db.prepare("INSERT INTO moderation_votes VALUES(?,?,'confirm',?,?)").bind(id,member.id,reason,now),
 ]));
 return c.json(publicCase(await caseOf(db,id),member.id),201);
});
moderationRoutes.post('/v1/moderation/cases/:id/vote',async c=>{
 const member=await requireReviewer(c);const db=c.env.DB;const row=await caseOf(db,c.req.param('id'));await guardCase(db,row,member.id);
 const b=await c.req.json<Record<string,unknown>>();const reason=reasonOf(b.reason);
 if(b.vote!=='confirm'&&b.vote!=='oppose')throw new HttpError(400,'invalid_arguments');
 await mutate(()=>db.prepare('INSERT INTO moderation_votes VALUES(?,?,?,?,?)').bind(row.id,member.id,b.vote,reason,Date.now()).run());
 return c.json(publicCase(await caseOf(db,row.id),member.id));
});
moderationRoutes.post('/v1/moderation/cases/:id/resolve',async c=>{
 const member=await requireReviewer(c);const db=c.env.DB;await manager(db,member.id);
 const row=await caseOf(db,c.req.param('id'));await guardCase(db,row,member.id);
 if(row.created_by===member.id||await db.prepare('SELECT 1 FROM moderation_votes WHERE case_id=? AND member_id=?').bind(row.id,member.id).first())throw new HttpError(403,'moderation_independent_required');
 const b=await c.req.json<Record<string,unknown>>();const reason=reasonOf(b.reason);
 if(b.decision!=='confirm'&&b.decision!=='dismiss')throw new HttpError(400,'invalid_arguments');
 const result=await mutate(()=>db.prepare("UPDATE moderation_cases SET status=?,resolution=?,resolved_by=?,decided_at=? WHERE id=? AND status='disputed'").bind(b.decision==='confirm'?'confirmed':'dismissed',reason,member.id,Date.now(),row.id).run());
 if(!result.meta.changes)throw new HttpError(409,'moderation_conflict');
 return c.json(publicCase(await caseOf(db,row.id),member.id));
});

export async function moderationMetrics(db:D1Database):Promise<string>{
 const rows=await db.prepare('SELECT operation,outcome,value FROM moderation_metrics ORDER BY operation,outcome').all<{operation:string;outcome:string;value:number}>();
 return '# HELP hearthroom_moderation_requests_total Community moderation requests.\n# TYPE hearthroom_moderation_requests_total counter\n'+rows.results.filter(r=>/^(read|propose|vote|resolve|tags|compensation|staff)$/.test(r.operation)&&/^(success|denied|error)$/.test(r.outcome)).map(r=>`hearthroom_moderation_requests_total{operation="${r.operation}",outcome="${r.outcome}"} ${r.value}`).join('\n')+'\n';
}

for(const action of ['tags','compensation'] as const)moderationRoutes.post(`/v1/moderation/cards/:id/${action}`,async c=>{
 const member=await requireReviewer(c);const db=c.env.DB;await manager(db,member.id);
 const card=await cardOf(db,c.req.param('id'));await guardCard(db,card,member.id);
 const b=await c.req.json<Record<string,unknown>>();const reason=reasonOf(b.reason);const op=operationOf(b.operationId);
 let after:string;
 if(action==='tags'){
  if(!Array.isArray(b.tags)||b.tags.length>30||b.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>60))throw new HttpError(400,'invalid_arguments');
  after=JSON.stringify([...new Set((b.tags as string[]).map(t=>t.trim()))]);
 }else{
  if(!['day','week','month'].includes(String(b.board))||typeof b.hours!=='number'||!Number.isFinite(b.hours)||b.hours<=0||b.hours>720)throw new HttpError(400,'invalid_arguments');
  after=JSON.stringify({board:b.board,milliseconds:Math.round(b.hours*3600000)});
 }
 const existing=await db.prepare('SELECT * FROM moderation_events WHERE actor=? AND operation_id=?').bind(member.id,op).first<{action:string;provider:string;source_role_id:string;after_value:string;reason:string}>();
 if(existing){if(existing.action!==action||existing.provider!==card.provider||existing.source_role_id!==card.source_role_id||existing.after_value!==after||existing.reason!==reason)throw new HttpError(409,'moderation_conflict');return c.json({ok:true});}
 const id=crypto.randomUUID();const statements=[
  db.prepare('INSERT OR IGNORE INTO moderation_state(provider,source_role_id) VALUES(?,?)').bind(card.provider,card.source_role_id),
  db.prepare('INSERT INTO moderation_events(id,provider,source_role_id,actor,action,reason,before_value,after_value,created_at,operation_id) SELECT ?,provider,source_role_id,?,?,?,tags,?,?,? FROM cards WHERE id=?').bind(id,member.id,action,reason,after,Date.now(),op,card.id),
 ];
 if(action==='tags')statements.push(db.prepare('UPDATE moderation_state SET tags_override=? WHERE provider=? AND source_role_id=?').bind(after,card.provider,card.source_role_id));
 else{const comp=JSON.parse(after) as {board:string;milliseconds:number};statements.push(db.prepare('INSERT INTO moderation_compensation VALUES(?,?,?,?,?)').bind(id,card.provider,card.source_role_id,comp.board,comp.milliseconds));}
 await mutate(()=>db.batch(statements));return c.json({ok:true});
});
