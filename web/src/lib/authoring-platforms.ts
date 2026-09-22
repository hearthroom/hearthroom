import { synchronize, copies, connectionMessage, type CardCopy } from './distribution';
import { accountToken } from './connections';
import { type ProviderId } from './provider';
export interface PlatformResult {provider:ProviderId;status:string;error?:string}
/** Existing copies are the author's saved destination choices, not every linked account. */
export async function savedDistributionTargets(roleId:string,source:ProviderId) {
 const saved=await copies(roleId,source);
 const targets:{provider:ProviderId;token:string}[]=[];
 for(const provider of [...new Set(saved.filter(c=>c.provider!==source&&c.roleId).map(c=>c.provider))]){
  const token=await accountToken(provider);
  if(token)targets.push({provider,token});
 }
 return targets;
}
/** A failed destination must not hide successful copies or trigger another source create. */
export async function saveCopies(roleId:string, source:ProviderId, selected:ProviderId[], publish=false):Promise<PlatformResult[]> {
 const results:PlatformResult[]=[];
 for(const provider of [...new Set(selected)].filter(p=>p!==source)) {
  try { const copy:CardCopy=await synchronize(roleId,source,provider,publish,true);results.push({provider,status:copy.status}); }
  catch(e) {results.push({provider,status:'failed',error:connectionMessage(e)});}
 }
 return results;
}
