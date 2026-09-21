import {ref,watch,onBeforeUnmount,type Ref} from 'vue';
import {communityRequest} from './community';
export interface AppearancePreferences {avatarSource:'site'|'discord'|'guild';nameStyle:'none'|'ember'|'aurora'|'glow';frame:'none'|'hearth'|'discord';publicAppearance:boolean}
export interface EffectiveAppearance {avatarUrl:string|null;decorationUrl:string|null;nameStyle:AppearancePreferences['nameStyle'];frame:AppearancePreferences['frame']}
export interface AppearanceView {preferences:AppearancePreferences;supporter:{active:boolean;boostingSince:number|null;verifiedAt:number|null;stale:boolean};available:{discordAvatar?:string;guildAvatar?:string;discordDecoration?:string;guildDecoration?:string};effective:EffectiveAppearance}
interface PublicIdentity {badges:string[];level?:number;appearance?:EffectiveAppearance}
const cache=new Map<string,{expires:number;promise:Promise<PublicIdentity>}>();
type Pending = {handle:string;resolve:(v:PublicIdentity)=>void;reject:(e:unknown)=>void};
let pending:Pending[]=[];
let scheduled=false;
export function clearAppearanceCache(handle?:string){if(handle)cache.delete(handle);else cache.clear();}
async function flushIdentities() {
 scheduled=false;const requests=pending;pending=[];
 for(let offset=0;offset<requests.length;offset+=50) {
  const batch=requests.slice(offset,offset+50);
  const query=new URLSearchParams();for(const item of batch)query.append('handle',item.handle);
  try {
   const response=await communityRequest<{members:Record<string,PublicIdentity>}>('/community/members?'+query);
   if(!response.members)throw new Error('Invalid public identity response');
   for(const item of batch)item.resolve(response.members[item.handle]??{badges:[]});
  }catch(error){for(const item of batch)item.reject(error);}
 }
}
export function publicIdentity(handle:string):Promise<PublicIdentity> {
 const current=cache.get(handle);if(current&&current.expires>Date.now())return current.promise;
 const promise=new Promise<PublicIdentity>((resolve,reject)=>{pending.push({handle,resolve,reject});});
 cache.set(handle,{expires:Date.now()+30000,promise});
 if(cache.size>200)cache.delete(cache.keys().next().value!);
 void promise.catch(()=>{if(cache.get(handle)?.promise===promise)cache.delete(handle);});
 if(!scheduled){scheduled=true;queueMicrotask(()=>{void flushIdentities();});}
 return promise;
}
export function usePublicAppearance(handle:()=>string|undefined) {
 const value:Ref<PublicIdentity|null>=ref(null);let sequence=0;
 watch(handle,async h=>{
  const current=++sequence;value.value=null;if(!h)return;
  try{const result=await publicIdentity(h);if(sequence===current)value.value=result;}catch{/* Plain profile remains usable. */}
 },{immediate:true});
 onBeforeUnmount(()=>{sequence++;});return value;
}
