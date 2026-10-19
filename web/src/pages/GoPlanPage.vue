<script setup lang="ts">
/**
 * 月卡的轉址頁：畫布「積分不夠」那張卡的月卡連結先到這裡（ui.md §5.2），
 * 從那張卡來的記一筆點擊、立刻送出，再轉去 Console 帳單頁的月卡分段。不需要登入，畫面上什麼都不放。
 */
import { onMounted } from "vue";
import { useRoute } from "vue-router";
import { fetchPeriodPlans } from "@/lib/rewards";
import { purchaseLink } from "@/lib/period-plan";
import { SHORTFALL_FROM } from "@/lib/credits-recovery";
import { trackNow } from "@/lib/track";

const route = useRoute();
onMounted(async () => {
  if (route.query.from === SHORTFALL_FROM) trackNow("credits_shortfall_click", { detail: "plan" });
  const plan = await fetchPeriodPlans().then((r) => r.list[0]).catch(() => undefined);
  location.replace(purchaseLink(plan));
});
</script>

<template><span /></template>
