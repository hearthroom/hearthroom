<script setup lang="ts">
/** AI 分歧分頁裡的兩個子頁：分歧清單｜仲裁報表（ui-arbitration.md「位置」）。單筆仲裁屬於清單。 */
import { RouterLink, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useLocalePath } from '@/lib/use-locale';
import { computed } from 'vue';
import { useReviewer } from '@/lib/review';
import { isManagerRole } from '@/lib/review-ai';

const { t } = useI18n();
const { lp } = useLocalePath();
const route = useRoute();
const current = () => (route.meta.aiReviewSub === 'report' ? 'report' : 'list');
const reviewer = useReviewer();
// 仲裁報表只給管理員：一般審核員只有清單，不顯示子頁切換
const subs = computed(() => (isManagerRole(reviewer.role) ? (['list', 'report'] as const) : ([] as const)));
</script>

<template>
  <nav v-if="subs.length" class="seg ai-nav" :aria-label="t('moderation.tab.aiReview')">
    <RouterLink v-for="k in subs" :key="k" :to="lp(k === 'list' ? '/review/ai' : '/review/ai/report')" class="seg__item ai-nav__item" :class="{ 'seg__item--on': current() === k }" :aria-current="current() === k ? 'page' : undefined" :data-ai-sub="k">
      {{ t(`reviewAi.arb.sub.${k}`) }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.ai-nav { align-self: start; max-width: 100%; }
.ai-nav__item { display: inline-flex; align-items: center; height: var(--h-md); }
</style>
