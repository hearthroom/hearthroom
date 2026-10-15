<script setup lang="ts">
/**
 * 社群管理的「分享活動」分頁：分享獎勵申請的佇列。待審（新提交＋補件重送）、需要補件、已通過、未通過四段，可依活動篩選，
 * 每頁 20 筆、舊的在前（服務端排序）。每列連到那份內容的詳情頁，決定在那裡做。
 * 分段、活動與頁碼放在網址上：從詳情頁返回時還是同一個位置。三種重複標示只是提示，不擋決定。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { DEFAULT_TIMEZONE, campaignErrorText, campaignsCached, fetchQueue, localized, type Campaign, type Flags, type QueueItem, type ReviewStatus } from '@/lib/campaign';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { pageTitle } from '@/lib/i18n';

const { t } = useI18n();
const session = useSession();
const route = useRoute();
const router = useRouter();
const { lp, locale } = useLocalePath();

/** 服務端一頁的筆數（campaign-review.ts 的 QUEUE_PAGE） */
const PAGE = 20;
/** 待審不帶 status：服務端把新提交與補件重送合在一起 */
const SEGMENTS = [
  { key: 'pending', status: undefined },
  { key: 'needsInfo', status: 'needs_info' },
  { key: 'approved', status: 'approved' },
  { key: 'rejected', status: 'rejected' },
] as const satisfies readonly { key: string; status: ReviewStatus | undefined }[];
const FLAGS = ['duplicateLocation', 'duplicateImage', 'burst'] as const satisfies readonly (keyof Flags)[];

const one = (v: unknown) => (typeof v === 'string' ? v : '');
const status = computed(() => SEGMENTS.find((s) => s.status === one(route.query.status))?.status);
const campaign = computed(() => one(route.query.campaign));
const page = computed(() => { const n = Number(one(route.query.page)); return n >= 1 && Number.isSafeInteger(n) ? n : 1; });
function go(next: { status?: string; campaign?: string; page?: number }) {
  const q = { status: status.value, campaign: campaign.value, page: 1, ...next };
  void router.replace({ query: { ...(q.status ? { status: q.status } : {}), ...(q.campaign ? { campaign: q.campaign } : {}), ...(q.page > 1 ? { page: String(q.page) } : {}) } });
}

const items = ref<QueueItem[]>([]);
const total = ref(0);
const campaigns = ref<Campaign[]>([]);
const loading = ref(true);
const error = ref('');
let generation = 0, alive = true;
const hasNext = computed(() => page.value * PAGE < total.value);

async function token() {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}
async function load() {
  const gen = ++generation;
  loading.value = true; error.value = '';
  try {
    const res = await fetchQueue(await token(), { status: status.value, campaign: campaign.value || undefined, page: page.value });
    if (!alive || gen !== generation) return;
    items.value = res.items; total.value = res.total;
  } catch (e) { if (gen === generation) error.value = campaignErrorText(e); } finally { if (gen === generation) loading.value = false; }
}
/** 篩選用的活動列表；讀不到就只是沒有篩選，佇列照樣能用 */
async function loadCampaigns() {
  try { campaigns.value = (await campaignsCached(await token())).items; } catch { /* 篩選少一個不影響審核 */ }
}

const bySlug = computed(() => new Map(campaigns.value.map((c) => [c.slug, c])));
const titleOf = (slug: string) => { const c = bySlug.value.get(slug); return c ? localized(c.title, locale.value) || slug : slug; };
/** 用活動自己的時區顯示；活動讀不到時用看的人的時區，時刻本身還是對的 */
const at = (ms: number, slug: string) => new Intl.DateTimeFormat(locale.value, { timeZone: bySlug.value.has(slug) ? bySlug.value.get(slug)!.timezone || DEFAULT_TIMEZONE : undefined, dateStyle: 'medium', timeStyle: 'short' }).format(ms);

// 換分段、活動或頁碼：舊的列先拿掉，免得新資料到之前點進上一段的申請
watch(() => [status.value, campaign.value, page.value], () => { items.value = []; total.value = 0; void load(); });
onMounted(() => {
  document.title = pageTitle(t('moderation.tab.campaign'));
  void load(); void loadCampaigns();
});
onBeforeUnmount(() => { alive = false; });
</script>

<template>
  <section class="rcq" :aria-label="t('moderation.tab.campaign')">
    <div class="rcq-bar">
      <div class="seg rcq-tabs">
        <button v-for="s in SEGMENTS" :key="s.key" type="button" class="seg__item" :class="{ 'seg__item--on': status === s.status }" :aria-pressed="status === s.status" @click="go({ status: s.status })">{{ t(`campaign.queue.${s.key}`) }}</button>
      </div>
      <select class="input rcq-filter" data-filter="campaign" :value="campaign" :aria-label="t('campaign.queue.filter')" @change="go({ campaign: ($event.target as HTMLSelectElement).value })">
        <option value="">{{ t('campaign.queue.allCampaigns') }}</option>
        <option v-for="c in campaigns" :key="c.slug" :value="c.slug">{{ localized(c.title, locale) || c.slug }}</option>
      </select>
      <RouterLink class="btn btn--sm rcq-stats" data-link="stats" :to="lp('/review/campaign/stats' + (campaign ? `?campaign=${encodeURIComponent(campaign)}` : ''))">{{ t('campaign.stats.link') }}</RouterLink>
    </div>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }} <button class="btn btn--sm" :disabled="loading" @click="load">{{ t('review.refresh') }}</button></p>

    <div class="rcq-list" :aria-busy="loading">
      <template v-if="loading && !items.length"><div v-for="n in 3" :key="n" class="ghost rcq-ghost" /></template>
      <p v-else-if="!items.length && !error" class="panel rcq-empty muted">{{ t('campaign.queue.empty') }}</p>
      <RouterLink v-for="item in items" :key="item.id" class="panel rcq-item" :data-placement="item.id" :to="lp(`/review/campaign/${item.contentId}`)">
        <div class="rcq-item__head">
          <strong class="rcq-item__title">{{ item.contentTitle }}</strong>
          <time class="subtle">{{ at(item.createdAt, item.campaignSlug) }}</time>
        </div>
        <p class="subtle rcq-item__meta">@{{ item.applicant.handle }} · {{ t(`campaign.platform.${item.platform}`) }} · {{ item.location }}</p>
        <div class="rcq-item__chips">
          <span class="chip">{{ t(`campaign.tier.${item.requestedTier}`) }}</span>
          <span class="chip">{{ t('campaign.queue.shots', { n: item.evidenceCount }) }}</span>
          <span v-if="!campaign" class="chip">{{ titleOf(item.campaignSlug) }}</span>
          <template v-for="f in FLAGS" :key="f"><span v-if="item.flags[f]" class="chip rcq-chip--warn">{{ t(`campaign.flag.${f}`) }}</span></template>
        </div>
      </RouterLink>
    </div>
    <div v-if="page > 1 || hasNext" class="rcq-pager">
      <button class="btn btn--sm" :disabled="page === 1 || loading" @click="go({ page: page - 1 })">{{ t('moderation.previous') }}</button>
      <button class="btn btn--sm" :disabled="!hasNext || loading" @click="go({ page: page + 1 })">{{ t('moderation.next') }}</button>
    </div>
  </section>
</template>

<style scoped>
.rcq { display: grid; gap: var(--s-4); min-width: 0; }
.rcq-bar { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between; }
.rcq-tabs { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.rcq-filter { width: auto; min-width: 180px; max-width: 100%; }
.rcq-list { display: grid; gap: var(--s-3); }
.rcq-ghost { height: 104px; }
.rcq-empty { padding: var(--s-5); margin: 0; }
.rcq-item { padding: var(--s-4); display: grid; gap: var(--s-2); min-width: 0; overflow-wrap: anywhere; color: var(--text); }
.rcq-item:hover .rcq-item__title { color: var(--accent-text); }
.rcq-item__head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; }
.rcq-item__meta { margin: 0; }
.rcq-item__chips { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.rcq-item__chips .chip { cursor: inherit; }
.rcq-chip--warn { background: var(--gold-soft); color: var(--warning-text); }
.rcq-pager { display: flex; gap: var(--s-2); justify-content: center; }
@media (max-width: 760px) {
  .rcq-filter, .rcq-pager .btn, .rcq-tabs .seg__item, .rcq-stats { min-height: 44px; }
  .rcq-filter { flex: 1; }
}
</style>
