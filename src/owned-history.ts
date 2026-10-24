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
