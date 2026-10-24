import {getCard,upsertCard,type CardRow} from './cards';
import {resolveMember} from './members';
import {upstream} from './upstream';
import {readCurrentWorkPolicies} from './work-read';
import {type Env,HttpError} from './types';

// A legacy public link can acquire a stable social identity without becoming a
// policy enrollment or a publication. No caller-supplied author/content is used.
export async function registerLegacyShare(env:Env,source:string,canReadUnreviewed:()=>Promise<boolean>):Promise<CardRow|null>{
 const [authority]=await readCurrentWorkPolicies(env,[{sourceRoleId:source,workId:'00000000-0000-0000-0000-000000000000',targetRoleId:source}]);
 if(authority.managed)throw new HttpError(503,'visibility_sync_pending');
 // A private source may still be read by its authenticated author. The caller
 // handles that fallback without creating a public community registration.
 if(!authority.targetReadable)return null;
 if(authority.shareRoleId!==source)throw new HttpError(404,'card not found');
 if(!await canReadUnreviewed())throw new HttpError(403,'adult_content');
 const role=await upstream.fetchRole(env,source,'harbor');
 if(role.roleId!==source||!Number.isSafeInteger(role.authorNumId)||role.authorNumId<1||role.creationMethod!=='hearthroom')throw new HttpError(404,'card not found');
 const blocked=await env.DB.prepare("SELECT public_blocked FROM moderation_state WHERE provider='harbor' AND source_role_id=?").bind(source).first<{public_blocked:number}>();
 if(blocked?.public_blocked)throw new HttpError(404,'card not found');
 const member=await resolveMember(env.DB,'harbor',role.authorNumId,Date.now());
 await env.DB.prepare("INSERT OR IGNORE INTO works(id,member_id,source_provider,source_role_id,created_at) VALUES(?,?,'harbor',?,?)").bind(crypto.randomUUID(),member,source,Date.now()).run();
 await upsertCard(env.DB,role,0,{status:'unlisted',preserveExisting:true,additionalWrites:cardId=>[
  env.DB.prepare("UPDATE cards SET rating='R' WHERE id=? AND registered_at=0 AND approved_version_id IS NULL").bind(cardId),
 ]});
 const row=await getCard(env.DB,source,'harbor');if(!row)throw new HttpError(503,'visibility_sync_pending');return row;
}
