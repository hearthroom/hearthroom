<script setup lang="ts">
/**
 * 簽到頁的月卡列（ui.md §3）：Hero 下方一條矮的面板，只有持卡的人看得到。
 * 月卡不是箱子：不進開箱舞台、不和箱子的結果排在一起、不用金色與 accent 底（ui.md §0.1）。
 * 補簽卡張數只照 Harbor 給的 makeup.left，前端不自己加。
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import PlanToday from "./PlanToday.vue";
import { whole } from "@/lib/format";
import { usePeriodPlans } from "@/lib/period-plan-store";

const props = defineProps<{ checkedIn: boolean; makeupLeft: number }>();
const plans = usePeriodPlans();
const { t } = useI18n();
const line = computed(() => plans.line(props.checkedIn));
const mine = computed(() => plans.mine);

// 只在「簽到時一起領」「領取」或補領中變成「已領」的當下朗讀；進頁時已經領過就不念。
// 先清空再填：和上一次同一句（例如隔天又是同樣的數字）時讀屏器才會再念
const spoken = ref("");
watch(() => line.value.kind, async (now, before) => {
  const l = line.value;
  if (now !== "claimed" || !(before === "withCheckin" || before === "claim" || before === "waiting") || l.kind !== "claimed") return;
  spoken.value = "";
  await nextTick();
  spoken.value = t("plan.row.aria.claimed", { daily: whole(l.credits) });
});
</script>

<template>
  <section v-if="line.kind !== 'hidden' && mine" class="plan-row panel settle">
    <p class="plan-row__title">{{ mine.remainingDays <= 1 ? t("plan.row.title.last") : t("plan.row.title", { n: whole(mine.remainingDays) }, mine.remainingDays) }}</p>
    <PlanToday class="plan-row__today" :line="line" :claiming="plans.claiming" @claim="plans.claim()" />
    <p class="plan-row__sub">
      <span v-if="line.bonusCredits > 0">{{ t("plan.row.bonusPart", { bonus: whole(line.bonusCredits) }) }}</span>
      <span>{{ t("plan.row.makeup", { left: whole(makeupLeft) }, makeupLeft) }}</span>
    </p>
    <span class="sr-only" role="status">{{ spoken }}</span>
  </section>
</template>

<style scoped>
/* One row: title left, today's state right; the second line spans both (ui.md §3.2).
   Narrow phones: today's state drops under the title, left-aligned, then the second line. */
.plan-row { display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:center; gap:2px var(--s-3); padding:var(--s-3) var(--s-4); }
.plan-row__title { margin:0; font-size:14px; font-weight:600; color:var(--text); }
.plan-row__today { justify-self:end; }
.plan-row__sub { grid-column:1 / -1; margin:0; display:flex; flex-wrap:wrap; gap:0 var(--s-1); font-size:12px; color:var(--text-3); }
/* The separator ends the previous part, so a wrapped line never starts with it. */
.plan-row__sub > span:not(:last-child)::after { content:" ·"; }
:lang(ko) .plan-row { word-break:keep-all; }
@media (max-width: 380px) {
  .plan-row { grid-template-columns:minmax(0, 1fr); }
  .plan-row__today { justify-self:start; justify-content:flex-start; }
}
</style>
