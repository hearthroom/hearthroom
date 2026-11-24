<script setup lang="ts">
/**
 * 「用 AI 的」駁回定案時，給作者的說明（ui-two-stage.md「揭曉區分欄」）：預填 AI 的草稿、可以直接改，1500 字內有計數。
 * 實線強調框＋眼睛「作者會看到」，跟只有審核員看得到的虛線區塊分得開。命中內部字詞時錯誤區在欄位上方，欄位裡的字不動。
 */
import { useI18n } from "vue-i18n";
import { AUTHOR_NOTE_MAX } from "@/lib/review-ai-api";
import type { GuardHit } from "@/lib/author-note-guard";
import ReviewVisibility from "./ReviewVisibility.vue";
import ReviewAuthorNoteGuard from "./ReviewAuthorNoteGuard.vue";

defineProps<{ modelValue: string; idBase: string; disabled?: boolean; hits?: GuardHit[] | null }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const { t } = useI18n();
</script>

<template>
  <div class="author-note" data-author-note-field>
    <ReviewAuthorNoteGuard v-if="hits?.length" :hits="hits" final />
    <div class="author-note__frame">
      <div class="author-note__head">
        <label class="author-note__title" :for="`${idBase}-text`">{{ t("reviewAi.two.authorNote.title") }}</label>
        <ReviewVisibility who="author" />
      </div>
      <p :id="`${idBase}-hint`" class="subtle author-note__hint">{{ t("reviewAi.two.authorNote.prefilledHint") }}</p>
      <textarea :id="`${idBase}-text`" class="input author-note__text" rows="5" :maxlength="AUTHOR_NOTE_MAX" :value="modelValue" :disabled="disabled"
        :aria-describedby="`${idBase}-hint ${idBase}-count`" :aria-invalid="hits?.length ? 'true' : undefined" autocomplete="off" data-author-note-text
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
      <p :id="`${idBase}-count`" class="subtle author-note__count" data-author-note-count>{{ t("reviewAi.two.authorNote.count", { n: modelValue.length, max: AUTHOR_NOTE_MAX }) }}</p>
    </div>
  </div>
</template>

<style scoped>
.author-note { display: grid; gap: var(--s-2); min-width: 0; }
.author-note__frame { display: grid; gap: var(--s-2); min-width: 0; padding: var(--s-3); border: 1px solid var(--accent); border-radius: var(--r-md); background: var(--surface); }
.author-note__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-1) var(--s-2); min-width: 0; }
.author-note__title { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.author-note__hint { margin: 0; overflow-wrap: anywhere; }
.author-note__text { min-height: 140px; }
.author-note__count { margin: 0; justify-self: end; font-variant-numeric: tabular-nums; }
.author-note__hint:lang(ko) { word-break: keep-all; }
</style>
