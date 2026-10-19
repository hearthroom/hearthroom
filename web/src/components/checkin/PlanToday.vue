<script setup lang="ts">
/**
 * 月卡「今天那一行」：簽到時一起領／今天已領／領取按鈕（ui.md §3.3 P2–P5、§4.2）。
 * 簽到頁的月卡列與「積分與會員」共用；判斷在 lib/period-plan 的 todayLine。
 * 沒領到不用紅字也不用 toast：簽到本身是成功的。
 */
import { useI18n } from "vue-i18n";
import { whole } from "@/lib/format";
import type { TodayLine } from "@/lib/period-plan";

defineProps<{ line: Exclude<TodayLine, { kind: "hidden" }>; claiming: boolean }>();
const emit = defineEmits<{ claim: [] }>();
const { t } = useI18n();
</script>

<template>
  <span class="plan-today">
    <span v-if="line.kind === 'withCheckin'" class="plan-today__text">{{ t("plan.row.withCheckin", { daily: whole(line.credits) }) }}</span>
    <i18n-t v-else-if="line.kind === 'claimed'" keypath="plan.row.claimed" tag="span" class="plan-today__text" scope="global">
      <template #daily><span class="plan-today__amount">{{ whole(line.credits) }}</span></template>
    </i18n-t>
    <template v-else>
      <span v-if="line.missed" class="plan-today__missed">{{ t("plan.row.missed") }}</span>
      <button type="button" class="btn btn--sm plan-today__claim" :disabled="claiming" :aria-busy="claiming" @click="emit('claim')">
        <span v-if="claiming" class="plan-today__spin" aria-hidden="true" />
        <span :class="{ 'plan-today__hold': claiming }">{{ t("plan.row.claim", { daily: whole(line.credits) }) }}</span>
      </button>
    </template>
  </span>
</template>

<style scoped>
.plan-today { display:inline-flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:var(--s-1) var(--s-2); font-size:13px; color:var(--text-2); }
.plan-today__text { text-wrap:pretty; }
.plan-today__amount { color:var(--accent-text); font-weight:600; white-space:nowrap; }
.plan-today__missed { font-size:12px; color:var(--text-2); }
.plan-today__claim { position:relative; white-space:nowrap; }
.plan-today__claim::before { content:""; position:absolute; inset:-4px -2px; }
.plan-today__hold { visibility:hidden; }
.plan-today__spin { position:absolute; width:14px; height:14px; border-radius:50%; border:2px solid currentColor; border-right-color:transparent; animation:spin .8s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
</style>
