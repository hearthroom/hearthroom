import {previewCard,type CardRow} from './cards';
import {bumpOp} from './ops-metrics';
import {apiBaseOf} from './providers';
import {projectRole,upstream,type UpstreamRole} from './upstream';
import {type Env,HttpError} from './types';
import {managedWork} from './work-policy';

/** Provider authorization, rather than a community pointer, proves past play. */
async function readTarget(env:Env,row:CardRow,target:string,token:string):Promise<UpstreamRole|null>{
 try{
  const response=await fetch(`${apiBaseOf(env,'harbor')}/open/v1/role/detail?roleId=${encodeURIComponent(target)}`,{
   headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(5000),
  });
  if([401,403,404].includes(response.status))return null;
  if(!response.ok)throw new Error('Private player read unavailable');
  const role=projectRole(await response.json() as Record<string,unknown>);
  if(role.roleId!==target||role.authorNumId!==row.author_num_id)throw new Error('Private player identity mismatch');
  return role;
 }catch{throw new HttpError(503,'visibility_provider_unavailable');}
}

/** This exception is only for authenticated detail/play entry, never discovery or social reads. */
export async function privatePlayerCard(env:Env,row:CardRow,token:string|undefined,language:string,surface:'detail'|'metadata',allowsAdult:()=>Promise<boolean>){
 let result:'allow'|'denied'|'unavailable'='denied';
 try{
  if(!token||row.provider!=='harbor'||row.public_blocked)return null;
  const policy=await managedWork(env.DB,'harbor',row.source_role_id);
  if(!policy||policy.access!=='private'||policy.restriction!=='none')return null;
  // A confirmed author must still use the existing owner-read scope. A public
  // player projection is not a substitute for that independently checked path.
  const viewer=await upstream.fetchMe(env,token,'harbor').catch(()=>null);
  if(viewer?.accountNumId===row.author_num_id)return null;
  if(policy.sync_state!=='complete'||policy.moderation_revision!==policy.confirmed_moderation_revision)throw new HttpError(503,'visibility_sync_pending');
  // Prefer the reviewed immutable version. Provider only grants the mutable source
  // to someone who actually played that source, not merely another work version.
  const targets=[...new Set([row.approved_hosted_role_id,row.source_role_id].filter((id):id is string=>!!id))];
  for(const target of targets){
   const role=await readTarget(env,row,target,token);
   if(!role)continue;
   result='allow';
   const source=target===row.source_role_id;
   if((source||row.rating==='R')&&!await allowsAdult())throw new HttpError(403,'adult_content');
   return {...previewCard(role,language,'harbor',row.num??Number(row.id)),sourceRoleId:row.source_role_id,
    rating:source?'R':row.rating,ratingDescriptors:source?[]:row.rating_descriptors?JSON.parse(row.rating_descriptors) as string[]:[],
    status:'private',canInteract:false,listed:false};
  }
  return null;
 }catch(error){
  if(!(error instanceof HttpError&&error.status===403))result='unavailable';
  throw error;
 }finally{await bumpOp(env.DB,'visibility_read',`private_${surface}`,result);}
}
