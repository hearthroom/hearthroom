<script setup lang="ts">
/**
 * 一段字裡的「金額＋單位」（10,000 積分、10,000ポイント、10,000 credits）不斷開：包成不換行的片段，其餘照常斷行。
 * 不斷行空格只擋得住空格，擋不住中文、日文字與字之間的斷行（「10,000 積／分」），所以要包起來。
 * 單位讀這個語言的 creator.mine.unit，跟畫面上其他地方同一個字。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ text: string }>();
const { t } = useI18n();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 數字（含千分位）＋可有可無的一格空白或 word joiner＋單位 */
const amount = computed(() => new RegExp(`\\d[\\d,.]*[\\s\\u2060]?${escape(t("creator.mine.unit"))}`, "g"));
const parts = computed(() => {
  const out: { s: string; keep: boolean }[] = [];
  let at = 0;
  for (const m of props.text.matchAll(amount.value)) {
    if (m.index! > at) out.push({ s: props.text.slice(at, m.index), keep: false });
    out.push({ s: m[0], keep: true });
    at = m.index! + m[0].length;
  }
  if (at < props.text.length) out.push({ s: props.text.slice(at), keep: false });
  return out;
});
</script>

<template><template v-for="(p, i) in parts" :key="i"><span v-if="p.keep" class="amount">{{ p.s }}</span><template v-else>{{ p.s }}</template></template></template>

<style scoped>
.amount { white-space: nowrap; }
</style>
