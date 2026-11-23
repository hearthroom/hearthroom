<script setup lang="ts">
/**
 * 「給 AI 的說明（選填）」：可多選的原因類型＋一段 500 字內的說明（有 N／500 計數）。
 * 兩段式定案與 AI 分歧仲裁共用（ui-two-stage.md「給 AI 的說明」）。只用來調整 AI 的判準，不給作者看；
 * 都選填，選了類型不寫說明也可以送出。
 *
 * collapsible：結論一致、一鍵定案時收合成「＋ 給 AI 的說明（選填）」，不增加定案的步驟；已經填了東西就保持展開。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { AI_NOTE_MAX, AI_NOTE_TYPES, type AiNoteType } from "@/lib/review-ai-api";

const props = defineProps<{ types: AiNoteType[]; note: string; context: "final" | "arbitration"; idBase: string; disabled?: boolean; collapsible?: boolean }>();
const emit = defineEmits<{ "update:types": [value: AiNoteType[]]; "update:note": [value: string] }>();
const { t } = useI18n();

const opened = ref(false);
const open = computed(() => !props.collapsible || opened.value || props.types.length > 0 || !!props.note);
function toggleType(type: AiNoteType, on: boolean) {
  const next = new Set(props.types);
  if (on) next.add(type); else next.delete(type);
  emit("update:types", AI_NOTE_TYPES.filter((x) => next.has(x)));
}
const bodyId = computed(() => `${props.idBase}-body`);
</script>

<template>
  <div class="ai-note" data-ai-note>
    <button v-if="collapsible" type="button" class="btn btn--ghost btn--sm ai-note__toggle" :aria-expanded="open" :aria-controls="bodyId" data-ai-note-toggle @click="opened = !open">
      {{ open ? "−" : "＋" }} {{ t("reviewAi.note.title") }}
    </button>
    <fieldset v-show="open" :id="bodyId" class="ai-note__body">
      <legend :class="collapsible ? 'sr-only' : 'ai-note__title'">{{ t("reviewAi.note.title") }}</legend>
      <p class="subtle ai-note__sub">{{ t(context === "arbitration" ? "reviewAi.note.subArbitration" : "reviewAi.note.subFinal") }}</p>
      <div class="ai-note__types" role="group" :aria-label="t('reviewAi.note.types')">
        <label v-for="type in AI_NOTE_TYPES" :key="type" class="ai-note__type" :class="{ 'ai-note__type--on': types.includes(type) }">
          <input type="checkbox" :checked="types.includes(type)" :disabled="disabled" :data-ai-note-type="type" @change="toggleType(type, ($event.target as HTMLInputElement).checked)" />
          <span class="ai-note__name">{{ t(`reviewAi.note.type.${type}`) }}</span>
          <span v-if="type === 'author_relation'" class="ai-note__hint">{{ t("reviewAi.note.authorRelationHint") }}</span>
        </label>
      </div>
      <label class="ai-note__label" :for="`${idBase}-text`">{{ t("reviewAi.note.label") }}</label>
      <textarea :id="`${idBase}-text`" class="input ai-note__text" rows="3" :maxlength="AI_NOTE_MAX" :value="note" :disabled="disabled"
        :placeholder="t('reviewAi.note.placeholder')" :aria-describedby="`${idBase}-count`" autocomplete="off" data-ai-note-text
        @input="emit('update:note', ($event.target as HTMLTextAreaElement).value)" />
      <p :id="`${idBase}-count`" class="subtle ai-note__count" data-ai-note-count>{{ t("reviewAi.note.count", { n: note.length, max: AI_NOTE_MAX }) }}</p>
    </fieldset>
  </div>
</template>

<style scoped>
.ai-note { display: grid; gap: var(--s-2); min-width: 0; }
.ai-note__toggle { justify-self: start; min-height: var(--h-md); padding-inline-start: 0; }
/* fieldset 預設 min-inline-size: min-content，長字會把整個決定區撐出螢幕 */
.ai-note__body { border: 0; margin: 0; padding: 0; min-width: 0; min-inline-size: 0; display: grid; gap: var(--s-2); }
.ai-note__title { padding: 0; margin-bottom: var(--s-1); font-size: 14px; font-weight: 600; }
.ai-note__sub { margin: 0; overflow-wrap: anywhere; }
.ai-note__types { display: flex; flex-wrap: wrap; gap: var(--s-2); min-width: 0; }
/* 多選的原因類型：膠囊；選中用 accent 淡底（實心留給主按鈕） */
.ai-note__type { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px var(--s-2); min-height: var(--h-md); max-width: 100%; padding: var(--s-1) var(--s-3); border: 1px solid var(--border); border-radius: var(--r-pill); cursor: pointer; font-size: 13px; }
.ai-note__type input { flex: none; width: 16px; height: 16px; margin: 0; }
.ai-note__type--on { border-color: var(--accent); background: var(--accent-tint); color: var(--accent-text); }
.ai-note__name { font-weight: 600; overflow-wrap: anywhere; }
.ai-note__hint { font-size: 12px; color: var(--text-2); overflow-wrap: anywhere; }
.ai-note__label { font-size: 13px; font-weight: 600; }
.ai-note__text { min-height: 96px; }
.ai-note__count { margin: 0; justify-self: end; font-variant-numeric: tabular-nums; }
.ai-note__sub:lang(ko), .ai-note__hint:lang(ko) { word-break: keep-all; }
</style>
