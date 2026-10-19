<script setup lang="ts">
/**
 * 簽到頁的月卡列（ui.md §3）：Hero 下方一條矮的面板，只有持卡的人看得到。
 * 月卡不是箱子：不進開箱舞台、不和箱子的結果排在一起、不用金色與 accent 底（ui.md §0.1）。
 * 補簽卡張數只照 Harbor 給的 makeup.left，前端不自己加。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import PlanToday from "./PlanToday.vue";
import { whole } from "@/lib/format";
import { usePeriodPlans } from "@/lib/period-plan-store";

const props = defineProps<{ checkedIn: boolean; makeupLeft: number }>();
const plans = usePeriodPlans();
const { t } = useI18n();
const line = computed(() => plans.line(props.checkedIn));
const mine = computed(() => plans.mine);

// 只在「簽到時一起領」或「領取」變成「已領」的當下朗讀；進頁時已經領過就不念
const spoken = ref("");
watch(() => line.value.kind, (now, before) => {
  const l = line.value;
  if (now === "claimed" && (before === "withCheckin" || before === "claim") && l.kind === "claimed") spoken.value = t("plan.row.aria.claimed", { daily: whole(l.credits) });
});
</script>

<template>
  <section v-if="line.kind !== 'hidden' && mine" class="plan-row panel settle">
    <div class="plan-row__main">
      <p class="plan-row__title">{{ mine.remainingDays <= 1 ? t("plan.row.title.last") : t("plan.row.title", { n: whole(mine.remainingDays) }, mine.remainingDays) }}</p>
      <p class="plan-row__sub">
        <span v-if="line.bonusCredits > 0">{{ t("plan.row.bonusPart", { bonus: whole(line.bonusCredits) }) }}</span>
        <span>{{ t("plan.row.makeup", { left: whole(makeupLeft) }, makeupLeft) }}</span>
      </p>
    </div>
    <PlanToday class="plan-row__today" :line="line" :claiming="plans.claiming" @claim="plans.claim()" />
    <span class="sr-only" role="status">{{ spoken }}</span>
  </section>
</template>

<style scoped>
.plan-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--s-2) var(--s-3); padding:var(--s-3) var(--s-4); }
.plan-row__main { min-width:0; display:grid; gap:2px; }
.plan-row__title { margin:0; font-size:14px; font-weight:600; color:var(--text); }
.plan-row__sub { margin:0; display:flex; flex-wrap:wrap; gap:0 var(--s-1); font-size:12px; color:var(--text-3); }
.plan-row__sub > span + span::before { content:"· "; }
.plan-row__today { margin-left:auto; }
@media (max-width: 380px) {
  .plan-row__today { margin-left:0; justify-content:flex-start; }
}
</style>
