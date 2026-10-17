<script setup lang="ts">
/**
 * 運營設定的「活動」區塊：平台點數池（唯讀）與活動列表。新增與編輯在自己的頁面（ReviewCampaignEditPage）。
 * 只有應用管理員能改（canEdit 由服務端判）；其他審核員看得到列表，不讀點數池。
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { fetchCampaignPool, fetchCampaigns, formatPeriod, localized, type Campaign, type CampaignPool } from '@/lib/campaign';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';

const { t, locale } = useI18n();
const session = useSession();
const { lp } = useLocalePath();

const items = ref<Campaign[]>([]);
const canEdit = ref(false);
const pool = ref<CampaignPool | null>(null);
const poolError = ref('');
const loading = ref(true);
const error = ref('');

const message = (e: unknown) => (e instanceof Error ? e.message : t('moderation.error.retry'));
const nameOf = (c: Campaign) => localized(c.title, String(locale.value)) || c.slug;
const periodOf = (c: Campaign) => formatPeriod(c, String(locale.value)) || t('campaign.settings.noPeriod');

async function load() {
  loading.value = true; error.value = '';
  try {
    const access = await session.accessToken();
    if (!access) throw new Error(t('auth.expired'));
    const res = await fetchCampaigns(access);
    items.value = res.items; canEdit.value = res.canEdit;
    if (res.canEdit) {
      poolError.value = '';
      fetchCampaignPool(access).then((p) => { pool.value = p; }).catch((e) => { poolError.value = message(e); });
    }
  } catch (e) { error.value = message(e); } finally { loading.value = false; }
}

const amount = (n: number) => n.toLocaleString(String(locale.value));
onMounted(() => { void load(); });
</script>

<template>
  <section class="panel cset" data-campaign-panel :aria-busy="loading" aria-labelledby="cset-h">
    <div class="cset-head">
      <h2 id="cset-h">{{ t('campaign.settings.title') }}</h2>
      <RouterLink v-if="canEdit" class="btn btn--sm btn--primary" data-action="new-campaign" :to="lp('/review/settings/campaigns/new')">{{ t('campaign.settings.new') }}</RouterLink>
    </div>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }} <button type="button" class="btn btn--sm" @click="load">{{ t('blog.retry') }}</button></p>
    <p v-if="!loading && !error && !canEdit" class="notice" data-campaign-read-only>{{ t('moderation.settings.readOnly') }}</p>

    <section v-if="canEdit" class="cset-pool" data-pool aria-labelledby="cset-pool-h">
      <h3 id="cset-pool-h">{{ t('campaign.pool.title') }}</h3>
      <p v-if="poolError" class="notice notice--error" role="alert">{{ poolError }}</p>
      <div v-else-if="!pool" class="ghost cset-ghost cset-ghost--pool" />
      <p v-else-if="!pool.configured" class="notice" data-pool-missing>{{ t('campaign.pool.notConfigured') }}</p>
      <dl v-else class="cset-pool__list">
        <div class="cset-pool__balance"><dt>{{ t('campaign.pool.balance') }}</dt><dd class="num">{{ amount(pool.balance) }}</dd></div>
        <div><dt>{{ t('campaign.pool.enabled') }}</dt><dd>{{ pool.enabled ? t('campaign.pool.on') : t('campaign.pool.off') }}</dd></div>
        <div><dt>{{ t('campaign.pool.usageLabel') }}</dt><dd>{{ pool.usageScope ? t(`campaign.pool.usage.${pool.usageScope}`) : t('campaign.pool.unset') }}</dd></div>
        <div><dt>{{ t('campaign.pool.maxPayout') }}</dt><dd class="num">{{ pool.maxPayout ? amount(pool.maxPayout) : t('campaign.pool.noLimit') }}</dd></div>
      </dl>
    </section>

    <template v-if="loading && !items.length"><div v-for="n in 2" :key="n" class="ghost cset-ghost" /></template>
    <p v-else-if="!items.length && !error" class="subtle">{{ t('campaign.settings.empty') }}</p>
    <ul v-else class="cset-list">
      <li v-for="c in items" :key="c.id" class="cset-row" :data-campaign="c.id">
        <span class="cset-row__name">{{ nameOf(c) }}</span>
        <span class="chip cset-status" :class="`cset-status--${c.status}`">{{ t(`campaign.status.${c.status}`) }}</span>
        <span class="subtle cset-row__period">{{ periodOf(c) }}</span>
        <RouterLink class="btn btn--sm btn--ghost" data-action="edit" :to="lp(`/review/settings/campaigns/${c.id}`)">{{ canEdit ? t('campaign.settings.edit') : t('campaign.settings.view') }}</RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cset { padding: var(--s-5); display: grid; gap: var(--s-4); min-width: 0; align-content: start; }
.cset-head { display: flex; align-items: center; gap: var(--s-3); flex-wrap: wrap; }
.cset-head h2 { font-size: 17px; margin: 0; margin-right: auto; }
.cset-ghost { height: 56px; border-radius: var(--r-md); }
.cset-ghost--pool { height: 96px; }
/* 活動列：名稱與狀態在上、期間在下，編輯鈕貼右 */
.cset-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-1); }
.cset-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 2px var(--s-3);
  padding: var(--s-3) var(--s-3); border-radius: var(--r-md);
  transition: background var(--dur) var(--ease);
}
.cset-row:hover { background: var(--surface-2); }
.cset-row__name { grid-column: 1; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.cset-row .cset-status { grid-column: 2; grid-row: 1; }
.cset-row__period { grid-column: 1 / 3; grid-row: 2; font-variant-numeric: tabular-nums; }
.cset-row .btn { grid-column: 3; grid-row: 1 / 3; }
.cset-status { cursor: default; height: 22px; }
.cset-status:hover { background: var(--surface-2); color: var(--text-2); }
.cset-status--active, .cset-status--active:hover { background: var(--success-soft); color: var(--success); }
.cset-pool { display: grid; gap: var(--s-3); padding: var(--s-4); background: var(--surface-2); border-radius: var(--r-md); }
.cset-pool h3 { font-size: 13px; font-weight: 600; color: var(--text-2); margin: 0; }
/* 餘額佔一整列，其餘三項（開關、用途、單筆上限）寬螢幕三欄；手機兩欄、最後一項跨整列，不留空格也不擠到字斷在詞中 */
.cset-pool__list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-3) var(--s-4); margin: 0; }
@media (max-width: 600px) {
  .cset-pool__list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cset-pool__list > div:last-child { grid-column: 1 / -1; }
}
.cset-pool__list > div { min-width: 0; }
.cset-pool__list dt { font-size: 12px; color: var(--text-3); }
.cset-pool__list dd { margin: 0; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.cset-pool__balance { grid-column: 1 / -1; }
.cset-pool__balance dd { font-size: 28px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
@media (max-width: 760px) {
  .cset { padding: var(--s-4); }
}
</style>
