<script setup lang="ts">
/**
 * /review/stats — 審核統計（審卡 V2 第二批，管理員限定；ui.md §4.3，口徑 da.md）。
 *
 * 口徑、窗口、抑制都在服務端 src/review-stats.ts：這裡只排版與格式化。拿到的格子有三種——
 * ok（帶樣本數與分母）、suppressed（不到 10 筆或 5 位作者，顯示「樣本不足」）、unmeasured（沒記錄，顯示「量不到」）；
 * 分母是 0 的比例是 null，顯示 —。數字一律寫成字，不靠顏色分好壞。長條沿用 StatBars（純 CSS），表格橫捲。
 * V2 前的基線另起一區、不跟 V2 加總。CSV 與頁面是同一份彙總，按鈕用帶登入憑證的下載。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/lib/api';
import { downloadReviewStatsCsv, fetchReviewStats, STATS_WEEK_OPTIONS, type ReviewStats, type StatCell, type StatValues } from '@/lib/review-stats-api';
import { pageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import StatBars from '@/components/StatBars.vue';

const { t, locale } = useI18n();
const session = useSession();
const route = useRoute();
const router = useRouter();

const DASH = '—';
const HOUR = 3_600_000, DAY = 86_400_000;
const RESUBMIT_DAYS = 14, DROP_DAYS = 7;
const REASONS = ['opening.no_reply_hook', 'opening.no_focused_event', 'opening.exposition_only', 'opening.too_short', 'content.min_length', 'character.setting_thin', 'rating.mismatch', 'other'];
const OPENING = ['lt100', '100_299', '300_599', '600_1199', 'ge1200', 'missing'];
const UPDATE_BASES = ['approved', 'rejected', 'none', 'missing'];
const FIELDS = ['opening', 'setting', 'profile', 'lorebook', 'rules', 'presentation', 'unchanged'];
const OUTCOMES = ['restored', 'withdrawn', 'resubmitted_changed', 'still_dropped', 'other'];
const RESTORED = ['approved', 'rejected', 'pending', 'withdrawn'];
const SOURCES = ['single', 'author_batch', 'device_batch', 'auto_same_content'];
const OPS = ['approve', 'reject', 'hold', 'unhold', 'drop', 'restore', 'reopen', 'reopen_withdraw'];

const weeks = computed(() => {
  const n = Number(route.query.weeks);
  return (STATS_WEEK_OPTIONS as readonly number[]).includes(n) ? n : 4;
});
const stats = ref<ReviewStats | null>(null);
const loading = ref(true);
const failed = ref(false);
const forbidden = ref(false);
const exporting = ref(false);
const exportFailed = ref(false);
let generation = 0, alive = true;

async function token() {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}
async function load() {
  const gen = ++generation;
  loading.value = true; failed.value = false;
  try {
    const res = await fetchReviewStats(await token(), weeks.value);
    if (!alive || gen !== generation) return;
    stats.value = res; forbidden.value = false;
  } catch (e) {
    if (gen !== generation) return;
    if (e instanceof ApiError && e.status === 403) forbidden.value = true;
    else failed.value = true;
  } finally {
    if (gen === generation) loading.value = false;
  }
}
async function exportCsv() {
  exporting.value = true; exportFailed.value = false;
  try { await downloadReviewStatsCsv(await token(), weeks.value); } catch { exportFailed.value = true; } finally { exporting.value = false; }
}
function pickWeeks(next: string) { void router.replace({ query: { ...route.query, weeks: next } }); }

// 換期間：舊的數字先拿掉，免得新資料到之前看著上一個期間
watch(weeks, () => { stats.value = null; void load(); });
onMounted(() => { document.title = pageTitle(t('reviewStats.title')); void load(); });
onBeforeUnmount(() => { alive = false; });

// ---- 格式化 ----
const loc = computed(() => String(locale.value));
const int = (n: number) => new Intl.NumberFormat(loc.value, { maximumFractionDigits: 0 }).format(n);
const pct = (r: number | null | undefined) => (r == null ? DASH : new Intl.NumberFormat(loc.value, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(r));
const unit = (u: 'hour' | 'day', n: number) => new Intl.NumberFormat(loc.value, { style: 'unit', unit: u, unitDisplay: 'long', maximumFractionDigits: 1 }).format(n);
const duration = (ms: number | null | undefined) => (ms == null ? DASH : ms < 48 * HOUR ? unit('hour', ms / HOUR) : unit('day', ms / DAY));
const utcDay = (ms: number) => new Intl.DateTimeFormat(loc.value, { timeZone: 'UTC', dateStyle: 'medium' }).format(ms);
const localDay = (ms: number) => new Intl.DateTimeFormat(loc.value, { dateStyle: 'medium' }).format(ms);
const asOf = computed(() => (stats.value ? new Intl.DateTimeFormat(loc.value, { dateStyle: 'medium', timeStyle: 'short' }).format(stats.value.generatedAt) : ''));
/** 窗口右端是開區間：顯示最後一天 */
const windowText = computed(() => (stats.value ? t('reviewStats.window', { start: utcDay(stats.value.window.start), end: utcDay(stats.value.window.end - DAY) }) : ''));

// ---- 格子 ----
const blank: StatCell = { status: 'unmeasured' };
const cell = (section: string, dimension: string): StatCell => stats.value?.cells[section]?.[dimension] ?? blank;
/** 抑制與量不到的固定說法；ok 的格子交給 fmt */
function show(c: StatCell, fmt: (v: StatValues, n: number) => string): string {
  if (c.status === 'suppressed') return t('reviewStats.suppressed');
  if (c.status === 'unmeasured') return t('reviewStats.unmeasured');
  return fmt(c.values, c.n);
}
const ok = (c: StatCell): c is Extract<StatCell, { status: 'ok' }> => c.status === 'ok';
const v = (c: StatCell, key: string) => (ok(c) ? c.values[key] ?? null : null);
const bar = (key: string, label: string, c: StatCell, value: number, text: (vals: StatValues, n: number) => string) => ({ key, label, value: ok(c) ? value : 0, text: show(c, text) });

// 首屏四格
const decisions = computed(() => cell('decisions', 'all'));
const pending = computed(() => cell('stock', 'pending'));
const dropped = computed(() => cell('stock', 'dropped'));
const decisionWait = computed(() => cell('waits', 'first_decision'));
const tiles = computed(() => [
  { key: 'firstPass', label: t('reviewStats.tile.firstPass'), c: decisions.value, value: show(decisions.value, (x) => pct(x.rate)), note: show(decisions.value, (x) => t('reviewStats.tile.firstPassNote', { a: int(x.approved ?? 0), b: int(x.rejected ?? 0) })) },
  { key: 'pending', label: t('reviewStats.tile.pending'), c: pending.value, value: show(pending.value, (x) => t('reviewStats.cards', { n: int(x.count ?? 0) })), note: show(pending.value, (x) => (x.oldestDays == null ? DASH : t('reviewStats.tile.oldest', { n: int(x.oldestDays) }))) },
  { key: 'dropped', label: t('reviewStats.tile.dropped'), c: dropped.value, value: show(dropped.value, (x) => t('reviewStats.cards', { n: int(x.count ?? 0) })), note: show(dropped.value, (x) => (x.oldestDays == null ? DASH : t('reviewStats.tile.oldest', { n: int(x.oldestDays) }))) },
  { key: 'wait', label: t('reviewStats.tile.wait'), c: decisionWait.value, value: show(decisionWait.value, (x) => duration(x.medianMs)), note: show(decisionWait.value, (x, n) => `${t('reviewStats.tile.waitNote', { m: duration(x.medianMs), p: duration(x.p90Ms) })} ${t('reviewStats.sample', { n: int(n) })}`) },
]);
/** 空的時候只留資料截至時的存量兩格 */
const shownTiles = computed(() => (stats.value?.empty ? tiles.value.filter((x) => x.key === 'pending' || x.key === 'dropped') : tiles.value));

// 駁回理由
const reasonBars = computed(() => REASONS.map((code) => {
  const c = cell('reasons', code);
  return bar(code, t(`review.reasons.${code}.name`), c, v(c, 'share') ?? 0, (x) => t('reviewStats.reasons.bar', { pct: pct(x.share), n: int(x.count ?? 0) }));
}));
const coverage = computed(() => show(cell('reasons', 'coverage'), (x) => t('reviewStats.reasons.coverage', { a: int(x.coded ?? 0), b: int(x.rejects ?? 0), pct: pct(x.rate) })));

// 等待
const waitRows = computed(() => (['first_action', 'first_decision'] as const).map((k) => ({ key: k, label: t(`reviewStats.waits.${k === 'first_action' ? 'firstAction' : 'firstDecision'}`), c: cell('waits', k) })));

// 駁回後再送
const resubmitRows = computed(() => [
  { key: 'all', label: t('reviewStats.resubmit.all') },
  ...REASONS.map((code) => ({ key: `reason:${code}`, label: t(`review.reasons.${code}.name`) })),
  { key: 'reason:none', label: t('reviewStats.resubmit.noReason') },
  ...(['yes', 'no', 'unknown'] as const).map((b) => ({ key: `base:${b}`, label: t(`reviewStats.resubmit.base.${b}`) })),
].map((r) => ({ ...r, c: cell('resubmit', r.key) })));

// 不受理
const outcomeBars = computed(() => OUTCOMES.map((k) => { const c = cell('drop_outcome', k); return bar(k, t(`reviewStats.drop.outcome.${k}`), c, v(c, 'count') ?? 0, (x) => t('reviewStats.reasons.bar', { pct: pct(x.share), n: int(x.count ?? 0) })); }));
const outcomeSample = computed(() => show(cell('drop_outcome', 'all'), (x) => t('reviewStats.sample', { n: int(x.count ?? 0) })));
const restoredBars = computed(() => RESTORED.map((k) => { const c = cell('drop_restored', k); return bar(k, t(`reviewStats.drop.restored.${k}`), c, v(c, 'count') ?? 0, (x) => t('reviewStats.reasons.bar', { pct: pct(x.share), n: int(x.count ?? 0) })); }));
const sourceBars = computed(() => SOURCES.map((k) => { const c = cell('drop_source', k); return bar(k, t(`reviewStats.drop.source.${k}`), c, v(c, 'count') ?? 0, (x) => t('reviewStats.cards', { n: int(x.count ?? 0) })); }));

// 更新與結果、開場白字數
const updateBaseRows = computed(() => UPDATE_BASES.map((k) => ({ key: `base:${k}`, label: t(`reviewStats.updates.base.${k}`), c: cell('updates', `base:${k}`) })));
const updateFieldRows = computed(() => FIELDS.map((k) => ({ key: `field:${k}`, label: t(`reviewStats.updates.field.${k}`), c: cell('updates', `field:${k}`) })));
const openingRows = computed(() => OPENING.map((k) => ({ key: k, label: t(`reviewStats.opening.${k}`), c: cell('opening', k) })));

// 標記覆寫：每一版規則各一列；比例的分母沒有記錄
const markVersions = computed(() => Object.keys(stats.value?.cells.marks ?? {}).filter((k) => /^v\d+$/.test(k) || /^v\d+:rate$/.test(k)).map((k) => k.split(':')[0]!).filter((k, i, a) => a.indexOf(k) === i));
const markRows = computed(() => markVersions.value.map((ver) => ({
  key: ver, label: t('reviewStats.marks.version', { v: ver.slice(1) }),
  authors: show(cell('marks', ver), (x) => t('reviewStats.marks.authorsValue', { n: int(x.authors ?? 0) })),
  rate: show(cell('marks', `${ver}:rate`), (x) => pct(x.rate)),
})));

const opsBars = computed(() => OPS.map((k) => { const c = cell('operations', k); return bar(k, t(`reviewStats.ops.${k}`), c, v(c, 'count') ?? 0, (x) => int(x.count ?? 0)); }));

// V2 前基線
const baseline = computed(() => cell('baseline.decisions', 'all'));
const baselineWait = computed(() => cell('baseline.waits', 'first_decision'));
/** 基線截在 V2 開始的那一刻；伺服器只給到那一天（UTC），那天 V2 之前的定案也在基線裡 */
const baselineNote = computed(() => (stats.value ? t('reviewStats.baseline.note', { start: utcDay(stats.value.baseline.start), end: utcDay(stats.value.baseline.end) }) : ''));
const baselineStamps = computed(() => {
  const a = cell('baseline.stamps', 'approve'), r = cell('baseline.stamps', 'reject');
  if (!ok(a) || !ok(r)) return t('reviewStats.suppressed');
  return t('reviewStats.baseline.stamps', { a: int(a.values.count ?? 0), b: int(r.values.count ?? 0) });
});
</script>

<template>
  <section class="rs" data-page="review-stats" :aria-label="t('reviewStats.title')">
    <div class="rs-bar">
      <select class="input rs-weeks" data-filter="weeks" :value="String(weeks)" :aria-label="t('reviewStats.weeks')" @change="pickWeeks(($event.target as HTMLSelectElement).value)">
        <option v-for="n in STATS_WEEK_OPTIONS" :key="n" :value="String(n)">{{ t('reviewStats.weeksOption', { n }) }}</option>
      </select>
      <p v-if="stats" class="subtle rs-meta" data-meta>
        <span data-window>{{ windowText }}</span>
        <span data-as-of>{{ t('reviewStats.dataAsOf', { date: asOf }) }}</span>
        <span data-spec>{{ t('reviewStats.specVersion', { v: stats.specVersion }) }}</span>
      </p>
      <button type="button" class="btn btn--sm" data-action="export" :disabled="!stats || exporting" @click="exportCsv">{{ t('reviewStats.export') }}</button>
    </div>
    <p v-if="exportFailed" class="notice notice--error" role="alert" data-export-error>{{ t('reviewStats.exportFailed') }}</p>

    <p v-if="forbidden" class="notice notice--error" role="alert" data-forbidden>{{ t('state.forbidden') }}</p>
    <div v-else-if="failed" class="notice notice--error rs-error" role="alert" data-error>
      <span>{{ t('reviewStats.loadFailed') }}</span>
      <button type="button" class="btn btn--sm" data-action="reload" :disabled="loading" @click="load">{{ t('reviewStats.reload') }}</button>
    </div>
    <div v-else-if="loading && !stats" class="rs-skeleton" aria-busy="true" data-skeleton>
      <div class="rs-tiles"><div v-for="n in 4" :key="n" class="ghost rs-ghost-tile" /></div>
      <div v-for="n in 2" :key="n" class="ghost rs-ghost" />
    </div>

    <template v-if="stats && !forbidden && !failed">
      <dl class="rs-tiles" data-block="tiles">
        <div v-for="tile in shownTiles" :key="tile.key" class="stat panel rs-tile" :data-tile="tile.key" :data-status="tile.c.status">
          <dt>{{ tile.label }}</dt>
          <dd class="rs-tile__value">{{ tile.value }}</dd>
          <dd class="subtle rs-tile__note">{{ tile.note }}</dd>
        </div>
      </dl>

      <section v-if="stats.empty" class="panel rs-empty" data-empty>
        <h2 class="rs-h">{{ t('reviewStats.empty.title') }}</h2>
        <p class="muted">{{ t('reviewStats.empty.body', { date: localDay(stats.v2StartedAt) }) }}</p>
      </section>

      <template v-else>
        <!-- 駁回理由 -->
        <section class="panel rs-block" data-block="reasons" aria-labelledby="rs-reasons">
          <h2 id="rs-reasons" class="rs-h">{{ t('reviewStats.reasons.title') }}</h2>
          <p class="subtle rs-note">{{ t('reviewStats.reasons.note') }}</p>
          <StatBars group="reasons" :items="reasonBars" />
          <p class="subtle rs-note" data-coverage>{{ coverage }}</p>
        </section>

        <!-- 等待時間 -->
        <section class="panel rs-block" data-block="waits" aria-labelledby="rs-waits">
          <h2 id="rs-waits" class="rs-h">{{ t('reviewStats.waits.title') }}</h2>
          <div class="rs-scroll">
            <table class="rs-table">
              <thead><tr><th scope="col"><span class="sr-only">{{ t('reviewStats.col.item') }}</span></th><th scope="col">{{ t('reviewStats.col.median') }}</th><th scope="col">{{ t('reviewStats.col.p90') }}</th><th scope="col">{{ t('reviewStats.col.sample') }}</th></tr></thead>
              <tbody>
                <tr v-for="r in waitRows" :key="r.key" :data-row="`waits.${r.key}`">
                  <th scope="row">{{ r.label }}</th>
                  <template v-if="ok(r.c)"><td>{{ duration(r.c.values.medianMs) }}</td><td>{{ duration(r.c.values.p90Ms) }}</td><td>{{ int(r.c.n) }}</td></template>
                  <td v-else colspan="3" class="rs-state">{{ show(r.c, () => '') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 駁回後再送 -->
        <section class="panel rs-block" data-block="resubmit" aria-labelledby="rs-resubmit">
          <h2 id="rs-resubmit" class="rs-h">{{ t('reviewStats.resubmit.title') }}</h2>
          <p class="subtle rs-note">{{ t('reviewStats.resubmit.note', { n: RESUBMIT_DAYS }) }}</p>
          <div class="rs-scroll">
            <table class="rs-table">
              <thead><tr><th scope="col"><span class="sr-only">{{ t('reviewStats.col.item') }}</span></th><th scope="col">{{ t('reviewStats.col.rejects') }}</th><th scope="col">{{ t('reviewStats.col.resubmitted') }}</th><th scope="col">{{ t('reviewStats.col.resubmitRate') }}</th><th scope="col">{{ t('reviewStats.col.passAfter') }}</th></tr></thead>
              <tbody>
                <tr v-for="r in resubmitRows" :key="r.key" :data-row="`resubmit.${r.key}`">
                  <th scope="row">{{ r.label }}</th>
                  <template v-if="ok(r.c)"><td>{{ int(r.c.n) }}</td><td>{{ int(r.c.values.resubmitted ?? 0) }}</td><td>{{ pct(r.c.values.rate) }}</td><td>{{ pct(r.c.values.passRate) }} <span class="subtle">({{ int(r.c.values.approved ?? 0) }} / {{ int(r.c.values.decided ?? 0) }})</span></td></template>
                  <td v-else colspan="4" class="rs-state">{{ show(r.c, () => '') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 不受理的後續 -->
        <section class="panel rs-block" data-block="drop" aria-labelledby="rs-drop">
          <h2 id="rs-drop" class="rs-h">{{ t('reviewStats.drop.title') }}</h2>
          <p class="subtle rs-note">{{ t('reviewStats.drop.note', { n: DROP_DAYS }) }}</p>
          <h3 class="rs-h3">{{ t('reviewStats.drop.outcome', { n: DROP_DAYS }) }} <span class="subtle" data-drop-sample>{{ outcomeSample }}</span></h3>
          <StatBars group="drop.outcome" :items="outcomeBars" />
          <h3 class="rs-h3">{{ t('reviewStats.drop.restored') }}</h3>
          <StatBars group="drop.restored" :items="restoredBars" />
          <h3 class="rs-h3">{{ t('reviewStats.drop.source') }}</h3>
          <StatBars group="drop.source" :items="sourceBars" />
        </section>

        <!-- 更新與結果 -->
        <section class="panel rs-block" data-block="updates" aria-labelledby="rs-updates">
          <h2 id="rs-updates" class="rs-h">{{ t('reviewStats.updates.title') }}</h2>
          <p class="subtle rs-note">{{ t('reviewStats.updates.note') }}</p>
          <div v-for="group in [{ id: 'base', rows: updateBaseRows, caption: '' }, { id: 'field', rows: updateFieldRows, caption: t('reviewStats.updates.fields') }]" :key="group.id" class="rs-scroll">
            <table class="rs-table" :data-table="`updates.${group.id}`">
              <caption v-if="group.caption">{{ group.caption }}</caption>
              <thead><tr><th scope="col"><span class="sr-only">{{ t('reviewStats.col.item') }}</span></th><th scope="col">{{ t('reviewStats.col.cards') }}</th><th scope="col">{{ t('reviewStats.col.rejectRate') }}</th><th scope="col">{{ t('reviewStats.col.medianWait') }}</th></tr></thead>
              <tbody>
                <tr v-for="r in group.rows" :key="r.key" :data-row="`updates.${r.key}`">
                  <th scope="row">{{ r.label }}</th>
                  <template v-if="ok(r.c)"><td>{{ int(r.c.n) }}</td><td>{{ pct(r.c.values.rejectRate) }}</td><td>{{ duration(r.c.values.medianWaitMs) }}</td></template>
                  <td v-else colspan="3" class="rs-state">{{ show(r.c, () => '') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 開場白字數 -->
        <section class="panel rs-block" data-block="opening" aria-labelledby="rs-opening">
          <h2 id="rs-opening" class="rs-h">{{ t('reviewStats.opening.title') }}</h2>
          <p class="subtle rs-note">{{ t('reviewStats.opening.note') }}</p>
          <div class="rs-scroll">
            <table class="rs-table">
              <thead><tr><th scope="col"><span class="sr-only">{{ t('reviewStats.col.item') }}</span></th><th scope="col">{{ t('reviewStats.col.cards') }}</th><th scope="col">{{ t('reviewStats.col.rejects') }}</th><th scope="col">{{ t('reviewStats.col.rejectRate') }}</th></tr></thead>
              <tbody>
                <tr v-for="r in openingRows" :key="r.key" :data-row="`opening.${r.key}`">
                  <th scope="row">{{ r.label }}</th>
                  <template v-if="ok(r.c)"><td>{{ int(r.c.n) }}</td><td>{{ int(r.c.values.rejected ?? 0) }}</td><td>{{ pct(r.c.values.rejectRate) }}</td></template>
                  <td v-else colspan="3" class="rs-state">{{ show(r.c, () => '') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 標記被改過的比例 -->
        <section class="panel rs-block" data-block="marks" aria-labelledby="rs-marks">
          <h2 id="rs-marks" class="rs-h">{{ t('reviewStats.marks.title') }}</h2>
          <p class="subtle rs-note">{{ t('reviewStats.marks.note') }}</p>
          <div class="rs-scroll">
            <table class="rs-table">
              <thead><tr><th scope="col"><span class="sr-only">{{ t('reviewStats.col.item') }}</span></th><th scope="col">{{ t('reviewStats.marks.authors') }}</th><th scope="col">{{ t('reviewStats.marks.rate') }}</th></tr></thead>
              <tbody>
                <tr v-for="r in markRows" :key="r.key" :data-row="`marks.${r.key}`"><th scope="row">{{ r.label }}</th><td>{{ r.authors }}</td><td>{{ r.rate }}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 人工處理次數 -->
        <section class="panel rs-block" data-block="operations" aria-labelledby="rs-ops">
          <h2 id="rs-ops" class="rs-h">{{ t('reviewStats.ops.title') }}</h2>
          <StatBars group="ops" :items="opsBars" />
        </section>
      </template>

      <!-- V2 之前：現況回溯，分開呈現、不加總 -->
      <section class="panel rs-block rs-baseline" data-block="baseline" aria-labelledby="rs-baseline">
        <h2 id="rs-baseline" class="rs-h">{{ t('reviewStats.baseline.title') }}</h2>
        <p class="subtle rs-note">{{ baselineNote }}</p>
        <dl class="rs-tiles rs-tiles--flat">
          <div class="stat" data-baseline="passRate" :data-status="baseline.status">
            <dt>{{ t('reviewStats.baseline.passRate') }}</dt>
            <dd>{{ show(baseline, (x) => pct(x.rate)) }}</dd>
            <dd class="subtle">{{ show(baseline, (x) => t('reviewStats.tile.firstPassNote', { a: int(x.approved ?? 0), b: int(x.rejected ?? 0) })) }}</dd>
          </div>
          <div class="stat" data-baseline="wait" :data-status="baselineWait.status">
            <dt>{{ t('reviewStats.tile.wait') }}</dt>
            <dd>{{ show(baselineWait, (x) => duration(x.medianMs)) }}</dd>
            <dd class="subtle">{{ show(baselineWait, (x, n) => `${t('reviewStats.tile.waitNote', { m: duration(x.medianMs), p: duration(x.p90Ms) })} ${t('reviewStats.sample', { n: int(n) })}`) }}</dd>
          </div>
          <div class="stat" data-baseline="reasons" :data-status="cell('baseline.reasons', 'all').status">
            <dt>{{ t('reviewStats.baseline.reasons') }}</dt>
            <dd>{{ show(cell('baseline.reasons', 'all'), () => '') }}</dd>
          </div>
        </dl>
        <p class="subtle rs-note" data-baseline="stamps">{{ baselineStamps }}</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.rs { display: grid; gap: var(--s-4); min-width: 0; }
.rs-bar { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; }
.rs-weeks { width: auto; min-width: 140px; max-width: 100%; }
.rs-meta { margin: 0; margin-inline-start: auto; display: flex; flex-wrap: wrap; gap: var(--s-1) var(--s-3); }
.rs-error { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; }
.rs-skeleton { display: grid; gap: var(--s-3); }
.rs-ghost-tile { height: 104px; }
.rs-ghost { height: 180px; }
.rs-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--s-3); margin: 0; }
.rs-tiles dd { margin: 0; }
.rs-tile { padding: var(--s-4); display: grid; gap: var(--s-1); align-content: start; min-width: 0; }
.rs-tile__value { font-size: 24px; }
.rs-tile__note { font-size: 12.5px; font-weight: 400; letter-spacing: 0; overflow-wrap: anywhere; }
.rs-tiles--flat .stat { display: grid; gap: var(--s-1); align-content: start; min-width: 0; }
.rs-tiles--flat .subtle { font-size: 12.5px; font-weight: 400; letter-spacing: 0; }
.rs-empty { padding: var(--s-5); display: grid; gap: var(--s-2); }
.rs-empty p { margin: 0; }
.rs-block { padding: var(--s-5); display: grid; gap: var(--s-3); min-width: 0; }
.rs-h { margin: 0; font-size: 16px; font-weight: 600; }
.rs-h3 { margin: var(--s-2) 0 0; font-size: 13px; font-weight: 600; color: var(--text-2); }
.rs-note { margin: 0; }
.rs-scroll { overflow-x: auto; min-width: 0; }
.rs-table { width: 100%; border-collapse: collapse; font-size: 13.5px; font-variant-numeric: tabular-nums; }
.rs-table caption { text-align: start; font-size: 13px; font-weight: 600; color: var(--text-2); padding-bottom: var(--s-2); }
.rs-table th, .rs-table td { padding: var(--s-2) var(--s-3); border-bottom: 1px solid var(--line); text-align: end; white-space: nowrap; }
.rs-table thead th { font-size: 12px; font-weight: 500; color: var(--text-3); }
.rs-table tbody th { text-align: start; font-weight: 500; white-space: normal; min-width: 140px; }
.rs-table tbody tr:last-child > * { border-bottom: 0; }
.rs-state { color: var(--text-2); }
@media (max-width: 760px) {
  .rs-block { padding: var(--s-4); }
  .rs-weeks, .rs-bar .btn, .rs-error .btn { min-height: 44px; }
  .rs-weeks { flex: 1; }
  .rs-meta { margin-inline-start: 0; flex-basis: 100%; order: 3; }
  .rs-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
