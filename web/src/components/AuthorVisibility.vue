<script setup lang="ts">
import { computed,nextTick,onBeforeUnmount,ref,shallowRef,watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLocalePath } from '@/lib/use-locale';
import { platformPath } from '@/lib/distribution';
import { ownReferralCode,withShareRef } from '@/lib/share-ref';
import { communityRequest,type CommunityView } from '@/lib/community';
import { fetchMyCards } from '@/lib/api';
import { remaining } from '@/lib/quota';
import { wrapTab } from '@/lib/focus-trap';
import { createVisibilityController } from '@/lib/visibility-controller';
import { visibilityStateKey } from '@/lib/visibility-presentation';
import type { WorkAccess,WorkVisibility } from '@/lib/work-visibility';
import type { ProviderId } from '@/lib/provider';
import VisibilityPicker from './VisibilityPicker.vue';
import CreatorSeasonEntry from './CreatorSeasonEntry.vue';
const props=withDefaults(defineProps<{id:string;provider:ProviderId;actor:string;name:string;token:()=>Promise<string|null>;cardId?:string;inline?:boolean;editor?:boolean;dirty?:boolean;missing?:string;quotaFull?:boolean;disabled?:boolean;dialogOnly?:boolean}>(),{inline:false,editor:false});
const emit=defineEmits<{changed:[value:WorkVisibility];submit:[value:WorkVisibility];missing:[];busy:[value:boolean]}>();
const {t}=useI18n(),{lp}=useLocalePath();
const controller=shallowRef<ReturnType<typeof createVisibilityController>|null>(null);
const value=computed(()=>controller.value?.value.value??null),phase=computed(()=>controller.value?.phase.value??'ready');
const openDialog=ref(false),box=ref<HTMLElement|null>(null),shareDone=ref(false),refCode=ref<string|null>(null),invite=ref('');
let previous:HTMLElement|null=null;let generation=0;const localQuotaFull=ref(false);
const fullQuota=computed(()=>props.quotaFull??localQuotaFull.value);
async function readQuota(){if(props.quotaFull!==undefined||!value.value||value.value.everPublic)return;try{const token=await props.token();if(!token)return;const {quota}=await fetchMyCards(token,{provider:props.provider,page:1,pageSize:1});localQuotaFull.value=!!quota&&remaining(quota)===0&&(quota.packRemaining??0)===0;}catch{/* Mutations still enforce quota on the server. */}}
watch(()=>[props.id,props.provider,props.actor] as const,async()=>{
 const g=++generation;controller.value=null;refCode.value=null;invite.value='';
 if(!props.id||!props.actor)return;
 const c=createVisibilityController({id:props.id,provider:props.provider,actor:props.actor,token:props.token});controller.value=c;await c.load();
 if(g!==generation)return;
 if(props.inline)void readQuota();
 if(c.value.value&&c.value.value.restriction!=='none')try{const token=await props.token();if(token){const data=await communityRequest<CommunityView>('/me/community',token);if(g===generation)invite.value=data.invite??'';}}catch{/* The community page remains available. */}
},{immediate:true});
watch([value,phase],([v,p])=>{if(v)emit('changed',p==='ready'?v:{...v,syncState:p==='unknown'||p==='error'?'unavailable':'changing'});});
const busy=computed(()=>['loading','saving','checking'].includes(phase.value)||!!props.disabled);
const locked=computed(()=>!['ready','error'].includes(phase.value));
watch(locked,b=>emit('busy',b));
let poll:ReturnType<typeof setTimeout>|undefined;let attempts=0;
watch(phase,p=>{clearTimeout(poll);if(p==='pending'){if(attempts++<5)poll=setTimeout(()=>void controller.value?.check(),1200);else if(controller.value)controller.value.phase.value='unknown';}else if(p==='ready'||p==='error')attempts=0;});
let appInert=false;watch(openDialog,on=>{const app=document.getElementById('app');if(!app)return;if(on){appInert=app.inert;app.inert=true;}else app.inert=appInert;});
const shareUrl=computed(()=>withShareRef(new URL(platformPath(lp(`/cards/${props.cardId??props.id}`),props.provider),location.origin).href,refCode.value));
const label=computed(()=>phase.value!=='ready'?t('visibility.title'):value.value?.review==='pending'?t('mine.badge.pending'):value.value?t(`visibility.short.${value.value.access}`):t('visibility.title'));
const state=computed(()=>{if(phase.value!=='ready')return t(phase.value==='error'?'visibility.loadFailed':phase.value==='unknown'?'visibility.operation.unknown':phase.value==='saving'?'visibility.operation.updating':'visibility.operation.checking');const v=value.value;if(!v)return '';const text=t(visibilityStateKey(v,props.editor),{note:v.reviewNote??'',reason:v.restrictionNote??''});return v.access!=='public'&&v.everPublic&&v.restriction==='none'&&v.review==='none'?text+' '+t(v.actions.includes('restore_public')?'visibility.state.restoreReady':v.revisionState==='changed'?'visibility.state.reviewChanged':'visibility.state.reviewUnknown'):text;});
async function open(){if(props.actor)void ownReferralCode(props.actor,props.token,props.provider).then(code=>{refCode.value=code;});previous=document.activeElement as HTMLElement;shareDone.value=false;openDialog.value=true;if(!locked.value)await controller.value?.load();await readQuota();await nextTick();((box.value?.querySelector('input:checked:not(:disabled)')??box.value?.querySelector('button:not(:disabled)')) as HTMLElement|null)?.focus();}
function close(){if(busy.value)return;openDialog.value=false;previous?.focus();}
function keyboard(e:KeyboardEvent){if(e.key==='Escape'){e.preventDefault();close();}else wrapTab(e,box.value);}
async function apply(access:WorkAccess){
 const was=value.value?.access;await controller.value?.apply(access);
 if(controller.value?.message.value==='review_required'&&value.value){submit();return;}
 if(controller.value?.message.value==='success'&&access==='unlisted'&&was==='private'){shareDone.value=true;}
}
function submit(){if(!value.value)return;if(openDialog.value){openDialog.value=false;previous?.focus();}emit('submit',value.value);}
async function reload(){await controller.value?.load();}
defineExpose({open,reload,value});
onBeforeUnmount(()=>{generation++;clearTimeout(poll);if(openDialog.value){const app=document.getElementById('app');if(app)app.inert=appInert;}});
</script>
<template>
 <div class="author-visibility" :class="{'author-visibility--inline':inline}">
  <template v-if="inline"><h2>{{ t('visibility.title') }}</h2>
   <VisibilityPicker :value="value" :phase="disabled?'saving':phase" :new-card="!id" :dirty="dirty" :missing="missing" :quota-full="fullQuota" :share-url="shareUrl" :appeal-url="invite||lp('/me/community')" @apply="apply" @submit="submit" @cancel-review="controller?.cancelReview()" @check="controller?.check()" @reload="reload" @missing="emit('missing')"><CreatorSeasonEntry v-if="value&&!value.everPublic" where="editor" /></VisibilityPicker>
  </template>
  <template v-else-if="!dialogOnly"><p v-if="value" class="muted author-visibility__state" role="status">{{ state }}</p><button type="button" class="btn" :disabled="disabled||!id" :aria-label="`${t('visibility.title')}: ${label}`" @click="open">{{ t('visibility.title') }} <span v-if="value" class="author-visibility__short">{{ label }}</span></button></template>
  <p v-if="controller?.message.value==='conflict'" class="notice" role="status">{{ t('visibility.conflict') }}</p>
  <p v-if="controller?.message.value==='denied'" class="notice notice--error" role="alert">{{ t('state.forbidden') }}</p>
  <Teleport to="body"><div v-if="openDialog" class="modal-backdrop visibility-backdrop" @click.self="close" @keydown="keyboard"><section ref="box" class="modal panel visibility-dialog" role="dialog" aria-modal="true" aria-labelledby="visibility-dialog-title">
   <header><h2 id="visibility-dialog-title">{{ t(shareDone?'visibility.share.title':'visibility.title') }}</h2><button type="button" class="btn btn--icon" :disabled="busy" :aria-label="t('visibility.close')" @click="close">×</button></header><p class="visibility-dialog__name" :title="name">{{ name }}</p>
   <p v-if="shareDone" class="muted" role="status">{{ t('visibility.share.hint') }}</p>
   <VisibilityPicker :value="value" :phase="disabled?'saving':phase" :dirty="dirty" :missing="missing" :quota-full="fullQuota" :share-url="shareUrl" :appeal-url="invite||lp('/me/community')" primary @apply="apply" @submit="submit" @cancel-review="controller?.cancelReview()" @check="controller?.check()" @reload="reload" @missing="close();emit('missing')"><CreatorSeasonEntry v-if="value&&!value.everPublic" where="editor" /></VisibilityPicker>
   <div class="modal__actions"><button type="button" class="btn" :disabled="busy" @click="close">{{ t(shareDone?'visibility.done':'visibility.close') }}</button></div>
  </section></div></Teleport>
 </div>
</template>
<style scoped>
.author-visibility{display:flex;align-items:center;gap:var(--s-3);flex-wrap:wrap}.author-visibility__state{flex:1;min-width:0}.author-visibility--inline{display:block}.author-visibility--inline h2{margin-bottom:var(--s-3)}.author-visibility__short{font-size:12px;color:var(--text-2)}
.visibility-backdrop{z-index:105}.visibility-dialog{max-height:80dvh;overflow-y:auto;width:100%;max-width:420px}.visibility-dialog header{display:flex;align-items:center;justify-content:space-between;gap:var(--s-3)}.visibility-dialog__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2);margin-bottom:var(--s-4)}
@media(max-width:480px){.visibility-dialog header .btn--icon{width:var(--h-lg);height:var(--h-lg)}.author-visibility:not(.author-visibility--inline)>.btn{width:100%;min-height:var(--h-lg)}.author-visibility__state{flex-basis:100%}}
</style>
