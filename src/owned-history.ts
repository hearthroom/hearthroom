import { apiBaseOf } from './providers';
import type { Env } from './types';

export interface OwnedHistoryCapability {
 conversationId:string; roleId:string; title?:string; roleName?:string;
 canGenerate:boolean; reason?:'author_private'|'restricted'|'unavailable';
}
/** Authenticated policy reads are neither shared nor cached with hostedTitle. */
async function read(env:Env, token:string, conversationId:string):Promise<OwnedHistoryCapability|null>{
 try {
  const result=await fetch(`${apiBaseOf(env,'harbor')}/open/v1/conversation/owned?conversationId=${encodeURIComponent(conversationId)}`,{
   headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(5000),
  });
  if(!result.ok)return null;
  const value=await result.json() as OwnedHistoryCapability;
  if(value.conversationId!==conversationId||typeof value.roleId!=='string'||typeof value.canGenerate!=='boolean')return null;
  return value;
 }catch{return null;}
}
export const ownedHistory={read};

/** Union every trusted lineage mapping; contradictory identities fail closed. */
async function workIdentity(env:Env,roleId:string):Promise<string|null>{
 const rows=await env.DB.prepare(`WITH identities(work_id) AS (
  SELECT id FROM works WHERE source_provider='harbor' AND source_role_id=?
  UNION SELECT v.work_id FROM hosting_replicas r JOIN hosting_versions v ON v.version_id=r.version_id
   JOIN works w ON w.id=v.work_id WHERE r.provider='harbor' AND r.hosted_revision_id=? AND w.source_provider='harbor'
  UNION SELECT v.work_id FROM hosting_versions v JOIN works w ON w.id=v.work_id
   WHERE v.provider='harbor' AND v.hosted_revision_id=? AND w.source_provider='harbor'
  UNION SELECT p.work_id FROM work_copies p JOIN works w ON w.id=p.work_id
   WHERE p.provider='harbor' AND p.role_id=? AND w.source_provider='harbor'
  UNION SELECT w.id FROM cards c JOIN works w ON w.source_provider=c.provider AND w.source_role_id=c.source_role_id
   WHERE c.provider='harbor' AND c.approved_hosted_role_id=?
 ) SELECT DISTINCT work_id FROM identities WHERE work_id IS NOT NULL LIMIT 2`)
 .bind(roleId,roleId,roleId,roleId,roleId).all<{work_id:string}>();
 return rows.results.length===1?rows.results[0].work_id:null;
}

// Provider owns the current conversation revision. A saved community pointer
// may precede a legitimate version migration, but can never bind another work.
export async function bindOwnedHistory(env:Env,roleId:string,conversationId:string,capability:OwnedHistoryCapability|null):Promise<OwnedHistoryCapability|null>{
 if(!capability||capability.conversationId!==conversationId)return null;
 if(capability.roleId===roleId)return capability;
 const [previous,current]=await Promise.all([workIdentity(env,roleId),workIdentity(env,capability.roleId)]);
 return previous&&previous===current?capability:null;
}
