<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { confirmDialog } from '@/lib/confirm';
import { replyAxes, replyOptions, replyOption, replyPlatform, replyNote, replyLengthTargets, replyIssues, type ReplyAxis } from '@/lib/response-defaults';
const props=defineProps<{modelValue?:Record<string,string>;disabled?:boolean;language?:string}>();
const emit=defineEmits<{'update:modelValue':[Record<string,string>]}>();
const {t}=useI18n();
const root=ref<HTMLElement|null>(null);
const open=ref(false);
const checked=ref(false);
const values=computed(()=>props.modelValue??{});
const notes=ref<Record<string,boolean>>({});
const issues=computed(()=>replyIssues(values.value));
const count=computed(()=>replyAxes.filter(axis=>values.value[axis]!==undefined || values.value[replyNote(axis)]?.trim() || (axis==='style'&&values.value.customStyle) || (axis==='length'&&values.value.lengthTarget)).length);
const zone=computed(()=>{const n=Number(values.value.lengthTarget);return n<=400?'brief':n<=1200?'balanced':n<=5000?'detailed':'long'});
function set(key:string,value:string|undefined){const next={...values.value};if(value===undefined)delete next[key];else next[key]=value;emit('update:modelValue',next)}
function select(axis:ReplyAxis,event:Event){
 const value=(event.target as HTMLSelectElement).value;const next={...values.value};
 if(value)next[axis]=value;else delete next[axis];
 if(axis==='style'){if(value!=='custom')delete next.customStyle;else next.customStyle??=''}
 if(axis==='length'){if(value!=='target')delete next.lengthTarget;else next.lengthTarget??='800'}
 emit('update:modelValue',next);
}
function text(key:string,event:Event){const value=(event.target as HTMLTextAreaElement).value;set(key,value.trim()?value:undefined)}
function issue(field:string){return checked.value?issues.value.find(i=>i.field===field):undefined}
function errorText(field:string){const found=issue(field);return found?t(`editor.reply.${found.key}`,{max:found.max}):''}
function hint(axis:ReplyAxis){const option=replyOption(axis,values.value[axis]);if(!option || !(replyOptions[axis] as readonly string[]).includes(option))return '';return t(`editor.reply.hint.${axis}.${axis==='length'&&option==='target'?zone.value:option}`)}
async function clear(){
 if(Object.entries(values.value).some(([key,value])=>(key==='customStyle'||key.endsWith('Note'))&&value.trim()) && !(await confirmDialog({title:t('editor.reply.clear.title'),message:t('editor.reply.clear.body'),confirmText:t('editor.reply.clear.confirm'),cancelText:t('editor.reply.clear.cancel'),danger:true,dangerAppearance:'subdued'})))return;
 emit('update:modelValue',{});checked.value=false;notes.value={};
}
function validate(){
 checked.value=true;if(!issues.value.length)return true;
 open.value=true;
 for(const axis of replyAxes)if(issues.value.some(i=>i.field===replyNote(axis)))notes.value[axis]=true;
 void nextTick(()=>{const field=root.value?.querySelector<HTMLElement>('[aria-invalid="true"]')??root.value?.querySelector<HTMLElement>('[data-reply-toggle]');field?.scrollIntoView?.({block:'center'});field?.focus()});
 return false;
}
defineExpose({validate, errorMessage:()=>{const first=issues.value[0];if(!first)return '';const axis=replyAxes.find(a=>first.field===a||first.field===replyNote(a)||a==='style'&&first.field==='customStyle');return (axis?t(`editor.reply.axis.${axis}`)+': ':'')+t(`editor.reply.${first.key}`,{max:first.max})}});
</script>

<template>
 <div ref="root" class="panel reply-defaults" data-reply-defaults>
  <div class="reply-head">
   <div class="reply-title"><h3>{{ t('editor.reply.title') }}</h3><span v-if="count" class="chip">{{ t('editor.reply.badge',{count}) }}</span></div>
   <button type="button" class="btn btn--sm reply-toggle" data-reply-toggle :aria-expanded="open" aria-controls="reply-defaults-body" :disabled="disabled" @click="open=!open">{{ t(open?'editor.state.collapse':'editor.state.expand') }}</button>
  </div>
  <div v-show="open" id="reply-defaults-body" class="reply-body">
   <p>{{ t('editor.reply.lede') }}</p><p class="reply-notice">{{ t('editor.reply.public') }}</p>
   <p v-if="checked&&issues.some(i=>i.key==='unknown.warn')" class="reply-error" role="alert">{{ t('editor.reply.unknown.warn') }}</p>
   <fieldset v-for="axis in replyAxes" :key="axis" class="reply-axis" :disabled="disabled">
    <label :for="`reply-${axis}`">{{ t(`editor.reply.axis.${axis}`) }}</label>
    <select :id="`reply-${axis}`" class="input" :data-reply-axis="axis" :value="replyOption(axis,values[axis])" :aria-invalid="!!issue(axis)" :aria-describedby="`reply-error-${axis}`" @change="select(axis,$event)">
     <option value="">{{ t('editor.reply.unset',{name:t(`editor.reply.option.${axis}.${replyPlatform[axis]}`)}) }}</option>
     <option v-if="values[axis]&&!(replyOptions[axis] as readonly string[]).includes(replyOption(axis,values[axis]))" :value="values[axis]">{{ t('editor.reply.unsupported',{value:values[axis]}) }}</option>
     <option v-for="option in replyOptions[axis]" :key="option" :value="option">{{ t(`editor.reply.option.${axis}.${option}`) }}</option>
    </select>
    <p v-if="hint(axis)" class="subtle">{{ hint(axis) }}</p>
    <p :id="`reply-error-${axis}`" class="reply-error">{{ errorText(axis) }}</p>
    <div v-if="axis==='style'&&values.style==='custom'" class="reply-text">
     <label for="reply-customStyle">{{ t('editor.reply.customStyle.label') }}</label>
     <textarea autocomplete="off" id="reply-customStyle" class="input" rows="3" :value="values.customStyle" :aria-invalid="!!issue('customStyle')" aria-describedby="reply-error-customStyle" @input="set('customStyle',($event.target as HTMLTextAreaElement).value)" />
     <span class="subtle">{{ t('editor.reply.customStyle.count',{count:[...(values.customStyle??'')].length,max:1000}) }}</span><p id="reply-error-customStyle" class="reply-error">{{ errorText('customStyle') }}</p>
    </div>
    <div v-if="axis==='length'&&values.length==='target'" class="reply-length">
     <label for="reply-lengthTarget">{{ t('editor.reply.lengthTarget.value',{count:values.lengthTarget??800}) }}</label>
     <input id="reply-lengthTarget" type="range" min="0" :max="replyLengthTargets.length-1" step="1" :value="replyLengthTargets.indexOf(Number(values.lengthTarget))" :aria-label="t('editor.reply.lengthTarget.label')" :aria-valuetext="t('editor.reply.lengthTarget.value',{count:values.lengthTarget})" @input="set('lengthTarget',String(replyLengthTargets[Number(($event.target as HTMLInputElement).value)]))" />
     <div class="reply-zones"><span v-for="z in ['brief','balanced','detailed','long']" :key="z">{{ t(`editor.reply.zone.${z}`) }}</span></div>
    </div>
    <button type="button" class="btn btn--ghost reply-note-toggle" :aria-expanded="!!(notes[axis]??values[replyNote(axis)])" :aria-controls="`reply-note-${axis}`" @click="notes[axis]=!(notes[axis]??!!values[replyNote(axis)])">{{ t(notes[axis]??values[replyNote(axis)]?'editor.reply.note.hide':'editor.reply.note.add') }}</button>
    <div v-show="notes[axis]??values[replyNote(axis)]" :id="`reply-note-${axis}`" class="reply-text">
     <label :for="`reply-${replyNote(axis)}`">{{ t('editor.reply.note.label') }}</label>
     <textarea autocomplete="off" :id="`reply-${replyNote(axis)}`" class="input" rows="2" :value="values[replyNote(axis)]" :placeholder="t(`editor.reply.note.example.${axis}`)" :aria-invalid="!!issue(replyNote(axis))" :aria-describedby="`reply-error-${replyNote(axis)}`" @input="text(replyNote(axis),$event)" />
     <span class="subtle">{{ t('editor.reply.note.count',{count:[...(values[replyNote(axis)]??'')].length,max:200}) }}</span><p :id="`reply-error-${replyNote(axis)}`" class="reply-error">{{ errorText(replyNote(axis)) }}</p>
    </div>
   </fieldset>
   <div class="reply-clear"><button type="button" class="btn btn--ghost" :disabled="disabled||!Object.keys(values).length" @click="clear">{{ t('editor.reply.clear') }}</button></div>
  </div>
 </div>
</template>
<style scoped>
.reply-defaults{gap:var(--s-3);min-width:0}.reply-head{display:flex;align-items:center;justify-content:space-between;gap:var(--s-3);flex-wrap:wrap}.reply-title{display:flex;align-items:center;gap:var(--s-2);flex-wrap:wrap;min-width:0}.reply-title h3{margin:0;font-size:15px}.reply-toggle{min-height:var(--h-sm)}.reply-body{padding-top:var(--s-2);border-top:1px solid var(--line)}.reply-body p{overflow-wrap:anywhere}.reply-notice{padding:var(--s-3);background:var(--surface-2);border-radius:var(--r-sm);font-size:13px;color:var(--text-2)}.reply-axis{border:0;border-top:1px solid var(--line);padding:var(--s-4) 0;margin:0;min-width:0}.reply-axis>label,.reply-text>label{display:block;font-weight:600;margin-bottom:var(--s-2)}.reply-axis>select{max-width:400px;min-height:var(--h-lg);text-overflow:ellipsis}.reply-text{display:grid;gap:var(--s-1);max-width:560px}.reply-text textarea{width:100%}.reply-length{max-width:400px;display:grid;gap:var(--s-2)}.reply-length input{width:100%;min-height:var(--h-lg);accent-color:var(--accent)}.reply-zones{display:flex;justify-content:space-between;font-size:12px;color:var(--text-2);gap:var(--s-2)}.reply-note-toggle{margin-top:var(--s-2);min-height:var(--h-lg)}.reply-clear{display:flex;justify-content:flex-end}.reply-clear .btn{min-height:var(--h-lg)}.reply-error{color:var(--danger);font-size:13px}.reply-error:empty{display:none}[aria-invalid=true]{border-color:var(--danger)}@media(max-width:760px){.reply-toggle{min-height:var(--h-lg)}}:lang(ko) p{word-break:keep-all}:lang(ja) p{word-break:auto-phrase}
</style>
