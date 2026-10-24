import {Hono} from 'hono';
import {CARD_NUMBER,getCard,type CardRow} from './cards';
import {requireMember} from './members';
import {managedWork,workPolicyGateway,type WorkAccess,type WorkOwnerView,type ManagedWork} from './work-policy';
import {type Env,HttpError} from './types';
import {refreshWorkAccess} from './work-refresh';

export interface WorkVisibility {
 access:WorkAccess;effectiveAccess:'owner'|'link'|'public'|'denied'|'unavailable';
 review:'none'|'pending'|'rejected'|'needs_review'|'revoked';update:'none'|'pending'|'rejected';
 everPublic:boolean;revisionState:'same'|'changed'|'unknown';restorable:boolean;
 restoreReason:'none'|'no_approval'|'content_changed'|'revision_unknown'|'restricted'|'unavailable';draftChanged:boolean;
 restriction:'none'|'delisted'|'suspended'|'takedown';reviewNote?:string;restrictionNote?:string;
 policyRevision:string;approvalRevision:string;
 actions:('set_private'|'set_unlisted'|'restore_public'|'submit_review'|'submit_update'|'cancel_review')[];
 syncState:'complete'|'changing'|'unavailable';
}
type ReviewRow={id:string;kind:string;status:string;note:string;submitted_at:number;decided_at:number|null};
async function revision(value:unknown):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
 return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function ownerCardSource(env:Env,id:string):Promise<{source:string;row:CardRow|null}>{
 const row=await getCard(env.DB,id,'harbor');
 if(row)return {source:row.source_role_id,row};
 if(CARD_NUMBER.test(id)){
  const number=await env.DB.prepare("SELECT source_role_id FROM card_numbers WHERE num=? AND provider='harbor'").bind(Number(id)).first<{source_role_id:string}>();
  if(!number)throw new HttpError(404,'card_not_found');return {source:number.source_role_id,row:null};
 }
 return {source:id,row:null};
}
export async function readOwnerVisibility(env:Env,source:string,token:string,row:CardRow|null,requireWrite=false):Promise<{workVisibility:WorkVisibility;provider:WorkOwnerView}>{
 let provider=await workPolicyGateway.owner(env,'harbor',source,token,requireWrite);
 let local=await managedWork(env.DB,'harbor',source);
 if(local&&(!provider.managed||provider.workId!==local.work_id))throw new HttpError(503,'visibility_provider_unavailable');
 if(savedEpochAdvanced(provider,local)){
  await refreshWorkAccess(env,1,[],[local!.work_id]);
  // A save or command may race the issuer read. Re-read current authority and
  // local facts; a remaining mismatch still fails closed in the projection.
  provider=await workPolicyGateway.owner(env,'harbor',source,token,requireWrite);
  local=await managedWork(env.DB,'harbor',source);row=await getCard(env.DB,source,'harbor');
  if(local&&(!provider.managed||provider.workId!==local.work_id))throw new HttpError(503,'visibility_provider_unavailable');
 }
 const [reviews,history,moderation]=await Promise.all([
  env.DB.prepare("SELECT s.id,s.kind,s.status,s.note,s.submitted_at,s.decided_at FROM review_submissions s WHERE s.provider='harbor' AND (s.source_role_id=?1 OR s.id IN(SELECT submission_id FROM hosting_versions WHERE provider='harbor' AND source_role_id=?1)) ORDER BY s.submitted_at DESC,s.rowid DESC LIMIT 1").bind(source).first<ReviewRow>(),
  env.DB.prepare("SELECT EXISTS(SELECT 1 FROM review_submissions s WHERE s.provider='harbor' AND (s.source_role_id=?1 OR s.id IN(SELECT submission_id FROM hosting_versions WHERE provider='harbor' AND source_role_id=?1)) AND s.status='approved') AS ever_public").bind(source).first<{ever_public:number}>(),
  env.DB.prepare("SELECT reason FROM moderation_events WHERE provider='harbor' AND source_role_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(source).first<{reason:string}>(),
 ]);
 return {workVisibility:await projectOwnerVisibility(provider,local,row,reviews,history?.ever_public===1,moderation),provider};
}

function savedEpochAdvanced(provider:WorkOwnerView,local:ManagedWork|null):boolean{
 return !!local&&local.epoch>0&&local.sync_state==='complete'&&provider.managed&&provider.workId===local.work_id
  &&provider.epoch>local.epoch&&provider.access===local.access&&provider.restriction===local.restriction;
}

async function projectOwnerVisibility(provider:WorkOwnerView,local:ManagedWork|null,row:CardRow|null,reviews:ReviewRow|null,everPublic:boolean,moderation:{reason:string}|null):Promise<WorkVisibility>{
 const access:WorkAccess=provider.managed?provider.access:row?.status==='approved'?'public':provider.access==='private'?'private':'unlisted';
 const restriction=provider.providerRestriction==='takedown'?'takedown':row?.public_blocked?'suspended':row?.board_hidden?'delisted':provider.restriction;
 const syncState:WorkVisibility['syncState']=local&&(local.sync_state!=='complete'||local.epoch!==provider.epoch||local.access!==provider.access||local.restriction!==provider.restriction||local.moderation_revision!==local.confirmed_moderation_revision||provider.approvedRoleId!==(row?.approved_hosted_role_id??'')||provider.approvedRoleId!==(local.approved_role_id??''))?'changing':provider.managed&&!local?'unavailable':'complete';
 const update:WorkVisibility['update']=access==='public'&&reviews&&['pending','rejected'].includes(reviews.status)?reviews.status as 'pending'|'rejected':'none';
 const revoked=provider.managed&&everPublic&&['approval_unavailable','not_approved'].includes(provider.restoreReason);
 const review:WorkVisibility['review']=update!=='none'?'none':reviews?.status==='pending'?'pending':reviews?.status==='rejected'?'rejected':revoked?'revoked':row?.status==='needs_review'?'needs_review':'none';
 const restorable=provider.restorable&&restriction==='none'&&syncState==='complete';
 const actions:WorkVisibility['actions']=[];
 if(syncState==='complete'&&restriction!=='takedown'){
  actions.push('set_private');
  if(restriction!=='suspended')actions.push('set_unlisted');
  if(restriction==='none'){
   if(restorable)actions.push('restore_public');
   else actions.push(access==='public'?'submit_update':'submit_review');
  }
  if(review==='pending'||update==='pending')actions.push('cancel_review');
 }
 const workVisibility:WorkVisibility={access,effectiveAccess:syncState!=='complete'?'unavailable':restriction==='suspended'||restriction==='takedown'?'denied':access==='private'?'owner':access==='unlisted'||restriction==='delisted'?'link':'public',
  review,update,everPublic,revisionState:provider.revisionState,restorable,
  restoreReason:syncState!=='complete'?'unavailable':restriction!=='none'?'restricted':restorable?'none':provider.restoreReason==='content_changed'?'content_changed':provider.restoreReason==='not_approved'?'no_approval':'revision_unknown',
  draftChanged:provider.revisionState==='changed',restriction,...(reviews?.status==='rejected'&&reviews.note?{reviewNote:reviews.note}:{}),
  ...(restriction!=='none'&&moderation?.reason?{restrictionNote:moderation.reason}:{}),
  policyRevision:await revision({provider:provider.policyRevision,local:local?[local.work_id,local.provider,local.source_role_id,local.access,local.epoch,local.restriction,local.approved_role_id,local.sync_state,local.sync_operation_id,local.moderation_revision,local.confirmed_moderation_revision]:null,row:row?[row.status,row.approved_version_id,row.approved_hosted_role_id,row.board_hidden,row.public_blocked]:null,reviews,everPublic}),
  approvalRevision:await revision({provider:provider.approvalRevision,approved:row?.approved_version_id??null,role:row?.approved_hosted_role_id??null,everPublic}),actions,syncState};
 return workVisibility;
}

// Provider validates each source's actual author and read scope in one RPC.
// D1 facts are set queries rather than per-card network/database round trips.
export async function readOwnerVisibilities(env:Env,sources:string[],token:string):Promise<Map<string,WorkVisibility>>{
 if(!sources.length)return new Map();
 let provider=await workPolicyGateway.owners(env,'harbor',sources,token);
 const ids=JSON.stringify(sources);
 const before=await env.DB.prepare("SELECT * FROM managed_work_access WHERE provider='harbor' AND source_role_id IN(SELECT value FROM json_each(?))").bind(ids).all<ManagedWork>();
 const prior=new Map(before.results.map(p=>[p.source_role_id,p]));
 const saved=sources.flatMap((source,i)=>savedEpochAdvanced(provider[i],prior.get(source)??null)?[prior.get(source)!.work_id]:[]);
 if(saved.length){await refreshWorkAccess(env,saved.length,[],saved);provider=await workPolicyGateway.owners(env,'harbor',sources,token);}
 const [cards,policies,reviews,moderation]=await Promise.all([
  env.DB.prepare("SELECT * FROM cards WHERE provider='harbor' AND source_role_id IN(SELECT value FROM json_each(?))").bind(ids).all<CardRow>(),
  env.DB.prepare("SELECT * FROM managed_work_access WHERE provider='harbor' AND source_role_id IN(SELECT value FROM json_each(?))").bind(ids).all<ManagedWork>(),
  env.DB.prepare(`SELECT * FROM (SELECT s.id,s.kind,s.status,s.note,s.submitted_at,s.decided_at,
   COALESCE(v.source_role_id,s.source_role_id) AS source,
   ROW_NUMBER() OVER(PARTITION BY COALESCE(v.source_role_id,s.source_role_id) ORDER BY s.submitted_at DESC,s.rowid DESC) AS n,
   MAX(CASE WHEN s.status='approved' THEN 1 ELSE 0 END) OVER(PARTITION BY COALESCE(v.source_role_id,s.source_role_id)) AS ever_public
   FROM review_submissions s LEFT JOIN hosting_versions v ON v.submission_id=s.id
   WHERE s.provider='harbor' AND COALESCE(v.source_role_id,s.source_role_id) IN(SELECT value FROM json_each(?))) WHERE n=1`).bind(ids).all<ReviewRow&{source:string;ever_public:number}>(),
  env.DB.prepare(`SELECT * FROM(SELECT source_role_id,reason,ROW_NUMBER() OVER(PARTITION BY source_role_id ORDER BY created_at DESC,rowid DESC) AS n
   FROM moderation_events WHERE provider='harbor' AND source_role_id IN(SELECT value FROM json_each(?))) WHERE n=1`).bind(ids).all<{source_role_id:string;reason:string}>(),
 ]);
 const cardMap=new Map(cards.results.map(r=>[r.source_role_id,r])),policyMap=new Map(policies.results.map(r=>[r.source_role_id,r]));
 const reviewMap=new Map(reviews.results.map(r=>[r.source,r])),moderationMap=new Map(moderation.results.map(r=>[r.source_role_id,r]));
 const out=new Map<string,WorkVisibility>();
 for(const [i,source] of sources.entries()){
  const p=policyMap.get(source)??null,r=provider[i],review=reviewMap.get(source)??null;
  if(p&&(!r.managed||r.workId!==p.work_id))throw new HttpError(503,'visibility_provider_unavailable');
  out.set(source,await projectOwnerVisibility(r,p,cardMap.get(source)??null,review,review?.ever_public===1,moderationMap.get(source)??null));
 }
 return out;
}

export const workSharingRoutes=new Hono<{Bindings:Env}>();
workSharingRoutes.get('/v1/me/cards/:id/visibility',async c=>{
 c.header('Cache-Control','private, no-store');
 const member=await requireMember(c);if(member.provider!=='harbor')throw new HttpError(404,'card_not_found');
 const {source,row}=await ownerCardSource(c.env,c.req.param('id'));
 const token=c.req.header('Authorization')!.replace(/^Bearer\s+/i,'');
 const {workVisibility}=await readOwnerVisibility(c.env,source,token,row);
 return c.json({workVisibility});
});
