<script setup lang="ts">
/**
 * 缺額購買的轉址頁：月卡與儲值連結先到主站，沙箱 iframe 不載入 GA。
 * 等待分析就緒最多三秒，記一筆點擊，再轉去 Console。不需要登入，畫面上什麼都不放。
 */
import { onMounted } from "vue";
import { useRoute } from "vue-router";
import { fetchPeriodPlans } from "@/lib/rewards";
import { purchaseLink } from "@/lib/period-plan";
import { SHORTFALL_FROM } from "@/lib/credits-recovery";
import { trackNow } from "@/lib/track";
import { ga4CheckoutUrl, waitForGa4 } from "@/lib/ga4";
import { topUpUrl } from "@/lib/topup";

const route = useRoute();
onMounted(async () => {
  const topup = route.path.endsWith("/go/topup");
  const plan = topup ? undefined : await fetchPeriodPlans().then((r) => r.list[0]).catch(() => undefined);
  await waitForGa4();
  if (route.query.from === SHORTFALL_FROM) trackNow("credits_shortfall_click", { detail: topup ? "topup" : "plan" });
  // 這一頁只是轉址，付完回到站台首頁。
  location.replace(ga4CheckoutUrl(topup ? topUpUrl(`${location.origin}/`) : purchaseLink(plan, `${location.origin}/`)));
});
</script>

<template><span /></template>
