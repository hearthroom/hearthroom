import {env} from 'cloudflare:test';
import {hostGateway} from '../src/hosting';
import {upstream,type UpstreamRole} from '../src/upstream';
import {claim,stamp} from '../src/review';
export const frozenFixtureRoles=new Map<string,UpstreamRole>();
const originalGateway={...hostGateway};
export function hostedFixture(){
 const settings=env as unknown as {HOSTING_SERVICE_KEY?:string;HOSTING_SERVICE_KEY_LUNATALK?:string;REVIEW_ENABLED?:string};
 settings.HOSTING_SERVICE_KEY='fixture-harbor';settings.HOSTING_SERVICE_KEY_LUNATALK='fixture-luna';settings.REVIEW_ENABLED='true';
 hostGateway.read=async(e,_token,id,provider='harbor')=>structuredClone(frozenFixtureRoles.get(id)??await upstream.fetchRole(e,id,provider));
 hostGateway.seal=async(e,token,id,workId,versionId,provider='harbor')=>{
  const hostedRevisionId='frozen-'+versionId;
  if(!frozenFixtureRoles.has(hostedRevisionId))frozenFixtureRoles.set(hostedRevisionId,{...await hostGateway.read(e,token,id,provider),roleId:hostedRevisionId});
  return {workId,versionId,hostedRevisionId};
 };
 upstream.readForReview=async()=>({document:{roleDetailDesc:'Private fixture'},hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
}
export function restoreHostedFixture(){
 Object.assign(hostGateway,originalGateway);frozenFixtureRoles.clear();
 const settings=env as unknown as {HOSTING_SERVICE_KEY?:string;HOSTING_SERVICE_KEY_LUNATALK?:string;REVIEW_ENABLED?:string};
 delete settings.HOSTING_SERVICE_KEY;delete settings.HOSTING_SERVICE_KEY_LUNATALK;settings.REVIEW_ENABLED='false';
}
/** Exercise the real submission and review services before reading a public fixture. */
export async function approveFixtureResponse(response:Response):Promise<Response>{
 if(!response.ok)return response;
 const data=await response.clone().json() as {versionId?:string};
 if(!data.versionId)return response;
 const sub=await env.DB.prepare("SELECT s.id FROM review_submissions s JOIN hosting_versions v ON v.submission_id=s.id WHERE v.version_id=? AND s.status='pending'").bind(data.versionId).first<{id:string}>();
 if(sub)for(const reviewer of ['fixture-reviewer-one','fixture-reviewer-two']){
  const pending=await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(sub.id).first<{status:string}>();
  if(pending?.status!=='pending')break;
  await claim(env.DB,sub.id,reviewer,Date.now());await stamp(env.DB,{submissionId:sub.id,memberId:reviewer,verdict:'approve',note:'',now:Date.now()});
 }
 return response;
}
