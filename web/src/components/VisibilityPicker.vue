<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { WorkAccess, WorkVisibility } from '@/lib/work-visibility';
const props=withDefaults(defineProps<{value:WorkVisibility|null;phase:string;dirty?:boolean;missing?:string;quotaFull?:boolean;shareUrl?:string;newCard?:boolean;primary?:boolean;appealUrl?:string;resumeAction?:string}>(),{dirty:false,quotaFull:false});
const emit=defineEmits<{apply:[access:WorkAccess];submit:[];cancelReview:[];check:[];resume:[];reload:[];missing:[]}>();
const {t}=useI18n();const uid=useId();
const selected=ref<WorkAccess|null>(null),cancel=ref(false),copied=ref(false),copyFailed=ref(false);
const options:WorkAccess[]=['private','unlisted','public'];
const busy=computed(()=>!['ready','error'].includes(props.phase));
const pending=computed(()=>props.value?.review==='pending'||props.value?.update==='pending');
watch(()=>[props.value,props.phase,props.resumeAction] as const,([v,phase,action])=>{
 selected.value=phase==='retryable'?(action==='private'?'private':action==='link'?'unlisted':action==='restore'?'public':v?.access??null):v?.access??null;
 cancel.value=phase==='retryable'&&action==='cancelReview';
},{immediate:true});
const update=computed(()=>selected.value==='public'&&props.value?.access==='public'&&props.value.actions.includes('submit_update'));
const changed=computed(()=>selected.value!==props.value?.access||cancel.value||update.value);
const review=computed(()=>selected.value==='public'&&!props.value?.actions.includes('restore_public'));
function disabled(access:WorkAccess){
 if(props.newCard||busy.value||!props.value||props.value.syncState!=='complete')return true;
 if(access===props.value.access&&access!=='public')return false;
 if(access==='private')return !props.value.actions.includes('set_private');
 if(access==='unlisted')return !props.value.actions.includes('set_unlisted');
 return pending.value||props.value.restriction!=='none'||props.dirty||!!props.missing||(!props.value.actions.includes('restore_public')&&(!props.value.actions.some(action=>action==='submit_review'||action==='submit_update')||props.quotaFull));
}
const effect=computed(()=>{
 const v=props.value;if(!v||!selected.value)return '';
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
async function copy(){try{await navigator.clipboard.writeText(props.shareUrl??'');copied.value=true;clearTimeout(copyTimer);copyTimer=setTimeout(()=>copied.value=false,1600);}catch{copyFailed.value=true;urlInput.value?.select();}}
</script>
<template>
 <div class="visibility-picker" :aria-busy="phase==='loading'||phase==='saving'||phase==='checking'">
  <p v-if="newCard" class="notice">{{ t('visibility.new') }}</p>
  <template v-else-if="phase==='loading'"><div v-for="n in 3" :key="n" class="ghost visibility-skeleton" /></template>
  <div v-else-if="phase==='error'" class="notice notice--error" role="alert">{{ t('visibility.loadFailed') }} <button type="button" class="btn visibility-reload" @click="emit('reload')">{{ t('visibility.reload') }}</button></div>
  <template v-else>
   <div role="radiogroup" :aria-label="t('visibility.title')" class="visibility-options">
    <label v-for="access in options" :key="access" class="visibility-option" :class="{'visibility-option--selected':selected===access&&!disabled(access),'visibility-option--disabled':disabled(access)}">
     <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75">
      <template v-if="access==='private'"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></template>
      <template v-else-if="access==='unlisted'"><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/></template>
      <template v-else><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></template>
     </svg>
     <span class="visibility-option__body"><span class="visibility-option__title">{{ t(`visibility.option.${access}`) }} <span v-if="value?.access===access&&phase==='ready'" class="chip">{{ t('visibility.current') }}</span><span v-if="access==='public'&&value&&value.restriction!=='none'" class="chip visibility-option__restriction">{{ t(`visibility.badge.${value.restriction}`) }}</span></span>
      <span :id="`${uid}-${access}`" class="visibility-option__description">{{ t(`visibility.description.${access}`) }}</span>
      <template v-if="access==='public'&&value">
       <span v-if="value.restriction!=='none'" class="visibility-option__reason">{{ t(`visibility.restriction.${value.restriction}`,{reason:value.restrictionNote??''}).split('Discord')[0] }}<a :href="appealUrl" target="_blank" rel="noopener">Discord</a>{{ t(`visibility.restriction.${value.restriction}`,{reason:value.restrictionNote??''}).split('Discord')[1] }}</span>
       <span v-else-if="pending" class="visibility-option__reason">{{ t(value.update==='pending'?'visibility.badge.updatePending':'mine.badge.pending') }}</span>
       <span v-else-if="dirty" class="visibility-option__reason">{{ t('visibility.saveFirst') }}</span>
       <button v-else-if="missing" type="button" class="link" @click.prevent="emit('missing')">{{ t('visibility.missing',{fields:missing}) }}</button>
       <span v-else-if="quotaFull&&!value.actions.includes('restore_public')" class="visibility-option__reason">{{ t('mine.quota.exceeded') }}</span>
       <span v-else-if="value.actions.includes('restore_public')" class="visibility-option__reason">{{ t('visibility.public.restore') }}</span>
       <span v-else-if="value.revisionState==='changed'" class="visibility-option__reason">{{ t('visibility.public.changed') }}</span>
       <span v-else-if="value.everPublic" class="visibility-option__reason">{{ t('visibility.public.unknown') }}</span>
       <span v-if="value.review==='rejected'" class="visibility-option__reason">{{ t('mine.note.rejected',{note:value.reviewNote??''}) }}</span>
      </template>
     </span>
     <input type="radio" :name="uid" :value="access" :checked="selected===access" :disabled="disabled(access)" :aria-describedby="`${uid}-${access}`" @change="select(access)" @keydown="arrow($event,access)" />
    </label>
   </div>
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
   <div v-if="busy" class="notice" role="status"><p>{{ t(phase==='saving'?'visibility.operation.updating':phase==='unknown'||phase==='retryable'?'visibility.operation.unknown':'visibility.operation.checking') }}</p><button v-if="phase==='unknown'||phase==='retryable'||phase==='pending'" data-visibility-check type="button" class="btn" @click="emit('check')">{{ t('visibility.operation.checkStatus') }}</button><button v-if="phase==='retryable'" data-visibility-resume type="button" class="btn" @click="emit('resume')">{{ resumeAction?t(`visibility.action.${resumeAction}`):button }}</button></div>
   <div v-if="changed" class="visibility-actions"><button type="button" class="btn btn--ghost" :disabled="busy" @click="selected=value?.access??null;cancel=false">{{ t('visibility.reset') }}</button><button type="button" class="btn" :class="{'btn--primary':primary}" data-visibility-apply :disabled="busy||(!cancel&&!!selected&&disabled(selected))" @click="apply">{{ button }}</button></div>
  </template>
 </div>
</template>
<style scoped>
.visibility-options{display:grid;gap:var(--s-2)}
.visibility-option{display:flex;align-items:flex-start;gap:var(--s-3);padding:var(--s-3);min-height:56px;border:1.5px solid var(--border-strong);border-radius:var(--r-sm);cursor:pointer;color:var(--text)}
.visibility-option--selected{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 5%,var(--surface))}
.visibility-option--disabled{cursor:default}
.visibility-option svg{width:20px;height:20px;flex-shrink:0;margin-top:var(--s-1)}
.visibility-option input{accent-color:var(--accent);flex-shrink:0;width:20px;height:20px;margin-top:var(--s-1)}
.visibility-option__body{min-width:0;flex:1;display:grid;gap:var(--s-1)}
.visibility-option__title{font-size:15px;font-weight:600;display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-2)}
.visibility-option__description,.visibility-option__reason{font-size:13px;color:var(--text-2);overflow-wrap:anywhere;line-height:1.6}
.visibility-option__reason{color:var(--text)}
.visibility-option__restriction{color:var(--danger);cursor:default;max-width:100%}
.visibility-option__restriction::before{content:"";flex:none;width:var(--s-1);height:var(--s-1);border-radius:var(--r-pill);background:currentColor}
.visibility-skeleton{height:72px;border-radius:var(--r-sm);margin-bottom:var(--s-2)}
.visibility-link{display:flex;gap:var(--s-2);margin-top:var(--s-4)}.visibility-link input{min-width:0;flex:1}.visibility-link button{flex-shrink:0}
.visibility-effect{font-size:13px;background:var(--surface-2);color:var(--text)}.visibility-effect p+p{margin-top:var(--s-2)}
.visibility-actions{display:flex;justify-content:flex-end;gap:var(--s-2);margin-top:var(--s-4)}
:lang(ko){word-break:keep-all}
@media(max-width:480px){.visibility-reload{min-height:var(--h-lg)}.visibility-actions{flex-direction:column-reverse}.visibility-actions .btn{min-height:var(--h-lg);height:auto;white-space:normal}.visibility-link{flex-wrap:wrap}.visibility-link input{flex-basis:100%}}
</style>
