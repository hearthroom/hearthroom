<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useReviewer } from '@/lib/review';
import { useSession } from '@/lib/session';
import { campaignsCached, clearCampaignsCache } from '@/lib/campaign';
import { useLocalePath } from '@/lib/use-locale';
import { useI18n } from 'vue-i18n';
import { siteName } from '../../../shared/site-name';
import ReviewBadge from '@/components/ReviewBadge.vue';
import { revealInScroller } from '@/lib/scroll-reveal';
import { appealCount, refreshAppealCount } from '@/lib/workshop-moderation';
const route = useRoute();
const reviewer = useReviewer();
const session = useSession();
const { lp } = useLocalePath();
/**
 * 前三個分頁對「作品」，「留言」對卡片底下的留言；「成員」對「人」（補充包、活動徽章）。發補充包跟審卡同一個權限等級，所以每個審核人都看得到。
 * 「分享活動」審分享獎勵的申請，每個審核人（含 AI 帳號）都看得到。
 * 「發放」只給真人應用管理員：canEdit 由活動列表帶回，進工作台時讀一次，讀不到就當沒有（服務端仍逐次檢查）。
 * 「運營設定」每個審核人都看得到，只有應用管理員能改（服務端判）。
 * 「部落格」給供應商那邊本站應用的 owner／admin（不必是審核人；寫入時服務端每次再問一次）。
 */
const sections = [
  { key: 'reviews', path: '/review' },
  { key: 'cases', path: '/review/cases' },
  { key: 'cards', path: '/review/cards' },
  { key: 'comments', path: '/review/comments' },
  { key: 'campaign', path: '/review/campaign' },
  { key: 'members', path: '/review/members' },
  { key: 'history', path: '/review/history' },
  { key: 'settings', path: '/review/settings' },
] as const;
const canPay = ref(false);
onMounted(async () => {
  try { const token = await session.accessToken(); if (token) canPay.value = (await campaignsCached(token)).canEdit; } catch { /* 讀不到就不顯示發放分頁 */ }
});
// 工作台各頁共用的活動列表只活到離開工作台
onBeforeUnmount(clearCampaignsCache);
const blog = { key: 'blog', path: '/review/blog' } as const;
// 「擴充申訴」只給真人 manager／owner：角色要等審核查詢回來才準，所以跟著角色讀待處理數，一般審核人不打這支
const isManager = computed(() => reviewer.reviewer !== false && (reviewer.role === 'manager' || reviewer.role === 'owner'));
watch(isManager, async (on) => {
  if (!on) { appealCount.pending = 0; return; }
  const token = await session.accessToken();
  if (token) await refreshAppealCount(token);
}, { immediate: true });
// 不是審核人的應用管理員只看得到部落格：分享活動與發放的服務端閘門都要審核人身分，給了分頁也打不開。
const visible = computed(() => {
  const list: { key: string; path: string }[] = reviewer.reviewer === false ? [] : [...sections];
  if (canPay.value && list.length) list.splice(list.findIndex((s) => s.key === 'campaign') + 1, 0, { key: 'payouts', path: '/review/payouts' });
  if (isManager.value && list.length) list.splice(list.findIndex((s) => s.key === 'cards') + 1, 0, { key: 'workshopAppeals', path: '/review/workshop-appeals' });
  if (reviewer.blogWriter) list.push(blog);
  return list;
});
const { locale } = useI18n();
const brand = computed(() => siteName(String(locale.value)));
// 窄螢幕的分頁列是橫向捲動：作用中的分頁（例如排在後面的「擴充申訴」）沒有完整落在列裡就捲進來，不被右緣切掉。
// 分頁的寬度會在之後才定下來（待處理數徽章、字型），所以分頁一改變大小就再對一次，不只在換頁時量一次。
const navEl = ref<HTMLElement | null>(null);
function revealActiveTab() {
  const nav = navEl.value;
  const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
  if (nav && active) revealInScroller(nav, active);
}
let navObserver: ResizeObserver | null = null;
watch([navEl, () => route.meta.managementTab, () => visible.value.length], async ([nav]) => {
  await nextTick();
  navObserver?.disconnect();
  navObserver = null;
  if (nav && typeof ResizeObserver !== 'undefined') {
    navObserver = new ResizeObserver(() => revealActiveTab());
    navObserver.observe(nav);
    for (const item of nav.children) navObserver.observe(item);
  }
  revealActiveTab();
}, { immediate: true });
onBeforeUnmount(() => navObserver?.disconnect());
</script>
<template>
  <!-- 卡片審核每天要進出很多次：手機上收起站名、大標與說明，只留分頁條，第一張卡不必捲（2026-11-02 體檢 R6） -->
  <div class="page community-management" :class="{ 'community-management--compact': route.meta.managementTab === 'reviews' }">
    <header class="management-head">
      <p class="eyebrow">{{ brand }}</p>
      <h1 class="display">{{ $t('moderation.title') }}</h1>
      <p class="subtle">{{ $t('moderation.intro') }}</p>
    </header>
    <nav ref="navEl" class="management-nav" :aria-label="$t('moderation.title')">
      <RouterLink v-for="section in visible" :key="section.key" :to="lp(section.path)" custom v-slot="{ href, navigate }">
        <a :href="href" class="management-nav__item" :class="{ 'management-nav__item--active': route.meta.managementTab === section.key }" :aria-current="route.meta.managementTab === section.key ? 'page' : undefined" @click="navigate">
          {{ $t(section.key === 'workshopAppeals' ? 'workshop.moderation.tab' : `moderation.tab.${section.key}`) }}
          <ReviewBadge v-if="section.key === 'reviews'" :count="reviewer.pendingReviews" />
          <ReviewBadge v-if="section.key === 'cases'" :count="reviewer.pendingCases" />
          <ReviewBadge v-if="section.key === 'comments'" :count="reviewer.pendingComments" />
          <ReviewBadge v-if="section.key === 'workshopAppeals'" :count="appealCount.pending" />
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
@media (max-width: 600px) { .community-management--compact .management-head { display: none; } .community-management--compact .management-nav { margin-bottom: var(--s-4); } }
/* 窄螢幕：分頁橫向捲動，分頁不會落單一格；內容捲到容器邊緣才消失 */
@media (max-width: 600px) { .management-nav { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; } .management-nav::-webkit-scrollbar { display: none; } .management-nav__item { flex: 0 0 auto; padding-inline: var(--s-3); } }
</style>
