<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {retentionText} from '@/lib/reward-retention';
import { requiresFirstRegistration, type WorkAccess, type WorkVisibility } from '@/lib/work-visibility';
import QuotaDeviceHelp from './QuotaDeviceHelp.vue';
import { noteShareLinkCreated } from '@/lib/share-ref';
const props=withDefaults(defineProps<{value:WorkVisibility|null;phase:string;dirty?:boolean;missing?:string;previewMissing?:boolean;quotaFull?:boolean;quotaShared?:boolean;shareUrl?:string;shareRole?:string;newCard?:boolean;primary?:boolean;appealUrl?:string;resumeAction?:string;selectPublic?:number}>(),{dirty:false,quotaFull:false,quotaShared:false});
const emit=defineEmits<{apply:[access:WorkAccess];submit:[];cancelReview:[];check:[];resume:[];reload:[];missing:[];cover:[]}>();
const {t}=useI18n();const uid=useId();
const selected=ref<WorkAccess|null>(null),cancel=ref(false),copied=ref(false),copyFailed=ref(false);
const options:WorkAccess[]=['private','unlisted','public'];
const busy=computed(()=>!['ready','error'].includes(props.phase));
const pending=computed(()=>props.value?.review==='pending'||props.value?.update==='pending');
watch(()=>[props.value,props.phase,props.resumeAction] as const,([v,phase,action])=>{
 selected.value=phase==='retryable'?(action==='private'?'private':action==='link'?'unlisted':action==='restore'?'public':v?.access??null):v?.access??null;
 cancel.value=phase==='retryable'&&action==='cancelReview';
},{immediate:true});
watch(()=>props.selectPublic,n=>{if(n){selected.value='public';cancel.value=false;}});
const update=computed(()=>selected.value==='public'&&props.value?.access==='public'&&props.value.actions.includes('submit_update'));
const changed=computed(()=>selected.value!==props.value?.access||cancel.value||update.value);
const review=computed(()=>selected.value==='public'&&!props.value?.actions.includes('restore_public'));
const canSubmit=computed(()=>!!props.value?.actions.some(action=>action==='submit_review'||action==='submit_update'));
const delistedReview=computed(()=>props.value?.restriction==='delisted'&&canSubmit.value&&!props.value.actions.includes('restore_public'));
const registrationQuotaFull=computed(()=>props.quotaFull&&!!props.value&&requiresFirstRegistration(props.value)&&!props.value.actions.includes('restore_public'));
const quotaBlocked=computed(()=>props.value?.restriction==='none'&&!pending.value&&!props.dirty&&!props.missing&&registrationQuotaFull.value);
function disabled(access:WorkAccess){
 if(props.newCard||busy.value||!props.value||props.value.syncState!=='complete')return true;
 if(access===props.value.access&&access!=='public')return false;
 if(access==='private')return !props.value.actions.includes('set_private');
 if(access==='unlisted')return !props.value.actions.includes('set_unlisted');
 return pending.value||(props.value.restriction!=='none'&&!delistedReview.value)||props.dirty||!!props.missing||registrationQuotaFull.value||(!props.value.actions.includes('restore_public')&&!canSubmit.value);
}
const effect=computed(()=>{
 const v=props.value;if(!v||!selected.value)return '';
 if(!cancel.value&&selected.value==='public'&&delistedReview.value)return t('visibility.effect.delistedUpdate');
 const n=cancel.value?8:selected.value==='public'?(review.value?3:4):selected.value==='unlisted'?(v.access==='public'?5:1):(v.access==='public'?6:2);
 return t(`visibility.effect.t${n}`,{access:t(`visibility.option.${v.access}`)});
});
const button=computed(()=>t(`visibility.action.${cancel.value?'cancelReview':selected.value==='private'?'private':selected.value==='unlisted'?'link':review.value?'submit':'restore'}`));
function apply(){if(!changed.value||busy.value)return;if(cancel.value)emit('cancelReview');else if(selected.value==='public'&&review.value)emit('submit');else if(selected.value)emit('apply',selected.value);}
function select(access:WorkAccess){if(!disabled(access)){selected.value=access;cancel.value=false;}}
function arrow(event:KeyboardEvent,access:WorkAccess){
 if(!['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(event.key))return;event.preventDefault();
 const step=['ArrowDown','ArrowRight'].includes(event.key)?1:-1;let index=options.indexOf(access);
 for(let i=0;i<options.length;i++){index=(index+step+options.length)%options.length;const next=options[index]!;if(!disabled(next)){select(next);(event.currentTarget as HTMLElement).closest('[role=radiogroup]')?.querySelector<HTMLInputElement>(`input[value="${next}"]`)?.focus();break;}}
}
const urlInput=ref<HTMLInputElement|null>(null);
let copyTimer:ReturnType<typeof setTimeout>|undefined;onBeforeUnmount(()=>clearTimeout(copyTimer));
// 複製了卡片連結（含剪貼簿拿不到、改成自己選字複製）：新手七日「分享一張卡」要算到
async function copy(){try{await navigator.clipboard.writeText(props.shareUrl??'');copied.value=true;clearTimeout(copyTimer);copyTimer=setTimeout(()=>copied.value=false,1600);void noteShareLinkCreated(props.shareRole);}catch{copyFailed.value=true;urlInput.value?.select();void noteShareLinkCreated(props.shareRole);}}
</script>
<template>
 <div class="visibility-picker" :aria-busy="phase==='loading'||phase==='saving'||phase==='checking'">
  <p v-if="newCard" class="notice">{{ t('visibility.new') }}</p>
  <template v-else-if="phase==='loading'"><div v-for="n in 3" :key="n" class="ghost visibility-skeleton" /></template>
  <div v-else-if="phase==='error'" class="notice notice--error" role="alert">{{ t('visibility.loadFailed') }} <button type="button" class="btn visibility-reload" @click="emit('reload')">{{ t('visibility.reload') }}</button></div>
  <template v-else>
   <div v-if="value?.rewardRetention" class="notice" data-reward-retention role="status"><p>{{ t('rewardRetention.lock.badge') }}</p><p>{{ retentionText('lock.reason',value.rewardRetention) }}</p></div>
   <div role="radiogroup" :aria-label="t('visibility.title')" class="visibility-options">
    <label v-for="access in options" :key="access" class="visibility-option" :class="{'visibility-option--selected':selected===access&&!disabled(access),'visibility-option--disabled':disabled(access)}">
     <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75">
      <template v-if="access==='private'"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></template>
      <template v-else-if="access==='unlisted'"><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/></template>
      <template v-else><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></template>
     </svg>
     <span class="visibility-option__body"><span class="visibility-option__title">{{ t(`visibility.option.${access}`) }} <span v-if="value?.access===access&&phase==='ready'" class="chip">{{ t('visibility.current') }}</span><span v-if="access==='public'&&value&&value.restriction!=='none'" class="chip visibility-option__restriction">{{ t(`visibility.badge.${value.restriction}`) }}</span></span>
      <span :id="`${uid}-${access}`" class="visibility-option__description">{{ t(access==='public'&&delistedReview?'visibility.description.delisted':`visibility.description.${access}`) }}</span>
      <span v-if="access==='unlisted'&&previewMissing" class="subtle" data-cover-reminder><span aria-hidden="true">ⓘ </span>{{ t('visibility.cover.previewHint') }} <button type="button" class="link cover-upload" @click.prevent="emit('cover')">{{ t('editor.cover.upload') }}</button></span>
      <template v-if="access==='public'&&value">
       <span v-if="value.restriction!=='none'" class="visibility-option__reason">{{ t(`visibility.restriction.${value.restriction}`,{reason:value.restrictionNote??''}).split('Discord')[0] }}<a :href="appealUrl" target="_blank" rel="noopener">Discord</a>{{ t(`visibility.restriction.${value.restriction}`,{reason:value.restrictionNote??''}).split('Discord')[1] }}</span>
       <span v-else-if="pending" class="visibility-option__reason">{{ t(value.update==='pending'?'visibility.badge.updatePending':'mine.badge.pending') }}</span>
       <span v-else-if="dirty" class="visibility-option__reason">{{ t('visibility.saveFirst') }}</span>
       <button v-else-if="missing" type="button" class="link visibility-missing" @click.prevent="emit('missing')">{{ t('visibility.missing',{fields:missing}) }}</button>
       <span v-else-if="registrationQuotaFull" class="visibility-option__reason">{{ t(quotaShared?'mine.quota.exceededDevice':'mine.quota.exceeded') }}</span>
       <span v-else-if="value.actions.includes('restore_public')" class="visibility-option__reason">{{ t('visibility.public.restore') }}</span>
       <span v-else-if="value.revisionState==='changed'" class="visibility-option__reason">{{ t('visibility.public.changed') }}</span>
       <span v-else-if="value.everPublic" class="visibility-option__reason">{{ t('visibility.public.unknown') }}</span>
       <span v-if="value.review==='rejected'" class="visibility-option__reason">{{ t('mine.note.rejected',{note:value.reviewNote??''}) }}</span>
      </template>
     </span>
     <input type="radio" :name="uid" :value="access" :checked="selected===access" :disabled="disabled(access)" :aria-describedby="`${uid}-${access}`" @change="select(access)" @keydown="arrow($event,access)" />
    </label>
   </div>
   <QuotaDeviceHelp v-if="quotaBlocked&&quotaShared" class="visibility-quota-help" />
   <button v-if="value?.actions.includes('cancel_review')" type="button" class="btn btn--ghost" :disabled="busy" @click="cancel=true;selected=value?.access??null">{{ t('visibility.action.cancelReview') }}</button>
   <div v-if="changed&&value" class="notice visibility-effect" role="status">
    <p v-if="pending&&!cancel&&value.review==='pending'">{{ t('visibility.review.cancelling') }}</p><p>{{ effect }}</p>
    <p v-if="selected==='unlisted'&&!cancel">{{ t('visibility.link.savedContent') }}</p>
    <p v-if="dirty&&!cancel&&selected!=='public'">{{ t('visibility.change.unsaved') }}</p>
    <p v-if="value.update==='pending'&&!cancel&&selected!=='public'">{{ t('visibility.review.cancelUpdate') }}</p>
    <p v-if="selected==='private'&&!cancel&&value.draftChanged">{{ t('visibility.review.keepEdits') }}</p>
   </div>
   <slot v-if="selected==='public'&&review&&changed" />
   <div v-if="value&&value.access!=='private'&&shareUrl&&!busy" class="visibility-link"><input ref="urlInput" class="input" readonly :value="shareUrl" :aria-label="t('visibility.copy')" /><button type="button" class="btn" @click="copy">{{ t(copied?'visibility.copied':'visibility.copy') }}</button></div>
   <p v-if="copied||copyFailed" role="status" class="muted">{{ t(copyFailed?'visibility.copyFailed':'visibility.copied') }}</p>
   <div v-if="busy" class="notice" role="status"><p>{{ t(phase==='retryable'&&resumeAction==='cancelReview'?'visibility.operation.retryCancel':phase==='saving'?'visibility.operation.updating':phase==='unknown'||phase==='retryable'?'visibility.operation.unknown':'visibility.operation.checking') }}</p><button v-if="phase==='unknown'||phase==='retryable'||phase==='pending'" data-visibility-check type="button" class="btn" @click="emit('check')">{{ t('visibility.operation.checkStatus') }}</button><button v-if="phase==='retryable'" data-visibility-resume type="button" class="btn" @click="emit('resume')">{{ resumeAction?t(`visibility.action.${resumeAction}`):button }}</button></div>
   <div v-if="changed" class="visibility-actions"><button type="button" class="btn btn--ghost" :disabled="busy" @click="selected=value?.access??null;cancel=false">{{ t('visibility.reset') }}</button><button type="button" class="btn" :class="{'btn--primary':primary}" data-visibility-apply :disabled="busy||(!cancel&&!!selected&&disabled(selected))" @click="apply">{{ button }}</button></div>
  </template>
 </div>
</template>
<style scoped>
.visibility-option__reason{font-size:13px;overflow-wrap:anywhere;line-height:1.6}
.visibility-option__reason{color:var(--text)}
.visibility-quota-help{margin-top:var(--s-1)}
.visibility-missing{border:0;background:none;padding:0;font:inherit;font-size:13px;line-height:1.6;text-align:start;cursor:pointer;overflow-wrap:anywhere;min-height:var(--h-lg)}
.cover-upload{border:0;background:none;padding:0;color:var(--accent-text);font:inherit;cursor:pointer;min-height:var(--h-sm)}
.visibility-option__restriction{color:var(--danger);cursor:default;max-width:100%}
.visibility-option__restriction::before{content:"";flex:none;width:var(--s-1);height:var(--s-1);border-radius:var(--r-pill);background:currentColor}
.visibility-skeleton{height:72px;border-radius:var(--r-sm);margin-bottom:var(--s-2)}
.visibility-link{display:flex;gap:var(--s-2);margin-top:var(--s-4)}.visibility-link input{min-width:0;flex:1}.visibility-link button{flex-shrink:0}
.visibility-effect{font-size:13px;background:var(--surface-2);color:var(--text)}.visibility-effect p+p{margin-top:var(--s-2)}
.visibility-actions{display:flex;justify-content:flex-end;gap:var(--s-2);margin-top:var(--s-4)}
:lang(ko){word-break:keep-all}
@media(max-width:480px){.visibility-reload{min-height:var(--h-lg)}.visibility-actions{flex-direction:column-reverse}.visibility-actions .btn{min-height:var(--h-lg);height:auto;white-space:normal}.visibility-link{flex-wrap:wrap}.visibility-link input{flex-basis:100%}}
</style>
