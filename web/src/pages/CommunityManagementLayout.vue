<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useReviewer } from '@/lib/review';
import { useLocalePath } from '@/lib/use-locale';
import ReviewBadge from '@/components/ReviewBadge.vue';
const route = useRoute();
const reviewer = useReviewer();
const { lp } = useLocalePath();
/**
 * 前三個分頁對「作品」，「留言」對卡片底下的留言；「成員」對「人」（補充包、活動徽章）。發補充包跟審卡同一個權限等級，所以每個審核人都看得到。
 * 「運營設定」每個審核人都看得到，只有應用管理員能改（服務端判）。
 * 「部落格」給供應商那邊本站應用的 owner／admin（不必是審核人；寫入時服務端每次再問一次）。
 */
const sections = [
  { key: 'reviews', path: '/review' },
  { key: 'cases', path: '/review/cases' },
  { key: 'cards', path: '/review/cards' },
  { key: 'comments', path: '/review/comments' },
  { key: 'members', path: '/review/members' },
  { key: 'history', path: '/review/history' },
  { key: 'settings', path: '/review/settings' },
] as const;
const blog = { key: 'blog', path: '/review/blog' } as const;
// 不是審核人的應用管理員只看得到部落格；其他分頁要審核人身分。
const visible = computed(() => [...(reviewer.reviewer === false ? [] : sections), ...(reviewer.blogWriter ? [blog] : [])]);
</script>
<template>
  <div class="page community-management">
    <header class="management-head">
      <p class="eyebrow">HearthRoom</p>
      <h1 class="display">{{ $t('moderation.title') }}</h1>
      <p class="subtle">{{ $t('moderation.intro') }}</p>
    </header>
    <nav class="management-nav" :aria-label="$t('moderation.title')">
      <RouterLink v-for="section in visible" :key="section.key" :to="lp(section.path)" custom v-slot="{ href, navigate }">
        <a :href="href" class="management-nav__item" :class="{ 'management-nav__item--active': route.meta.managementTab === section.key }" :aria-current="route.meta.managementTab === section.key ? 'page' : undefined" @click="navigate">
          {{ $t(`moderation.tab.${section.key}`) }}
          <ReviewBadge v-if="section.key === 'reviews'" :count="reviewer.pendingReviews" />
          <ReviewBadge v-if="section.key === 'cases'" :count="reviewer.pendingCases" />
          <ReviewBadge v-if="section.key === 'comments'" :count="reviewer.pendingComments" />
        </a>
      </RouterLink>
    </nav>
    <RouterView />
  </div>
</template>
<style scoped>
.management-head { margin-bottom: var(--s-5); }
.management-head h1 { font-size: clamp(24px, 3vw, 32px); margin: var(--s-1) 0 var(--s-2); }
.management-nav { display: flex; gap: var(--s-2); flex-wrap: wrap; padding: var(--s-1); margin-bottom: var(--s-5); background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-md); }
.management-nav__item { display: flex; align-items: center; justify-content: center; min-height: 44px; padding: var(--s-2) var(--s-4); border-radius: var(--r-sm); color: var(--text-2); font-size: 14px; font-weight: 600; text-align: center; white-space: nowrap; }
.management-nav__item:hover { color: var(--text); background: var(--surface); }
.management-nav__item--active { color: var(--accent-text); background: var(--surface); box-shadow: 0 1px 3px var(--line); }
/* 窄螢幕：分頁橫向捲動，分頁不會落單一格；內容捲到容器邊緣才消失 */
@media (max-width: 600px) { .management-nav { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; } .management-nav::-webkit-scrollbar { display: none; } .management-nav__item { flex: 0 0 auto; padding-inline: var(--s-3); } }
</style>
