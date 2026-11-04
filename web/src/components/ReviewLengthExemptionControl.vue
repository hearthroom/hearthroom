<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/lib/session';
import { currentProvider } from '@/lib/provider';
import { moderationRequest } from '@/lib/moderation';
import { confirmDialog, confirmForm, confirmState, settleConfirm } from '@/lib/confirm';
import { dateTime } from '@/lib/format';
import { REVIEW_REQUIRED_CHARACTERS } from '../../../shared/review-length';
interface Exemption {cardNumber:number;enabled:boolean;revision:number;actor:string|null;updatedAt:number|null;reason:string;history:{action:string;reason:string;at:number;actor:string|null}[]}
const props=defineProps<{cardNumber:string;disabled?:boolean}>();
const emit=defineEmits<{change:[enabled:boolean]}>();
const {t,locale}=useI18n(),session=useSession();
const data=ref<Exemption|null>(null),error=ref(''),loading=ref(false),busy=ref(false);
let generation=0,alive=true,owned:typeof confirmState.current=null;
let draftReason='';
let retryBody:{enabled:boolean;reason:string;revision:number;operationId:string}|null=null;
const who=()=>`${currentProvider()}:${session.me?.accountNumId??''}`;
function clear(){generation++;data.value=null;error.value='';loading.value=false;busy.value=false;draftReason='';retryBody=null;if(owned&&confirmState.current===owned)settleConfirm(false);owned=null;}
onBeforeUnmount(()=>{alive=false;clear();});
async function access(){const token=await session.accessToken();if(!token)throw new Error(t('auth.expired'));return token;}
async function load(){
 clear();const gen=generation,identity=who(),number=props.cardNumber;loading.value=true;
 try{
  const token=await access();if(!alive||gen!==generation||identity!==who())return;
  const result=await moderationRequest<Exemption>(`/review-length-exemptions/${encodeURIComponent(number)}`,token);
  if(alive&&gen===generation&&identity===who())data.value=result;
 }catch(e){if(gen===generation)error.value=e instanceof Error?e.message:t('state.loadFailed');}
 finally{if(gen===generation)loading.value=false;}
}
watch(()=>[props.cardNumber,who()],()=>void load(),{immediate:true});
async function toggle(){
 if(!data.value||loading.value||busy.value||props.disabled)return;
 const current=data.value,enabled=!current.enabled,gen=generation,identity=who(),number=props.cardNumber;
 const valid=()=>alive&&gen===generation&&identity===who()&&!props.disabled;
 busy.value=true;error.value='';
 try{
  const options={title:t(enabled?'lengthExemption.enableTitle':'lengthExemption.disableTitle'),message:t(enabled?'lengthExemption.enableHint':'lengthExemption.disableHint',{required:new Intl.NumberFormat(locale.value).format(REVIEW_REQUIRED_CHARACTERS)}),detail:t('lengthExemption.card',{number:current.cardNumber}),confirmText:t(enabled?'lengthExemption.enable':'lengthExemption.disable'),cancelText:t('dialog.cancel'),valid};
  const pending=enabled?confirmForm({...options,field:{label:t('lengthExemption.reason'),required:true,multiline:true,maxlength:2000,initial:draftReason}}):confirmDialog(options);
  owned=confirmState.current;
  const result=await pending;owned=null;
  if(!result||!valid())return;
  const reason=typeof result==='object'?result.text:'';draftReason=reason;
  if(!retryBody||retryBody.enabled!==enabled||retryBody.reason!==reason||retryBody.revision!==current.revision)retryBody={enabled,reason,revision:current.revision,operationId:crypto.randomUUID()};
  const token=await access();if(!valid())return;
  const saved=await moderationRequest<Exemption>(`/review-length-exemptions/${encodeURIComponent(number)}`,token,retryBody);
  if(!valid())return;
  data.value=saved;retryBody=null;draftReason='';emit('change',saved.enabled);
 }catch(e){if(valid())error.value=e instanceof Error?e.message:t('state.loadFailed');}
 finally{if(gen===generation)busy.value=false;}
}
</script>

<template>
 <section class="exemption" data-length-exemption aria-live="polite" :aria-busy="loading||busy">
  <h3>{{t('lengthExemption.card',{number:cardNumber})}}</h3>
  <p v-if="loading" class="subtle">{{t('state.loading')}}</p>
  <p v-if="error" class="notice" role="alert">{{error}}</p>
  <button v-if="error" class="btn" :disabled="busy||loading" @click="load">{{t('review.refresh')}}</button>
  <template v-if="data">
   <button class="btn exemption__switch" role="switch" :aria-checked="data.enabled" :disabled="disabled||busy||loading" data-exemption-switch @click="toggle"><span aria-hidden="true">{{data.enabled?'✓':'○'}}</span>{{t('lengthExemption.label')}}</button>
   <p>{{t(data.enabled?'lengthExemption.enabled':'lengthExemption.disabled')}}</p>
   <dl v-if="data.updatedAt" class="exemption__record" data-exemption-record>
    <dt>{{t('lengthExemption.actor')}}</dt><dd>{{data.actor}}</dd>
    <dt>{{t('lengthExemption.time')}}</dt><dd>{{dateTime(data.updatedAt)}}</dd>
    <template v-if="data.enabled"><dt>{{t('lengthExemption.reason')}}</dt><dd>{{data.reason}}</dd></template>
   </dl>
   <details v-if="data.history.length"><summary>{{t('moderation.tab.history')}}</summary><ol class="exemption__history"><li v-for="(entry,index) in data.history" :key="index"><strong>{{t(entry.action==='enable'?'lengthExemption.enabled':'lengthExemption.disabled')}}</strong><p>{{entry.actor}} · {{dateTime(entry.at)}}</p><p v-if="entry.reason">{{entry.reason}}</p></li></ol></details>
  </template>
 </section>
</template>

<style scoped>
.exemption{display:grid;gap:var(--s-3);min-width:0;}
.exemption h3,.exemption p,.exemption dd{margin:0;}
.exemption__switch{justify-self:start;min-height:var(--h-lg);height:auto;white-space:normal;text-align:start;}
.exemption__record{display:grid;gap:var(--s-1);margin:0;}
.exemption__record dt{font-size:13px;color:var(--text-2);}
.exemption__record dd,.exemption__history p{white-space:pre-wrap;overflow-wrap:anywhere;}
.exemption__history{display:grid;gap:var(--s-3);padding-inline-start:var(--s-5);}
</style>
