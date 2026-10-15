<script setup lang="ts">
/**
 * 社群管理「分享活動」分頁下的數據看板 /review/campaign/stats：一個活動的申請漏斗、審核效率、支出、成效、作者，
 * 每塊是表格或純 CSS 長條（不引圖表庫）。口徑在服務端 src/campaign-stats.ts，這裡只排版與格式化。
 *
 * 活動放在網址的 ?campaign：沒帶就用列表裡進行中的第一個，再沒有用已結束的第一個，沒有活動是空態。
 * 數字依語系（Intl）：比例是一位小數的百分比，時間 48 小時內用小時、之後用天，點數是整數，
 * 每留存一人的成本取整到點；沒有資料（可觀察人數為 0、沒人留下、沒有決定過）一律顯示 —，不是 0。
 * 點數池只在服務端回了值（真人應用管理員）才出現。付費轉換要等平台提供彙總，只留一行說明。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { PLATFORMS, TIERS, campaignErrorText, campaignsCached, defaultStatsCampaign, fetchCampaignStats, localized, type Campaign, type CampaignStats, type Effect, type EffectBucket, type Retention } from '@/lib/campaign';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { pageTitle } from '@/lib/i18n';
import StatBars from '@/components/StatBars.vue';

const { t } = useI18n();
const session = useSession();
const route = useRoute();
const router = useRouter();
const { locale } = useLocalePath();

const DASH = '—';
const HOUR = 3_600_000;
/** 看板用的活動：網址上的優先；沒帶要等活動列表讀完才挑得出預設 */
const one = (v: unknown) => (typeof v === 'string' ? v : '');
const campaigns = ref<Campaign[]>([]);
const listReady = ref(false);
const slug = computed(() => one(route.query.campaign) || (listReady.value ? defaultStatsCampaign(campaigns.value) : ''));

const stats = ref<CampaignStats | null>(null);
const loading = ref(true);
const error = ref('');
let generation = 0, alive = true;

async function token() {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}
async function load() {
  if (!slug.value) return;
  const gen = ++generation;
  loading.value = true; error.value = '';
  try {
    const res = await fetchCampaignStats(await token(), slug.value);
    if (!alive || gen !== generation) return;
    stats.value = res;
  } catch (e) { if (gen === generation) error.value = campaignErrorText(e); } finally { if (gen === generation) loading.value = false; }
}
/** 活動列表只負責篩選與預設；讀不到時帶著 ?campaign 的人照樣看得到數據 */
async function loadCampaigns() {
  try { campaigns.value = (await campaignsCached(await token())).items; } catch (e) { if (!one(route.query.campaign)) error.value = campaignErrorText(e); }
  listReady.value = true;
  if (!slug.value) loading.value = false;
}
const retry = () => { error.value = ''; return listReady.value && slug.value ? load() : loadCampaigns(); };
function pick(next: string) { void router.replace({ query: next ? { campaign: next } : {} }); }

// 換活動：舊的數字先拿掉，免得新資料到之前看著上一個活動的數字
watch(slug, (next) => { stats.value = null; if (next) { loading.value = true; void load(); } });
onMounted(() => {
  document.title = pageTitle(t('campaign.stats.title'));
  if (one(route.query.campaign)) void load();
  void loadCampaigns();
});
onBeforeUnmount(() => { alive = false; });

// ---- 格式化 ----
const loc = computed(() => String(locale.value));
const numberFmt = computed(() => new Intl.NumberFormat(loc.value, { maximumFractionDigits: 0 }));
const percentFmt = computed(() => new Intl.NumberFormat(loc.value, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const int = (n: number) => numberFmt.value.format(n);
const pct = (ratio: number | null) => (ratio === null ? DASH : percentFmt.value.format(ratio));
const unit = (unitName: 'hour' | 'day', n: number) => new Intl.NumberFormat(loc.value, { style: 'unit', unit: unitName, unitDisplay: 'long', maximumFractionDigits: 1 }).format(n);
const duration = (ms: number | null) => (ms === null ? DASH : ms < 48 * HOUR ? unit('hour', ms / HOUR) : unit('day', ms / (24 * HOUR)));
/** 點數與成本都取整到點；null 是 — */
const points = (n: number | null) => (n === null ? DASH : t('campaign.stats.points', { n: int(Math.round(n)) }));
const rate = (r: Retention) => (r.eligible > 0 ? pct(r.retained / r.eligible) : DASH);
const ratio = (r: Retention) => `${int(r.retained)} / ${int(r.eligible)}`;
const generatedAt = computed(() => (stats.value ? new Intl.DateTimeFormat(loc.value, { dateStyle: 'medium', timeStyle: 'short' }).format(stats.value.generatedAt) : ''));
const dayLabel = (day: string) => new Intl.DateTimeFormat(loc.value, { timeZone: 'UTC', dateStyle: 'medium' }).format(Date.parse(`${day}T00:00:00Z`));

// ---- 區塊資料 ----
const bar = (key: string, label: string, value: number, text = int(value)) => ({ key, label, value, text });
const funnelBars = computed(() => {
  const f = stats.value!.funnel;
  return (['submitted', 'needsInfo', 'resubmitted', 'approved', 'rejected', 'paidContents'] as const).map((k) => bar(k, t(`campaign.stats.funnel.${k}`), f[k]));
});
const tierRows = computed(() => TIERS.map((k) => ({ key: k, label: t(`campaign.tier.${k}`), ...stats.value!.funnel.byTier[k] })));
const platformRows = computed(() => PLATFORMS.map((k) => ({ key: k, label: t(`campaign.platform.${k}`), ...stats.value!.funnel.byPlatform[k] })));
const actorBars = computed(() => (['human', 'ai'] as const).map((k) => bar(k, t(`campaign.stats.review.${k}`), stats.value!.review.byActor[k])));
const reasonBars = computed(() => stats.value!.review.rejectReasons.map((r, i) => bar(String(i), r.reason, r.count)));
const spendTierBars = computed(() => TIERS.map((k) => bar(k, t(`campaign.tier.${k}`), stats.value!.spend.byTier[k], points(stats.value!.spend.byTier[k]))));
const spendPlatformBars = computed(() => [...PLATFORMS, 'multi' as const].map((k) => bar(k, t(`campaign.platform.${k}`), stats.value!.spend.byPlatform[k], points(stats.value!.spend.byPlatform[k]))));
const spendDayBars = computed(() => stats.value!.spend.byDay.map((d) => bar(d.day, dayLabel(d.day), d.points, points(d.points))));
const EFFECT_BUCKETS: EffectBucket[] = [...PLATFORMS, 'multi', 'unreviewed'];
const retention = computed(() => (['d7', 'd30'] as const).map((k) => ({ key: k, r: stats.value!.effect[k], cost: stats.value!.effect[k === 'd7' ? 'costPerD7' : 'costPerD30'] })));
type EffectRow = { key: string; label: string; sub?: string; e: Effect };
const effectRows = computed<EffectRow[]>(() => EFFECT_BUCKETS.map((k) => ({ key: k, label: t(`campaign.platform.${k}`), e: stats.value!.effect.byPlatform[k] })));
const contentRows = computed<EffectRow[]>(() => stats.value!.effect.topContents.map((c) => ({ key: c.contentId, label: c.title, sub: `@${c.handle}`, e: c })));
</script>

<template>
  <section class="cs" data-page="campaign-stats" :aria-label="t('campaign.stats.title')">
    <div class="cs-bar">
      <select class="input cs-filter" data-filter="campaign" :value="slug" :aria-label="t('campaign.queue.filter')" @change="pick(($event.target as HTMLSelectElement).value)">
        <option v-for="c in campaigns" :key="c.slug" :value="c.slug">{{ localized(c.title, loc) || c.slug }}</option>
        <option v-if="slug && !campaigns.some((c) => c.slug === slug)" :value="slug">{{ slug }}</option>
      </select>
      <p v-if="stats" class="subtle cs-time" data-generated-at>{{ t('campaign.stats.generatedAt') }} {{ generatedAt }}</p>
      <button type="button" class="btn btn--sm" data-action="refresh" :disabled="loading || !slug" @click="load">{{ t('review.refresh') }}</button>
    </div>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }} <button class="btn btn--sm" :disabled="loading" @click="retry">{{ t('review.refresh') }}</button></p>

    <p v-if="listReady && !slug && !error" class="panel cs-empty muted" data-empty>{{ t('campaign.stats.empty') }}</p>
    <div v-else-if="!stats && !error" class="cs-skeleton" aria-busy="true"><div v-for="n in 3" :key="n" class="ghost cs-ghost" /></div>

    <template v-if="stats">
      <!-- 申請漏斗 -->
      <section class="panel cs-block" data-block="funnel" aria-labelledby="cs-funnel">
        <h2 id="cs-funnel" class="cs-h">{{ t('campaign.stats.funnel.title') }}</h2>
        <StatBars group="funnel" :items="funnelBars" />
        <p class="subtle cs-note">{{ t('campaign.stats.funnel.note') }}</p>
        <div class="cs-pair">
          <div class="cs-scroll">
            <table class="cs-table">
              <caption>{{ t('campaign.stats.byTier') }}</caption>
              <thead><tr><th scope="col"><span class="sr-only">{{ t('campaign.stats.rowHeader') }}</span></th><th scope="col">{{ t('campaign.stats.funnel.submitted') }}</th><th scope="col">{{ t('campaign.stats.funnel.approved') }}</th></tr></thead>
              <tbody><tr v-for="r in tierRows" :key="r.key" :data-row="`tier.${r.key}`"><th scope="row">{{ r.label }}</th><td>{{ int(r.submitted) }}</td><td>{{ int(r.approved) }}</td></tr></tbody>
            </table>
          </div>
          <div class="cs-scroll">
            <table class="cs-table">
              <caption>{{ t('campaign.stats.byPlatform') }}</caption>
              <thead><tr><th scope="col"><span class="sr-only">{{ t('campaign.stats.rowHeader') }}</span></th><th scope="col">{{ t('campaign.stats.funnel.submitted') }}</th><th scope="col">{{ t('campaign.stats.funnel.approved') }}</th></tr></thead>
              <tbody><tr v-for="r in platformRows" :key="r.key" :data-row="`platform.${r.key}`"><th scope="row">{{ r.label }}</th><td>{{ int(r.submitted) }}</td><td>{{ int(r.approved) }}</td></tr></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 審核效率 -->
      <section class="panel cs-block" data-block="review" aria-labelledby="cs-review">
        <h2 id="cs-review" class="cs-h">{{ t('campaign.stats.review.title') }}</h2>
        <dl class="cs-stats">
          <div class="stat" data-stat="pending"><dt>{{ t('campaign.stats.review.pending') }}</dt><dd>{{ int(stats.review.pending) }}</dd></div>
          <div class="stat" data-stat="median"><dt>{{ t('campaign.stats.review.median') }}</dt><dd>{{ duration(stats.review.firstDecisionMedianMs) }}</dd></div>
          <div class="stat" data-stat="p90"><dt>{{ t('campaign.stats.review.p90') }}</dt><dd>{{ duration(stats.review.firstDecisionP90Ms) }}</dd></div>
          <div class="stat" data-stat="duplicateRate"><dt>{{ t('campaign.stats.review.duplicateRate') }}</dt><dd>{{ pct(stats.review.duplicateRate) }}</dd></div>
        </dl>
        <h3 class="cs-h3">{{ t('campaign.stats.review.byActor') }}</h3>
        <StatBars group="review.actor" :items="actorBars" />
        <h3 class="cs-h3">{{ t('campaign.stats.review.reasons') }}</h3>
        <StatBars v-if="reasonBars.length" group="review.reason" :items="reasonBars" />
        <p v-else class="subtle">{{ t('campaign.stats.review.noReasons') }}</p>
      </section>

      <!-- 支出 -->
      <section class="panel cs-block" data-block="spend" aria-labelledby="cs-spend">
        <h2 id="cs-spend" class="cs-h">{{ t('campaign.stats.spend.title') }}</h2>
        <dl class="cs-stats">
          <div class="stat" data-stat="paidTotal"><dt>{{ t('campaign.stats.spend.paidTotal') }}</dt><dd>{{ points(stats.spend.paidTotal) }}</dd></div>
        </dl>
        <h3 class="cs-h3">{{ t('campaign.stats.byTier') }}</h3>
        <StatBars group="spend.tier" :items="spendTierBars" />
        <h3 class="cs-h3">{{ t('campaign.stats.byPlatform') }}</h3>
        <StatBars group="spend.platform" :items="spendPlatformBars" />
        <h3 class="cs-h3">{{ t('campaign.stats.spend.byDay') }}</h3>
        <StatBars v-if="spendDayBars.length" group="spend.day" :items="spendDayBars" />
        <p v-else class="subtle">{{ t('campaign.stats.spend.noDays') }}</p>
        <div v-if="stats.spend.pool" class="cs-pool" data-block="pool">
          <h3 class="cs-h3">{{ t('campaign.stats.spend.pool') }}</h3>
          <dl class="cs-stats">
            <div class="stat" data-stat="poolBalance"><dt>{{ t('campaign.stats.spend.balance') }}</dt><dd>{{ points(stats.spend.pool.balance) }}</dd></div>
            <div class="stat" data-stat="poolBurn"><dt>{{ t('campaign.stats.spend.burn7d') }}</dt><dd>{{ points(stats.spend.pool.burn7d) }}</dd></div>
            <div class="stat" data-stat="poolDaysLeft"><dt>{{ t('campaign.stats.spend.daysLeft') }}</dt><dd>{{ stats.spend.pool.daysLeft === null ? t('campaign.stats.spend.daysUnknown') : unit('day', stats.spend.pool.daysLeft) }}</dd></div>
          </dl>
        </div>
      </section>

      <!-- 成效 -->
      <section class="panel cs-block" data-block="effect" aria-labelledby="cs-effect">
        <h2 id="cs-effect" class="cs-h">{{ t('campaign.stats.effect.title') }}</h2>
        <dl class="cs-stats cs-big">
          <div class="stat" data-stat="attributed"><dt>{{ t('campaign.stats.effect.attributed') }}</dt><dd>{{ int(stats.effect.attributed) }}</dd></div>
          <div class="stat" data-stat="d7Rate"><dt>{{ t('campaign.stats.effect.d7Rate') }}</dt><dd>{{ rate(stats.effect.d7) }}</dd></div>
          <div class="stat" data-stat="costPerD7"><dt>{{ t('campaign.stats.effect.costPerD7') }}</dt><dd>{{ points(stats.effect.costPerD7) }}</dd><dd class="subtle cs-cost-note">{{ t('campaign.stats.effect.d7CostNote') }}</dd></div>
        </dl>
        <p class="subtle cs-note" data-visitors>{{ t('campaign.stats.effect.visitors', { visitors: int(stats.effect.visitors), attributed: int(stats.effect.attributed), firstPlay: int(stats.effect.firstPlay) }) }}</p>
        <div class="cs-pair">
          <div v-for="c in retention" :key="c.key" class="cs-card" :data-retention="c.key">
            <h3 class="cs-h3">{{ t(`campaign.stats.effect.${c.key}`) }}</h3>
            <p class="cs-card__value">{{ rate(c.r) }}</p>
            <p class="cs-card__ratio">{{ ratio(c.r) }}</p>
            <p class="subtle">{{ t(`campaign.stats.effect.${c.key}Note`) }}</p>
            <p class="subtle" :data-cost="c.key">{{ t('campaign.stats.effect.costEach', { cost: points(c.cost) }) }}</p>
            <p v-if="c.key === 'd30'" class="subtle">{{ t('campaign.stats.effect.d30CostNote') }}</p>
          </div>
        </div>

        <div v-for="table in [{ id: 'platform', title: t('campaign.stats.byPlatform'), rows: effectRows }, { id: 'content', title: t('campaign.stats.effect.topContents'), rows: contentRows }]" :key="table.id">
          <div v-if="table.rows.length" class="cs-scroll">
            <table class="cs-table" :data-table="table.id">
              <caption>{{ table.title }}</caption>
              <thead>
                <tr>
                  <th scope="col"><span class="sr-only">{{ t('campaign.stats.rowHeader') }}</span></th>
                  <th scope="col">{{ t('campaign.stats.effect.col.visitors') }}</th>
                  <th scope="col">{{ t('campaign.stats.effect.col.attributed') }}</th>
                  <th scope="col">{{ t('campaign.stats.effect.col.firstPlay') }}</th>
                  <th scope="col">{{ t('campaign.stats.effect.col.d7') }}</th>
                  <th scope="col">{{ t('campaign.stats.effect.col.cost') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in table.rows" :key="r.key" :data-row="`${table.id}.${r.key}`">
                  <th scope="row">{{ r.label }}<span v-if="r.sub" class="subtle cs-sub"> {{ r.sub }}</span></th>
                  <td>{{ int(r.e.visitors) }}</td><td>{{ int(r.e.attributed) }}</td><td>{{ int(r.e.firstPlay) }}</td><td>{{ ratio(r.e.d7) }}</td><td>{{ points(r.e.costPerD7) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else-if="table.id === 'content'" class="subtle">{{ t('campaign.stats.effect.noContents') }}</p>
        </div>

        <p class="notice cs-conversion" data-conversion-note>{{ t('campaign.stats.effect.conversionNote') }}</p>
      </section>

      <!-- 作者 -->
      <section class="panel cs-block" data-block="authors" aria-labelledby="cs-authors">
        <h2 id="cs-authors" class="cs-h">{{ t('campaign.stats.authors.title') }}</h2>
        <div v-if="stats.authors.length" class="cs-scroll">
          <table class="cs-table">
            <thead><tr><th scope="col">{{ t('campaign.stats.authors.card') }}</th><th scope="col">{{ t('campaign.stats.effect.col.attributed') }}</th><th scope="col">{{ t('campaign.stats.authors.firstPlays') }}</th></tr></thead>
            <tbody><tr v-for="a in stats.authors" :key="a.cardId" :data-row="`author.${a.cardId}`"><th scope="row">{{ a.cardName || `#${a.cardId}` }}</th><td>{{ int(a.attributed) }}</td><td>{{ int(a.firstPlays) }}</td></tr></tbody>
          </table>
        </div>
        <p v-else class="subtle">{{ t('campaign.stats.authors.empty') }}</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.cs { display: grid; gap: var(--s-4); min-width: 0; }
.cs-bar { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; }
.cs-filter { width: auto; min-width: 180px; max-width: 100%; }
.cs-time { margin: 0; margin-inline-start: auto; }
.cs-empty { padding: var(--s-5); margin: 0; }
.cs-skeleton { display: grid; gap: var(--s-3); }
.cs-ghost { height: 160px; }
.cs-block { padding: var(--s-5); display: grid; gap: var(--s-3); min-width: 0; }
.cs-h { margin: 0; font-size: 16px; font-weight: 600; }
.cs-h3 { margin: var(--s-2) 0 0; font-size: 13px; font-weight: 600; color: var(--text-2); }
.cs-note { margin: 0; }
.cs-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--s-4); margin: 0; }
.cs-stats dd { margin: 0; }
.cs-big dd { font-size: 28px; }
.cs-big .cs-cost-note { font-size: 12px; }
.cs-pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--s-4); }
.cs-card { background: var(--surface-2); border-radius: var(--r-md); padding: var(--s-4); display: grid; gap: var(--s-1); min-width: 0; align-content: start; }
.cs-card .cs-h3 { margin: 0; }
.cs-card p { margin: 0; }
.cs-card__value { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.cs-card__ratio { color: var(--text-2); font-variant-numeric: tabular-nums; }
.cs-scroll { overflow-x: auto; min-width: 0; }
.cs-table { width: 100%; border-collapse: collapse; font-size: 13.5px; font-variant-numeric: tabular-nums; }
.cs-table caption { text-align: start; font-size: 13px; font-weight: 600; color: var(--text-2); padding-bottom: var(--s-2); }
.cs-table th, .cs-table td { padding: var(--s-2) var(--s-3); border-bottom: 1px solid var(--line); text-align: end; white-space: nowrap; }
.cs-table thead th { font-size: 12px; font-weight: 500; color: var(--text-3); }
.cs-table tbody th { text-align: start; font-weight: 500; white-space: normal; min-width: 120px; }
.cs-table tbody tr:last-child > * { border-bottom: 0; }
.cs-sub { white-space: nowrap; }
.cs-pool { display: grid; gap: var(--s-2); border-top: 1px solid var(--line); padding-top: var(--s-3); }
.cs-conversion { margin: 0; }
@media (max-width: 760px) {
  .cs-block { padding: var(--s-4); }
  .cs-filter, .cs-bar .btn, .notice .btn { min-height: 44px; }
  .cs-filter { flex: 1; }
  .cs-time { margin-inline-start: 0; flex-basis: 100%; order: 3; }
}
</style>
