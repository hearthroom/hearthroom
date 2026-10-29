<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {useI18n} from 'vue-i18n';
import {useSession} from '@/lib/session';
import {confirmDialog} from '@/lib/confirm';
import {BoardError,fetchBoardPrivacy,fetchPrivacyOperation,saveBoardPrivacy,isAnonymous,revealScope,type BoardPrivacy,type PrivacyMode,type PrivacySave} from '@/lib/spend-leaderboard';
const props=defineProps<{cardId?:string}>();
const emit=defineEmits<{saved:[];busy:[boolean]}>();
const {t}=useI18n(),session=useSession();
const saved=ref<BoardPrivacy|null>(null),anonymous=ref(false),mode=ref<PrivacyMode>('inherit');
const loading=ref(true),busy=ref(false),pending=ref(false),error=ref(''),message=ref('');
let alive=true,version=0;
const draft=computed(()=>({anonymous:anonymous.value,mode:props.cardId?mode.value:'inherit' as PrivacyMode,revision:saved.value?.revision??0}));
const dirty=computed(()=>saved.value&&(saved.value.anonymous!==draft.value.anonymous||saved.value.mode!==draft.value.mode));
const storageKey=()=>`hr.leaderboard.pending:${session.me?.accountNumId??''}`;
const token=async()=>await session.accessToken()??'';
async function load(){
 const current=++version;loading.value=true;error.value='';saved.value=null;busy.value=false;pending.value=false;message.value='';emit('busy',false);
 try{const value=await fetchBoardPrivacy(await token(),props.cardId);if(current!==version||!alive)return;saved.value=value;anonymous.value=value.anonymous;mode.value=value.mode;}
 catch{if(current===version)error.value='privacyError';}finally{if(current===version)loading.value=false;}
}
function remember(input:PrivacySave|null,key=storageKey()){try{if(input)sessionStorage.setItem(key,JSON.stringify(input));else sessionStorage.removeItem(key);}catch{/* Recovery remains active in this mounted editor. */}}
async function finish(value:BoardPrivacy,current:number,key:string){
 if(!alive||current!==version)return;
 remember(null,key);pending.value=false;busy.value=false;emit('busy',false);
 // An operation receipt proves a committed save; reread current preferences in
 // case another device changed them after that receipt.
 saved.value=value;anonymous.value=value.anonymous;mode.value=value.mode;emit('saved');
 await load();
 if(alive&&key===storageKey())message.value='saved';
}
async function recover(input:PrivacySave,current=version,key=storageKey()){
 pending.value=true;busy.value=true;emit('busy',true);let tries=0;
 while(alive&&current===version){
  try{const access=await token();if(current!==version||!alive)return;await finish(await fetchPrivacyOperation(access,input.requestId),current,key);return;}
  catch(e){
   if(current!==version||!alive)return;
   if(e instanceof BoardError&&e.status===404&&++tries%3===0){
    try{const access=await token();if(current!==version||!alive)return;await finish(await saveBoardPrivacy(access,input),current,key);return;}
    catch(retry){if(current!==version||!alive)return;if(retry instanceof BoardError&&retry.status===409){remember(null,key);pending.value=false;busy.value=false;error.value='conflict';emit('busy',false);return;}}
   }
  }
  await new Promise(r=>setTimeout(r,1000));
 }
}
async function save(){
 if(!saved.value||!dirty.value||busy.value)return;error.value='';message.value='';
 const current=version,key=storageKey();
 const scope=revealScope(saved.value,draft.value,!!props.cardId);
 if(scope&&!await confirmDialog({title:t('spendBoard.reveal'),message:t('spendBoard.'+scope),confirmText:t('spendBoard.confirm'),cancelText:t('spendBoard.cancel'),focusCancel:true}))return;
 if(current!==version||!alive)return;
 const input:PrivacySave={requestId:crypto.randomUUID(),...draft.value,...(props.cardId?{cardId:props.cardId}:{}),confirmed:!!scope};
 busy.value=true;emit('busy',true);remember(input,key);
 try{const access=await token();if(current!==version||!alive)return;await finish(await saveBoardPrivacy(access,input),current,key);}
 catch(e){
  if(current!==version||!alive)return;
  if(e instanceof BoardError&&e.status<500){remember(null,key);busy.value=false;error.value=e.status===409?'conflict':'failed';emit('busy',false);}
  else await recover(input,current,key);
 }
}
watch(()=>[props.cardId,session.me?.accountNumId],async()=>{
 await load();let input:PrivacySave|null=null;try{input=JSON.parse(sessionStorage.getItem(storageKey())??'null')}catch{}
 if(input&&alive)void recover(input);
},{immediate:true});
onBeforeUnmount(()=>{alive=false;version++;});
</script>
<template>
 <div class="board-privacy" :aria-busy="loading||busy">
  <p v-if="loading" role="status">{{ t('spendBoard.load') }}</p>
  <template v-else-if="saved">
   <fieldset :disabled="busy">
    <legend>{{ t('spendBoard.global') }}</legend>
    <label class="board-privacy__toggle"><span>{{ t('spendBoard.anonymousLabel') }}</span><input v-model="anonymous" type="checkbox" /></label>
    <p class="muted">{{ t('spendBoard.help') }}</p>
    <div v-if="cardId" class="field">
     <label for="board-card-mode">{{ t('spendBoard.override') }}</label>
     <select id="board-card-mode" v-model="mode" class="input"><option value="inherit">{{ t('spendBoard.inherit') }}</option><option value="anonymous">{{ t('spendBoard.cardAnon') }}</option><option value="public">{{ t('spendBoard.cardPublic') }}</option></select>
     <p class="muted">{{ t('spendBoard.scope') }}</p>
    </div>
    <div class="board-privacy__preview"><h3>{{ t('spendBoard.preview') }}</h3><p>{{ t('spendBoard.'+(cardId?(isAnonymous(draft)?'previewAnonymous':'previewPublic'):(isAnonymous(draft)?'previewGlobalAnonymous':'previewGlobalPublic'))) }}</p></div>
    <p class="muted">{{ t('spendBoard.historyScope') }} {{ t('spendBoard.historyVisibility') }}</p>
   </fieldset>
   <button type="button" class="btn btn--primary btn--lg" :disabled="!dirty||busy||error==='conflict'" @click="save">{{ t('spendBoard.'+(busy?'saving':'save')) }}</button>
  </template>
  <p v-if="pending" role="status">{{ t('spendBoard.savePending') }}</p>
  <p v-if="message" role="status">{{ t('spendBoard.'+message) }}</p>
  <div v-if="error" class="notice notice--error" role="alert"><p>{{ t('spendBoard.'+error) }}</p><button v-if="error==='privacyError'||error==='conflict'" type="button" class="btn btn--lg" @click="load">{{ t('spendBoard.retry') }}</button></div>
 </div>
</template>
<style scoped>
.board-privacy{display:grid;gap:var(--s-4);overflow-wrap:anywhere}.board-privacy fieldset{border:0;padding:0;min-width:0;display:grid;gap:var(--s-4)}.board-privacy legend{font-size:16px;font-weight:600;margin-bottom:var(--s-3)}.board-privacy p{margin:0;line-height:1.6}.board-privacy__toggle{display:flex;align-items:center;justify-content:space-between;gap:var(--s-4);min-height:var(--h-lg);font-weight:600}.board-privacy__toggle input{width:24px;height:24px;margin:0;accent-color:var(--accent-btn)}.board-privacy .field{display:grid;gap:var(--s-2)}.board-privacy select{width:100%;height:var(--h-lg)}.board-privacy__preview{padding:var(--s-3);border-radius:var(--r-md);background:var(--surface-2)}.board-privacy h3{font-size:14px;margin:0 0 var(--s-2)}
</style>
