<script setup lang="ts">
/**
 * 卡片審核的兩個清單：待審、我處理過的。原本「我處理過的」是待審頁標題下的一個連結，
 * 審核員找不到（2026-11-02 體檢 R6）；改成同一排分段，兩頁共用。各自仍是獨立網址，深連結與搜尋參數留得住。
 */
import { RouterLink } from "vue-router";
import { useLocalePath } from "@/lib/use-locale";

/** pending：可領的待審數（跟管理分頁的徽章同一個來源）；還不知道就是 null，只寫「待審」不寫 0 */
defineProps<{ active: "pending" | "history"; pending: number | null }>();
const { lp } = useLocalePath();
</script>

<template>
  <nav class="seg review-tabs" :aria-label="$t('review.queue.tab.label')">
    <RouterLink class="seg__item" :class="{ 'seg__item--on': active === 'pending' }" :aria-current="active === 'pending' ? 'page' : undefined" :to="lp('/review')">
      {{ pending === null ? $t("review.queue.tab.pendingNoCount") : $t("review.queue.tab.pending", { n: pending }) }}
    </RouterLink>
    <RouterLink class="seg__item" :class="{ 'seg__item--on': active === 'history' }" :aria-current="active === 'history' ? 'page' : undefined" :to="lp('/review/decisions')">
      {{ $t("review.history.title") }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.review-tabs { display: inline-flex; max-width: 100%; }
.review-tabs .seg__item { min-height: var(--h-lg); display: inline-flex; align-items: center; text-decoration: none; }
</style>
