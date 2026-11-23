<script setup lang="ts">
/**
 * 駁回理由的「給選項的三種做法」（審卡 V2，目前只有「沒有接話點」有）：每項名稱、一句說明、範例。
 * 作者結果頁與審核員的即時預覽共用，小標由各自的版面畫（結果頁是 dt，預覽是行內標籤）。
 * [choices] 那一項的範例是作者要照打的標記：等寬、照原樣換行，長字在窄螢幕斷開，不撐寬版面。
 */
import { useI18n } from "vue-i18n";
import { REASON_OPTION_WAYS, reasonOptionKey } from "@/lib/review-reasons";

defineProps<{ code: string }>();
const { t } = useI18n();
</script>

<template>
  <ul class="ways">
    <li v-for="w in REASON_OPTION_WAYS" :key="w" class="way" :data-option="w">
      <p class="way__name">{{ t(reasonOptionKey(code, `${w}.name`)) }}</p>
      <p class="way__desc">{{ t(reasonOptionKey(code, `${w}.desc`)) }}</p>
      <template v-if="w === 'tag'">
        <p class="way__label">{{ t("reviewV2.author.example") }}</p>
        <pre class="way__code" data-choices-example>{{ t(reasonOptionKey(code, `${w}.example`)) }}</pre>
      </template>
      <p v-else class="way__ex"><span class="way__label">{{ t("reviewV2.author.example") }}</span>{{ t(reasonOptionKey(code, `${w}.example`)) }}</p>
    </li>
  </ul>
</template>

<style scoped>
.ways { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); min-width: 0; overflow-wrap: anywhere; }
.way { display: grid; gap: var(--s-1); min-width: 0; }
.way p { margin: 0; }
.way__name { font-weight: 600; }
/* 英韓的編號選項之間是兩個空白，照原樣保留 */
.way__ex { color: var(--text-2); white-space: pre-wrap; }
.way__label { font-weight: 600; color: var(--text-2); margin-inline-end: var(--s-2); }
/* 等寬區塊：不用 overflow-x 捲動，照原樣換行、長字斷開，手機上不會把版面撐寬 */
.way__code {
  margin: 0; min-width: 0; padding: var(--s-2) var(--s-3);
  border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); color: var(--text);
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.ways:lang(ko) { word-break: keep-all; }
.ways:lang(ja) { word-break: auto-phrase; }
</style>
