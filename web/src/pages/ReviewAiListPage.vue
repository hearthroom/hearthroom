<script setup lang="ts">
/**
 * /review/ai — AI 分歧清單（管理員，ui-arbitration.md「分歧清單」）。
 *
 * 只列人工與 AI 結論相反的送審；預設待仲裁，最舊的先。篩選放在網址上，從單筆仲裁回來還在。
 * 判準版本的選項取自近 120 天的對照報表（沒有另外的版本清單）。「作者標記」篩選服務端沒有提供，這一版不做。
 * 不是管理員：分頁本來就不出現；直接打網址看到一句說明，不發請求（服務端也擋）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/lib/api';
import { fetchAiReport, fetchDisagreements, type DisagreementItem, type Direction } from '@/lib/review-ai-api';
import { versionNumber } from '@/lib/review-ai';
import { REVIEW_REASONS, reasonKey } from '@/lib/review-reasons';
import { useReviewer } from '@/lib/review';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { dateTime } from '@/lib/format';
import { pageTitle } from '@/lib/i18n';
import ReviewAiNav from '@/components/ReviewAiNav.vue';

const PAGE = 20;
const { t, locale } = useI18n();
const { lp } = useLocalePath();
const session = useSession();
const reviewer = useReviewer();
const route = useRoute();
const router = useRouter();

// 審核身分查回來之前不讀也不擋（骨架）；查回來不是管理員就只說一句，不發請求
// 審核員都能仲裁（owner 2026-11-24）；報表與參考範例匯出仍限管理員
const allowed = computed(() => reviewer.reviewer === true);
const denied = computed(() => reviewer.reviewer !== null && !allowed.value);
const forbidden = ref(false);

const STATES = ['open', 'done', 'all'] as const;
const DIRECTIONS: readonly Direction[] = ['ai_stricter', 'human_stricter'];
const q = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : '');
const state = computed(() => ((STATES as readonly string[]).includes(q('state')) ? q('state') : 'open') as (typeof STATES)[number]);
const direction = computed(() => ((DIRECTIONS as readonly string[]).includes(q('direction')) ? (q('direction') as Direction) : null));
// 判準版本：不指定＝目前版本（伺服器決定）；all＝全部版本
const criteria = computed(() => (/^(v\d{1,4}|all)$/.test(q('criteria')) ? q('criteria') : null));
const reason = computed(() => ((REVIEW_REASONS as readonly string[]).includes(q('reason')) ? q('reason') : null));
const filtered = computed(() => !!(direction.value || (criteria.value && criteria.value !== 'all') || reason.value));
function setFilter(key: string, value: string | null) { void router.replace({ query: { ...route.query, [key]: value || undefined } }); }
function clearFilters() { void router.replace({ query: { state: route.query.state } }); }

const items = ref<DisagreementItem[]>([]);
const total = ref(0);
const loading = ref(true);
const loadingMore = ref(false);
const failed = ref(false);
let generation = 0, alive = true;
onBeforeUnmount(() => { alive = false; });

async function token() {
  const v = await session.accessToken();
  if (!v) throw new Error(t('auth.expired'));
  return v;
}
async function load(more = false) {
  if (!allowed.value) return;
  const gen = ++generation;
  if (more) loadingMore.value = true; else { loading.value = true; items.value = []; }
  failed.value = false;
  try {
    const res = await fetchDisagreements(await token(), { state: state.value, direction: direction.value, criteria: criteria.value, reason: reason.value, limit: PAGE, offset: more ? items.value.length : 0 });
    if (!alive || gen !== generation) return;
    items.value = more ? [...items.value, ...res.items] : res.items;
    total.value = res.total;
  } catch (e) {
    if (!alive || gen !== generation) return;
    if (e instanceof ApiError && e.status === 403) forbidden.value = true; else failed.value = true;
  } finally {
    if (gen === generation) { loading.value = false; loadingMore.value = false; }
  }
}

/** 判準版本選項：近 120 天報表裡出現過的版本，新的在前；讀不到就只有「全部版本」和目前選的那個 */
const versions = ref<string[]>([]);
async function loadVersions() {
  try {
    const res = await fetchAiReport(await token(), 120);
    if (alive) versions.value = res.versions.map((v) => v.criteriaVersion);
  } catch { /* 篩選少幾個選項不擋清單 */ }
}
const versionOptions = computed(() => [...new Set([...versions.value, ...(criteria.value && criteria.value !== 'all' ? [criteria.value] : [])])].sort((a, b) => versionNumber(b) - versionNumber(a)));

watch(() => [state.value, direction.value, criteria.value, reason.value], () => void load());
watch(allowed, (a) => { if (a && !items.value.length) { void load(); void loadVersions(); } });
onMounted(() => { document.title = pageTitle(t('reviewAi.arb.title')); if (allowed.value) { void load(); void loadVersions(); } });

const pct = (n: number) => new Intl.NumberFormat(String(locale.value), { style: 'percent', maximumFractionDigits: 0 }).format(n);
const cardName = (it: DisagreementItem) => it.name || t('reviewAi.arb.cardNo', { id: it.cardId });
</script>

<template>
  <section class="ai-arb" data-page="review-ai-list" :aria-label="t('reviewAi.arb.title')">
    <ReviewAiNav />
    <p v-if="denied || forbidden" class="notice notice--error" role="alert" data-forbidden>{{ t('state.forbidden') }}</p>
    <template v-else>
      <p class="subtle ai-arb__intro">{{ t('reviewAi.arb.intro') }}</p>
      <div class="ai-arb__filters">
        <div class="seg ai-arb__states" role="group" :aria-label="t('reviewAi.arb.filter.state')">
          <button v-for="s in STATES" :key="s" type="button" class="seg__item" :class="{ 'seg__item--on': state === s }" :aria-pressed="state === s" :data-state="s" @click="setFilter('state', s === 'open' ? null : s)">{{ t(`reviewAi.arb.state.${s}`) }}</button>
        </div>
        <select class="input ai-arb__select" :value="direction ?? ''" :aria-label="t('reviewAi.arb.filter.direction')" data-filter="direction" @change="setFilter('direction', ($event.target as HTMLSelectElement).value)">
          <option value="">{{ t('reviewAi.arb.filter.directionAll') }}</option>
          <option v-for="d in DIRECTIONS" :key="d" :value="d">{{ t(`reviewAi.arb.direction.${d}`) }}</option>
        </select>
        <select class="input ai-arb__select" :value="criteria ?? ''" :aria-label="t('reviewAi.arb.filter.criteria')" data-filter="criteria" @change="setFilter('criteria', ($event.target as HTMLSelectElement).value)">
          <option value="">{{ t('reviewAi.arb.filter.criteriaCurrent') }}</option>
          <option value="all">{{ t('reviewAi.arb.filter.criteriaAll') }}</option>
          <option v-for="v in versionOptions" :key="v" :value="v">{{ t('reviewAi.arb.criteria', { v }) }}</option>
        </select>
        <select class="input ai-arb__select" :value="reason ?? ''" :aria-label="t('reviewAi.arb.filter.reason')" data-filter="reason" @change="setFilter('reason', ($event.target as HTMLSelectElement).value)">
          <option value="">{{ t('reviewAi.arb.filter.reasonAll') }}</option>
          <option v-for="code in REVIEW_REASONS" :key="code" :value="code">{{ t(reasonKey(code, 'name')) }}</option>
        </select>
      </div>

      <div v-if="failed" class="notice notice--error ai-arb__row" role="alert" data-error>
        <span>{{ t('reviewAi.arb.loadFailed') }}</span>
        <button type="button" class="btn btn--sm" @click="load()">{{ t('reviewAi.arb.retry') }}</button>
      </div>
      <div v-else-if="loading" class="ai-arb__list" aria-busy="true" data-skeleton>
        <div v-for="n in 3" :key="n" class="ghost ai-arb__ghost" />
      </div>
      <div v-else-if="!items.length" class="panel ai-arb__empty" data-empty>
        <template v-if="filtered">
          <h2 class="ai-arb__h">{{ t('reviewAi.arb.empty.filteredTitle') }}</h2>
          <div class="ai-arb__acts"><button type="button" class="btn" data-action="clear" @click="clearFilters">{{ t('reviewAi.arb.empty.clear') }}</button></div>
        </template>
        <template v-else>
          <h2 class="ai-arb__h">{{ t(state === 'open' ? 'reviewAi.arb.empty.openTitle' : 'reviewAi.arb.empty.title') }}</h2>
          <p class="muted">{{ t(state === 'open' ? 'reviewAi.arb.empty.openBody' : 'reviewAi.arb.empty.body') }}</p>
          <div class="ai-arb__acts">
            <button v-if="state !== 'all'" type="button" class="btn" data-action="all" @click="setFilter('state', 'all')">{{ t('reviewAi.arb.empty.seeAll') }}</button>
            <RouterLink class="btn" :to="lp('/review/ai/report')">{{ t('reviewAi.arb.empty.toReport') }}</RouterLink>
          </div>
        </template>
      </div>
      <template v-else>
        <p class="subtle ai-arb__count" data-total>{{ t('reviewAi.arb.total', { n: total }) }}</p>
        <ul class="ai-arb__list" data-list>
          <li v-for="it in items" :key="it.suggestionId" class="panel ai-row" :data-row="it.suggestionId">
            <div class="ai-row__head">
              <h2 class="ai-row__name">{{ cardName(it) }}</h2>
              <span class="chip ai-tag ai-tag--warn" :data-direction="it.direction">{{ t(`reviewAi.arb.direction.${it.direction}`) }}</span>
              <span v-if="it.arbitration" class="chip ai-tag" data-arbitrated>{{ t('reviewAi.arb.arbitrated', { value: t(`reviewAi.arb.value.${it.arbitration}`) }) }}</span>
            </div>
            <div class="ai-row__sides">
              <div class="ai-row__side">
                <p class="subtle ai-row__label">{{ t('reviewAi.arb.human') }}</p>
                <p class="ai-row__chips">
                  <span class="chip ai-tag" :class="it.human.decision === 'approved' ? 'ai-tag--pass' : 'ai-tag--reject'">{{ t(`reviewAi.arb.decision.${it.human.decision}`) }}</span>
                  <span v-for="code in it.human.reasons" :key="code" class="chip ai-tag">{{ t(reasonKey(code, 'name')) }}</span>
                </p>
              </div>
              <div class="ai-row__side">
                <p class="subtle ai-row__label">{{ it.ai.confidence !== null ? t('reviewAi.arb.aiConfidence', { pct: pct(it.ai.confidence) }) : t('reviewAi.arb.ai') }}</p>
                <p class="ai-row__chips">
                  <span class="chip ai-tag" :class="it.ai.verdict === 'pass' ? 'ai-tag--pass' : 'ai-tag--reject'">{{ t(`reviewAi.arb.aiVerdict.${it.ai.verdict}`) }}</span>
                  <span v-for="code in it.ai.reasons" :key="code" class="chip ai-tag">{{ t(reasonKey(code, 'name')) }}</span>
                </p>
              </div>
            </div>
            <div class="ai-row__foot">
              <span class="subtle">{{ t('reviewAi.arb.criteria', { v: it.criteriaVersion }) }}<template v-if="it.human.at"> · {{ dateTime(it.human.at) }}</template></span>
              <RouterLink class="btn btn--sm" :to="lp(`/review/ai/${it.suggestionId}`)" :data-open="it.suggestionId">{{ t(it.arbitration ? 'reviewAi.arb.reopen' : 'reviewAi.arb.open') }}</RouterLink>
            </div>
          </li>
        </ul>
        <div v-if="items.length < total" class="ai-arb__more">
          <button type="button" class="btn" :disabled="loadingMore" data-action="more" @click="load(true)">{{ loadingMore ? t('reviewAi.arb.loading') : t('reviewAi.arb.loadMore') }}</button>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.ai-arb { display: grid; gap: var(--s-4); min-width: 0; }
.ai-arb__intro { margin: 0; }
.ai-arb__filters { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-3); align-items: center; }
.ai-arb__states { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.ai-arb__select { width: auto; min-width: 140px; max-width: 100%; }
.ai-arb__row { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; }
.ai-arb__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
.ai-arb__ghost { height: 132px; border-radius: var(--r-lg); }
.ai-arb__empty { padding: var(--s-5); display: grid; gap: var(--s-2); }
.ai-arb__empty p { margin: 0; }
.ai-arb__h { margin: 0; font-size: 16px; font-weight: 600; }
.ai-arb__acts { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.ai-arb__count { margin: 0; }
.ai-arb__more { display: flex; justify-content: center; }
.ai-row { padding: var(--s-4); display: grid; gap: var(--s-3); min-width: 0; }
.ai-row__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.ai-row__name { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; margin-inline-end: auto; }
.ai-row__sides { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-3); }
.ai-row__side { display: grid; gap: var(--s-1); min-width: 0; align-content: start; }
.ai-row__label { margin: 0; }
.ai-row__chips { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: 0; }
.ai-row__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); }
.ai-tag { cursor: default; max-width: 100%; }
.ai-tag:hover { color: var(--text-2); background: var(--surface-2); }
.ai-tag--pass, .ai-tag--pass:hover { color: var(--success); background: var(--success-soft); font-weight: 600; }
.ai-tag--reject, .ai-tag--reject:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, var(--surface)); font-weight: 600; }
.ai-tag--warn, .ai-tag--warn:hover { color: var(--warning-text); background: color-mix(in srgb, var(--warning-text) 12%, var(--surface)); font-weight: 600; }
@media (max-width: 760px) {
  .ai-arb__select { flex: 1 1 140px; min-height: var(--h-lg); }
  .ai-arb__states .seg__item { height: var(--h-md); }
  .ai-row__sides { grid-template-columns: minmax(0, 1fr); }
  .ai-row__foot .btn { min-height: var(--h-lg); }
}
</style>
