<script setup lang="ts">
/**
 * 給作者看的說明命中內部字詞、沒有送出（ui-two-stage.md「內部字詞檢查」）：放在那個欄位上方，逐項列「命中的詞＋原句片段＋改寫提示」，
 * 結尾說內容已保留。role="alert"，出現時焦點移到第一個命中項；欄位裡的字一個都不動。
 */
import { nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { GuardHit } from "@/lib/author-note-guard";

const props = defineProps<{ hits: GuardHit[]; final?: boolean }>();
const { t } = useI18n();
const root = ref<HTMLElement | null>(null);

async function focusFirst() {
  await nextTick();
  const item = root.value?.querySelector<HTMLElement>("[data-guard-term]");
  item?.focus({ preventScroll: true });
  item?.scrollIntoView({ block: "nearest" });
}
onMounted(focusFirst);
watch(() => props.hits, focusFirst);
</script>

<template>
  <div ref="root" class="guard notice notice--error" role="alert" data-note-guard>
    <p class="guard__title">{{ t("reviewAi.guard.title") }}</p>
    <ul class="guard__list">
      <li v-for="hit in hits" :key="hit.term" class="guard__item" tabindex="-1" :data-guard-term="hit.kind ?? hit.term">
        <span class="chip guard__chip">{{ hit.kind ? t(`reviewAi.guard.term.${hit.kind}`) : hit.term }}</span>
        <p v-if="hit.snippet" class="guard__snippet" data-guard-snippet>{{ hit.snippet.before }}<mark class="guard__hit">{{ hit.snippet.hit }}</mark>{{ hit.snippet.after }}</p>
        <p v-if="hit.kind" class="guard__hint" data-guard-hint>{{ t(`reviewAi.guard.hint.${hit.kind}`) }}</p>
      </li>
    </ul>
    <p class="guard__footer">{{ t(final ? "reviewAi.guard.footerFinal" : "reviewAi.guard.footer") }}</p>
  </div>
</template>

<style scoped>
.guard { display: grid; gap: var(--s-2); min-width: 0; }
.guard p { margin: 0; }
.guard__title { font-weight: 600; overflow-wrap: anywhere; }
.guard__list { display: grid; gap: var(--s-2); margin: 0; padding: 0; list-style: none; min-width: 0; }
.guard__item { display: grid; gap: var(--s-1); justify-items: start; min-width: 0; padding-top: var(--s-2); border-top: 1px solid var(--line); }
.guard__chip { cursor: default; max-width: 100%; color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, var(--surface)); font-weight: 600; }
.guard__chip:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, var(--surface)); }
.guard__snippet { font-size: 13px; line-height: 1.6; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
.guard__hit { padding: 0 2px; color: inherit; background: color-mix(in srgb, var(--warning-text) 22%, var(--surface)); }
.guard__hint { font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; }
.guard__footer { font-size: 13px; overflow-wrap: anywhere; }
.guard__title:lang(ko), .guard__hint:lang(ko), .guard__footer:lang(ko) { word-break: keep-all; }
</style>
