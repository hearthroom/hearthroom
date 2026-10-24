import {onMounted,readonly,ref} from 'vue';
import {COMMUNITY_API} from './config';
/** Public rollout signal only. Server ownership, actions and CAS remain authoritative. */
export async function readWorkVisibilityCapability():Promise<boolean>{
 try{const response=await fetch(`${COMMUNITY_API}/providers`,{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)return false;const body=await response.json();return body?.capabilities?.workVisibility===true;}catch{return false;}
}
const enabled=ref(false);let loading:Promise<void>|undefined;
export function useWorkVisibilityCapability(){
 onMounted(()=>{loading??=readWorkVisibilityCapability().then(value=>{enabled.value=value;});});
 return readonly(enabled);
}
