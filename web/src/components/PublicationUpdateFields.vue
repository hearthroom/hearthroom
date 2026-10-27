<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { normalizeUpdateNote, UPDATE_NOTE_MIN, UPDATE_NOTE_MAX, type UpdateIntent } from '../../../shared/card-update';
const props=defineProps<{modelValue:UpdateIntent;nextMajorUpdateAt?:number;now:number;disabled?:boolean}>();
const emit=defineEmits<{ 'update:modelValue':[UpdateIntent]; retry:[] }>();
const {t,locale}=useI18n();
const unavailable=computed(()=>props.nextMajorUpdateAt===undefined||props.nextMajorUpdateAt>props.now);
const count=computed(()=>[...normalizeUpdateNote(props.modelValue.updateNote)].length);
const nonspace=computed(()=>[...normalizeUpdateNote(props.modelValue.updateNote).replace(/\p{White_Space}/gu,'')].length);
const noteError=computed(()=>!count.value?'cardUpdate.update.noteRequired':count.value>UPDATE_NOTE_MAX?'cardUpdate.update.noteTooLong':nonspace.value<UPDATE_NOTE_MIN?'cardUpdate.update.noteTooShort':'');
const availableAt=computed(()=>props.nextMajorUpdateAt?new Intl.DateTimeFormat(locale.value,{dateStyle:'medium',timeStyle:'long'}).format(props.nextMajorUpdateAt):'');
function choose(updateKind:UpdateIntent['updateKind']){emit('update:modelValue',{...props.modelValue,updateKind});}
</script>
<template>
  <fieldset class="publication-fields" :disabled="disabled">
    <legend>{{ t('cardUpdate.update.type') }}</legend>
    <label class="publication-choice">
      <input type="radio" name="publication-update" data-update-choice="minor" :checked="modelValue.updateKind==='minor'" @change="choose('minor')" />
      <span><strong>{{ t('cardUpdate.update.minor') }}</strong><small>{{ t('cardUpdate.update.minorHint') }}</small></span>
    </label>
    <label class="publication-choice">
      <input type="radio" name="publication-update" data-update-choice="major" :checked="modelValue.updateKind==='major'" :disabled="disabled||unavailable" aria-describedby="publication-eligibility" @change="choose('major')" />
      <span><strong>{{ t('cardUpdate.update.major') }}</strong><small>{{ t('cardUpdate.update.majorHint') }}</small></span>
    </label>
    <p v-if="nextMajorUpdateAt===undefined" id="publication-eligibility" class="subtle" role="status">{{ t('cardUpdate.update.loadError') }} <button type="button" class="link" @click="emit('retry')">{{ t('cardUpdate.update.retryEligibility') }}</button></p>
    <p v-else-if="unavailable" id="publication-eligibility" class="subtle" role="status">{{ t('cardUpdate.update.noticeAvailableAt',{availableAt}) }}</p>
    <div v-if="modelValue.updateKind==='major'" class="field publication-note">
      <label for="publication-note">{{ t('cardUpdate.update.note') }}</label>
      <textarea id="publication-note" class="input" data-update-note :value="modelValue.updateNote" :aria-invalid="!!noteError" aria-describedby="publication-note-hint publication-note-error" autocomplete="off" @input="emit('update:modelValue',{...modelValue,updateNote:($event.target as HTMLTextAreaElement).value})" :placeholder="t('cardUpdate.update.notePlaceholder')" />
      <p id="publication-note-hint" class="subtle">{{ t('cardUpdate.update.noteHint') }} {{ t('cardUpdate.update.noteLength',{min:UPDATE_NOTE_MIN,limit:UPDATE_NOTE_MAX}) }}</p>
      <p class="subtle publication-count">{{ t('cardUpdate.update.noteCount',{count,limit:UPDATE_NOTE_MAX}) }}</p>
      <p v-if="noteError" id="publication-note-error" class="publication-error" role="status">{{ t(noteError,{min:UPDATE_NOTE_MIN,limit:UPDATE_NOTE_MAX}) }}</p>
    </div>
    <p class="subtle">{{ t('cardUpdate.update.intervalHint',{days:7},7) }} {{ t('cardUpdate.update.deliveryHint') }}</p>
  </fieldset>
</template>
<style scoped>
.publication-fields { display:grid; gap:var(--s-3); border:0; padding:0; margin:0; min-width:0; }
legend { font-size:13px; font-weight:600; padding:0 0 var(--s-2); }
.publication-choice { display:flex; gap:var(--s-3); align-items:flex-start; padding:var(--s-3); border:1px solid var(--border); border-radius:var(--r-sm); cursor:pointer; min-height:var(--h-lg); }
.publication-choice:has(input:checked) { background:var(--accent-soft); border-color:var(--accent); }
.publication-choice input { margin-top:var(--s-1); accent-color:var(--accent); flex-shrink:0; }
.publication-choice span { min-width:0; }
.publication-choice strong { display:block; font-size:14px; font-weight:600; }
.publication-choice small { display:block; color:var(--text-2); font-size:13px; line-height:1.6; overflow-wrap:anywhere; }
.publication-note { gap:var(--s-2); margin:0; }
.publication-note textarea { width:100%; min-height:140px; resize:vertical; }
.publication-count { text-align:end; }
.publication-error { color:var(--danger); font-size:13px; }
</style>
