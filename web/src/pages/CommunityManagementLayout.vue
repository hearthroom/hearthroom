<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useReviewer } from '@/lib/review';
import { useLocalePath } from '@/lib/use-locale';
import ReviewBadge from '@/components/ReviewBadge.vue';
const route = useRoute();
const reviewer = useReviewer();
const { lp } = useLocalePath();
const sections = [
  { key: 'reviews', path: '/review' },
  { key: 'cases', path: '/review/cases' },
  { key: 'cards', path: '/review/cards' },
  { key: 'history', path: '/review/history' },
] as const;
</script>
<template>
  <div class="page community-management">
    <header class="management-head">
      <p class="eyebrow">HearthRoom</p>
      <h1 class="display">{{ $t('moderation.title') }}</h1>
      <p class="subtle">{{ $t('moderation.intro') }}</p>
    </header>
    <nav class="management-nav" :aria-label="$t('moderation.title')">
      <RouterLink v-for="section in sections" :key="section.key" :to="lp(section.path)" custom v-slot="{ href, navigate }">
        <a :href="href" class="management-nav__item" :class="{ 'management-nav__item--active': route.meta.managementTab === section.key }" :aria-current="route.meta.managementTab === section.key ? 'page' : undefined" @click="navigate">
          {{ $t(`moderation.tab.${section.key}`) }}
          <ReviewBadge v-if="section.key === 'reviews'" :count="reviewer.pendingReviews" />
          <ReviewBadge v-if="section.key === 'cases'" :count="reviewer.pendingCases" />
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
.management-nav__item { display: flex; align-items: center; justify-content: center; min-height: 44px; padding: var(--s-2) var(--s-4); border-radius: var(--r-sm); color: var(--text-2); font-size: 14px; font-weight: 600; text-align: center; }
.management-nav__item:hover { color: var(--text); background: var(--surface); }
.management-nav__item--active { color: var(--accent-text); background: var(--surface); box-shadow: 0 1px 3px var(--line); }
@media (max-width: 600px) { .management-nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } .management-nav__item { padding-inline: var(--s-2); } }
</style>
