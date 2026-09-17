import { synchronize, connectionMessage, type CardCopy } from './distribution';
import { type ProviderId } from './provider';
export interface PlatformResult {provider:ProviderId;status:string;error?:string}
/** A failed destination must not hide successful copies or trigger another source create. */
export async function saveCopies(roleId:string, source:ProviderId, selected:ProviderId[], publish=false):Promise<PlatformResult[]> {
 const results:PlatformResult[]=[];
 for(const provider of [...new Set(selected)].filter(p=>p!==source)) {
  try { const copy:CardCopy=await synchronize(roleId,source,provider,publish,true);results.push({provider,status:copy.status}); }
  catch(e) {results.push({provider,status:'failed',error:connectionMessage(e)});}
 }
 return results;
}
