import {onMounted,readonly,ref} from 'vue';
import {COMMUNITY_API} from './config';
/** 卡片品質信號的上線開關：伺服器資料暖機完成前沒有旗標，畫面維持舊版（不多一行、沒有預覽鈕）。 */
export async function readCardQualityCapability():Promise<boolean>{
 try{const response=await fetch(`${COMMUNITY_API}/providers`,{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)return false;const body=await response.json();return body?.capabilities?.cardQuality===true;}catch{return false;}
}
const enabled=ref(false);let loading:Promise<void>|undefined;
export function useCardQualityCapability(){
 onMounted(()=>{loading??=readCardQualityCapability().then(value=>{enabled.value=value;});});
 return readonly(enabled);
}
