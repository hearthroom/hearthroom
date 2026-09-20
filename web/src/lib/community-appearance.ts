import {ref,watch,onBeforeUnmount,type Ref} from 'vue';
import {communityRequest} from './community';
export interface AppearancePreferences {avatarSource:'site'|'discord'|'guild';nameStyle:'none'|'ember'|'aurora'|'glow';frame:'none'|'hearth'|'discord';publicAppearance:boolean}
export interface EffectiveAppearance {avatarUrl:string|null;decorationUrl:string|null;nameStyle:AppearancePreferences['nameStyle'];frame:AppearancePreferences['frame']}
export interface AppearanceView {preferences:AppearancePreferences;supporter:{active:boolean;boostingSince:number|null;verifiedAt:number|null;stale:boolean};available:{discordAvatar?:string;guildAvatar?:string;discordDecoration?:string;guildDecoration?:string};effective:EffectiveAppearance}
interface PublicIdentity {badges:string[];level?:number;appearance?:EffectiveAppearance}
const cache=new Map<string,{expires:number;promise:Promise<PublicIdentity>}>();
export function clearAppearanceCache(handle?:string){if(handle)cache.delete(handle);else cache.clear();}
export function usePublicAppearance(handle:()=>string|undefined) {
 const value:Ref<PublicIdentity|null>=ref(null);let sequence=0;
 watch(handle,async h=>{
  const current=++sequence;value.value=null;if(!h)return;
  let entry=cache.get(h);
  if(!entry||entry.expires<Date.now()){
   const promise=communityRequest<PublicIdentity>('/community/members/'+encodeURIComponent(h));entry={expires:Date.now()+30000,promise};cache.set(h,entry);
   if(cache.size>200)cache.delete(cache.keys().next().value!);
   void promise.catch(()=>{if(cache.get(h)?.promise===promise)cache.delete(h);});
  }
  try{const result=await entry.promise;if(sequence===current)value.value=result;}catch{/* Plain profile remains usable. */}
 },{immediate:true});
 onBeforeUnmount(()=>{sequence++;});return value;
}
