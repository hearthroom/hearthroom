import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {delegatedAccess} from './account-auth';
import {connectedMemberId} from './connections';
import {memberProfile} from './members';
import {distributeHosted} from './hosting-distribution';
import {syncCard} from './card-sync';
import {upstream} from './upstream';
import {HttpError,type Env} from './types';

/** Temporary, operator-only migration. Removed with the subsequent retirement release.
 * The Harbor issuer key is held by the owner on the Harbor host, never by clients.
 * Requests select a community card number; accounts, versions and tokens come from
 * authoritative records. No token, role content or internal identity is returned.
 */
export const retirementRoutes=new Hono<{Bindings:Env}>();
retirementRoutes.use('/internal/retirement/*',async(c,next)=>{
 c.header('Cache-Control','no-store');
 const expected=c.env.HOSTING_SERVICE_KEY,provided=c.req.header('X-Retirement-Key');
 if(!expected||!provided||provided.length>512)throw new HttpError(403,'forbidden');
 const encode=(s:string)=>new TextEncoder().encode(s);
 const a=encode(expected),b=encode(provided);
 if(a.length!==b.length||!crypto.subtle.timingSafeEqual(a,b))throw new HttpError(403,'forbidden');
 await next();
 const outcome=c.res.status>=500?'unavailable':c.res.status>=400?'denied':'ready';
 await c.env.DB.prepare("INSERT INTO account_auth_metrics VALUES('retirement','harbor',?,1) ON CONFLICT(operation,provider,outcome) DO UPDATE SET value=value+1").bind(outcome).run();
});
retirementRoutes.use('/internal/retirement/*',bodyLimit({maxSize:1024}));
retirementRoutes.post('/internal/retirement/migrate',async c=>{
 const body=await c.req.json().catch(()=>null) as {cardNumber?:number;draft?:boolean}|null;
 if(!Number.isSafeInteger(body?.cardNumber)||body!.cardNumber!<=100000)throw new HttpError(400,'invalid_card_number');
 if(body?.draft===true){
  const work=await c.env.DB.prepare(`SELECT n.source_role_id,COALESCE(w.member_id,mc.owner_member_id,mi.member_id) AS member_id
   FROM card_numbers n LEFT JOIN works w ON w.source_provider=n.provider AND w.source_role_id=n.source_role_id
   LEFT JOIN cards c ON c.id=n.num
   LEFT JOIN member_identities mi ON mi.provider=c.provider AND mi.external_id=CAST(c.author_num_id AS TEXT)
   LEFT JOIN member_connections mc ON mc.provider=c.provider AND mc.external_id=CAST(c.author_num_id AS TEXT)
   WHERE n.num=? AND n.provider='lunatalk'`).bind(body.cardNumber).first<{source_role_id:string;member_id:string|null}>();
  if(!work?.member_id)throw new HttpError(404,'migration_card_unavailable');
  const profile=await memberProfile(c.env.DB,work.member_id);
  const source=profile?.identities.find(i=>i.provider==='lunatalk'),target=profile?.identities.find(i=>i.provider==='harbor');
  if(!source||!target)throw new HttpError(409,'migration_account_unlinked');
  const [a,b]=await Promise.all([delegatedAccess(c.env,'lunatalk',source.externalId,work.member_id),delegatedAccess(c.env,'harbor',target.externalId,work.member_id)]);
  const [sourceIdentity,targetIdentity]=await Promise.all([upstream.fetchMe(c.env,a.accessToken,'lunatalk'),upstream.fetchMe(c.env,b.accessToken,'harbor')]);
  if(sourceIdentity.accountNumId!==source.externalId||targetIdentity.accountNumId!==target.externalId)throw new HttpError(409,'migration_owner_changed');
  await syncCard(c.env,{memberId:work.member_id,sourceProvider:'lunatalk',sourceRoleId:work.source_role_id,sourceAccount:source.externalId,sourceToken:a.accessToken,targetProvider:'harbor',targetAccount:target.externalId,targetToken:b.accessToken,publish:false});
  return c.json({status:'draft_ready'});
 }
 const row=await c.env.DB.prepare(`SELECT c.approved_version_id AS version_id,c.author_num_id,v.member_id
 FROM cards c JOIN hosting_versions v ON v.version_id=c.approved_version_id
 WHERE c.id=? AND c.provider='lunatalk' AND c.status='approved' AND v.state='approved' AND v.provider='lunatalk'`)
 .bind(body!.cardNumber).first<{version_id:string;author_num_id:number;member_id:string}>();
 if(!row)throw new HttpError(404,'migration_card_unavailable');
 if(await connectedMemberId(c.env.DB,'lunatalk',row.author_num_id)!==row.member_id)throw new HttpError(409,'migration_owner_changed');
 const profile=await memberProfile(c.env.DB,row.member_id);
 const target=profile?.identities.find(i=>i.provider==='harbor');
 if(!target)throw new HttpError(409,'migration_account_unlinked');
 const existing=await c.env.DB.prepare("SELECT hosted_revision_id FROM hosting_replicas WHERE version_id=? AND provider='harbor' AND state='ready'").bind(row.version_id).first<{hosted_revision_id:string}>();
 if(existing){
  const role=await upstream.fetchRole(c.env,existing.hosted_revision_id,'harbor');
  if(role.authorNumId!==target.externalId)throw new HttpError(409,'migration_owner_changed');
  return c.json({status:'already_ready'});
 }
 const [sourceAuth,targetAuth]=await Promise.all([
  delegatedAccess(c.env,'lunatalk',row.author_num_id,row.member_id),
  delegatedAccess(c.env,'harbor',target.externalId,row.member_id),
 ]);
 const [sourceIdentity,targetIdentity]=await Promise.all([
  upstream.fetchMe(c.env,sourceAuth.accessToken,'lunatalk'),
  upstream.fetchMe(c.env,targetAuth.accessToken,'harbor'),
 ]);
 if(sourceIdentity.accountNumId!==row.author_num_id||targetIdentity.accountNumId!==target.externalId)throw new HttpError(409,'migration_owner_changed');
 await distributeHosted(c.env,{memberId:row.member_id,versionId:row.version_id,sourceAccount:row.author_num_id,sourceToken:sourceAuth.accessToken,targetProvider:'harbor',targetAccount:target.externalId,targetToken:targetAuth.accessToken});
 return c.json({status:'ready'});
});
