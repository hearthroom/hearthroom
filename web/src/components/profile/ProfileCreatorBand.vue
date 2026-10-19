<script setup lang="ts">
/**
 * 資料頭下面一排：進行中的活動、我的資源（owner 2026-10-19：這兩樣都重要，別藏在連結清單裡）。
 * 都是盡力而為：讀不到就收起那一張，不擋主頁其他內容。沒有進行中的活動時活動卡不出現。
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AccountIcon from '@/components/AccountIcon.vue';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { can } from '@/lib/provider';
import { accountToken } from '@/lib/connections';
import { resourceClient, type Resource } from '@/lib/resource-client';
import { fetchMyContents, fetchPublicCampaigns, featuredCampaigns, localized, type CampaignSummary } from '@/lib/campaign';

const session = useSession();
const { locale } = useI18n();
const { lp } = useLocalePath();

const campaign = ref<CampaignSummary | null>(null);
const entries = ref<number | null>(null);
const daysLeft = computed(() => {
  const end = campaign.value?.endsAt;
  return end ? Math.max(0, Math.ceil((end - Date.now()) / 86_400_000)) : null;
});

const showResources = computed(() => can('library') && !!session.profile?.identities?.some((i) => i.provider === 'harbor'));
const resources = ref<{ items: Resource[]; total: number; used: number | null; quota: number | null } | null>(null);
const usedRatio = computed(() => (resources.value?.quota && resources.value.used != null ? Math.min(100, (resources.value.used / resources.value.quota) * 100) : 0));
const size = (bytes: number) => (bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / (1 << 20)))} MB`);

async function loadCampaign() {
  try {
    const open = (await fetchPublicCampaigns()).items.filter((c) => c.phase === 'open');
    campaign.value = featuredCampaigns(open, 1)[0] ?? open[0] ?? null;
    if (!campaign.value || (campaign.value as { kind?: string }).kind === 'card_reward') return;
    const token = await session.accessToken();
    if (token) entries.value = (await fetchMyContents(token, campaign.value.slug)).items.length;
  } catch { /* 活動卡是附加資訊：讀不到就不顯示投稿數 */ }
}
async function loadResources() {
  const identity = session.profile?.identities?.find((i) => i.provider === 'harbor');
  if (!showResources.value || !identity) return;
  try {
    const token = await accountToken('harbor', identity.externalId, { verifyManaged: true });
    if (!token) return;
    const page = await resourceClient('harbor', token).list({ scope: 'all', kind: 'image', page: 1, pageSize: 3 });
    resources.value = { items: page.items, total: page.total, used: page.usedBytes, quota: page.byteQuota };
  } catch { /* 留著卡片與入口，只是沒有縮圖 */ }
}
onMounted(() => { void loadCampaign(); void loadResources(); });
</script>

<template>
  <div v-if="campaign || showResources" class="band" :class="{ 'band--single': !campaign || !showResources }">
    <section v-if="campaign" class="band__card band__campaign panel" aria-labelledby="profile-campaign">
      <img class="band__art" :src="campaign.bannerUrl || '/mascot/campaign/pose-share-phone.webp'" alt="" loading="lazy" />
      <div class="band__body">
        <div class="band__row">
          <span class="band__live">{{ $t('profile.campaign.live') }}</span>
          <span v-if="daysLeft !== null" class="band__deadline">{{ daysLeft === 0 ? $t('profile.campaign.endsToday') : $t('profile.campaign.daysLeft', { days: daysLeft }) }}</span>
          <RouterLink :to="lp('/campaigns')" class="band__more">{{ $t('campaign.hub.title') }} <AccountIcon name="arrow" /></RouterLink>
        </div>
        <h2 id="profile-campaign" class="band__title">{{ localized(campaign.title, String(locale)) }}</h2>
        <p v-if="entries" class="band__entries">{{ $t('profile.campaign.entries', { n: entries }) }}</p>
        <div class="band__actions">
          <RouterLink :to="lp(`/campaign/${campaign.slug}`)" class="btn btn--primary btn--sm">{{ entries ? $t('profile.campaign.continue') : $t('profile.campaign.join') }}</RouterLink>
          <RouterLink v-if="entries" :to="{ path: lp('/campaigns'), query: { tab: 'mine' } }" class="btn btn--sm">{{ $t('profile.campaign.mine') }}</RouterLink>
        </div>
      </div>
    </section>

    <section v-if="showResources" class="band__card band__res panel" aria-labelledby="profile-resources">
      <div class="band__row">
        <h2 id="profile-resources" class="band__res-title"><AccountIcon name="folder" />{{ $t('nav.resources') }}</h2>
        <RouterLink :to="lp('/resources')" class="band__more">{{ resources ? $t('profile.res.all', { n: resources.total }) : $t('me.resourcesHint') }} <AccountIcon name="arrow" /></RouterLink>
      </div>
      <div class="band__thumbs">
        <RouterLink v-for="r in resources?.items ?? []" :key="r.id" :to="lp('/resources')" class="band__thumb"><img :src="r.thumbnailUrl || r.imageUrl" alt="" loading="lazy" /></RouterLink>
        <RouterLink :to="lp('/resources')" class="band__thumb band__upload"><AccountIcon name="upload" />{{ $t('profile.res.upload') }}</RouterLink>
      </div>
      <div v-if="resources?.quota" class="band__quota">
        <span>{{ $t('profile.res.used') }}<b>{{ size(resources.used ?? 0) }} / {{ size(resources.quota) }}</b></span>
        <span class="band__bar"><span :style="{ width: usedRatio + '%' }" /></span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.band { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: var(--s-4); }
.band--single { grid-template-columns: minmax(0, 1fr); }
.band__card { min-width: 0; }
.band__campaign { display: flex; overflow: hidden; }
.band__art { flex: none; width: 160px; object-fit: cover; object-position: center top; background: var(--accent-tint); }
.band__body { flex: 1; min-width: 0; display: grid; gap: 10px; align-content: start; padding: var(--s-4) var(--s-5); }
.band__row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px var(--s-2); }
.band__live { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: var(--r-pill); background: var(--success-soft); color: var(--success); font-size: 12px; font-weight: 650; }
.band__live::before { content: ""; width: 6px; height: 6px; border-radius: var(--r-pill); background: currentColor; }
.band__deadline { font-size: 12.5px; font-weight: 600; color: var(--accent-text); }
.band__more { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; font-size: 13px; color: var(--text-3); white-space: nowrap; }
.band__more svg { width: 14px; height: 14px; }
.band__title { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.band__entries { margin: 0; padding: 8px 12px; border-radius: var(--r-sm); background: var(--surface-2); font-size: 13px; color: var(--text-2); }
.band__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.band__res { display: grid; gap: var(--s-3); align-content: start; padding: var(--s-4) var(--s-5); }
.band__res-title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 650; }
.band__res-title svg { width: 18px; height: 18px; color: var(--accent-text); }
.band__thumbs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--s-2); }
.band__thumb { aspect-ratio: 1; overflow: hidden; border-radius: 10px; background: var(--surface-2); }
.band__thumb img { width: 100%; height: 100%; object-fit: cover; }
.band__upload { display: grid; place-items: center; align-content: center; gap: 2px; box-shadow: inset 0 0 0 1.5px var(--line-strong); background: none; font-size: 12px; color: var(--text-2); }
.band__upload svg { width: 18px; height: 18px; }
.band__quota { display: grid; gap: 6px; font-size: 12.5px; color: var(--text-3); }
.band__quota > span:first-child { display: flex; justify-content: space-between; }
.band__quota b { font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.band__bar { height: 6px; border-radius: var(--r-pill); background: var(--surface-2); overflow: hidden; }
.band__bar span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
@media (max-width: 700px) {
  .band { grid-template-columns: minmax(0, 1fr); }
  .band__art { width: 104px; }
}
</style>
