<script setup lang="ts">
/**
 * /review/ai/report — 人工 vs AI 與仲裁報表（管理員，ui-arbitration.md「仲裁報表」）。
 *
 * 數字來自 /v1/review-ai/report（依判準版本分組，只算人已決定的單）。這支沒有在服務端抑制小樣本，
 * 這裡照審核統計的門檻：每個數字的分母少於 10 就顯示「樣本不足」——一致率、AI／人較嚴看「兩邊都下了結論」的張數，
 * 交人比例與決定矩陣看對照總數，仲裁分佈看已仲裁筆數，各理由看人錯＋AI 錯的筆數。費用是總額，不抑制。
 *
 * 參考範例：伺服器最多回最近 30 筆被勾進範例池的分歧；匯出就是把這一份存成 JSON 草稿（不含帳號與卡號），PM 審過才成為新版本。
 *
 * 兩段式定案（ui-two-stage.md）：每個判準版本多列定案來源（用我的／用 AI 的／修改後／沒有 AI 對照）與改用 AI 結論的筆數，
 * 少於 10 筆一樣抑制。「被說服」（v21）是仲裁表多的一欄：每人每筆最後一次選「說服我了」的比例，分母是已判筆數，自己少於 10 筆就抑制
 * （不看仲裁筆數）；仲裁表因為筆數不夠沒畫時，這一欄單獨成一張小表。「給 AI 的說明」列出定案與仲裁時寫的全文（新的在前、不列審核員），可依原因類型篩，期間跟著上面的選擇。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/lib/api';
import { AI_NOTE_TYPES, AI_NOTES_LIMIT, ARBITRATION_VALUES, FINAL_SOURCES, fetchAiNotes, fetchAiReport, fetchReferenceCandidates, type AiNoteItem, type AiNoteType, type AiReportVersion, type ReferenceCandidate } from '@/lib/review-ai-api';
import { enough, isManagerRole, versionNumber } from '@/lib/review-ai';
import { reasonKey } from '@/lib/review-reasons';
import { useReviewer } from '@/lib/review';
import { useSession } from '@/lib/session';
import { pageTitle } from '@/lib/i18n';
import { dateTime } from '@/lib/format';
import ReviewAiNav from '@/components/ReviewAiNav.vue';

const DAY_OPTIONS = [7, 30, 90, 120] as const;
const DASH = '—';
const { t, locale } = useI18n();
const session = useSession();
const reviewer = useReviewer();
const route = useRoute();
const router = useRouter();

// 審核身分查回來之前不讀也不擋（骨架）；查回來不是管理員就只說一句，不發請求
const allowed = computed(() => reviewer.reviewer === true && isManagerRole(reviewer.role));
const denied = computed(() => reviewer.reviewer !== null && !allowed.value);
const forbidden = ref(false);
const days = computed(() => { const n = Number(route.query.days); return (DAY_OPTIONS as readonly number[]).includes(n) ? n : 7; });
function pickDays(v: string) { void router.replace({ query: { ...route.query, days: v === '7' ? undefined : v } }); }

const versions = ref<AiReportVersion[] | null>(null);
const loading = ref(true);
const failed = ref(false);
let alive = true, generation = 0;
onBeforeUnmount(() => { alive = false; });

async function token() {
  const v = await session.accessToken();
  if (!v) throw new Error(t('auth.expired'));
  return v;
}
async function load() {
  if (!allowed.value) return;
  const gen = ++generation;
  loading.value = true; failed.value = false; versions.value = null;
  try {
    const res = await fetchAiReport(await token(), days.value);
    if (!alive || gen !== generation) return;
    versions.value = [...res.versions].sort((a, b) => versionNumber(b.criteriaVersion) - versionNumber(a.criteriaVersion));
  } catch (e) {
    if (!alive || gen !== generation) return;
    if (e instanceof ApiError && e.status === 403) forbidden.value = true; else failed.value = true;
  } finally {
    if (gen === generation) loading.value = false;
  }
}

// ---- 參考範例 ----
const refs = ref<{ items: ReferenceCandidate[]; skipped: number } | null>(null);
const refsFailed = ref(false);
async function loadRefs() {
  if (!allowed.value) return;
  refsFailed.value = false;
  try {
    const res = await fetchReferenceCandidates(await token());
    if (alive) refs.value = res;
  } catch (e) {
    if (!alive) return;
    if (e instanceof ApiError && e.status === 403) forbidden.value = true; else refsFailed.value = true;
  }
}
const poolCounts = computed(() => ({ pass: refs.value?.items.filter((i) => i.verdict === 'pass').length ?? 0, reject: refs.value?.items.filter((i) => i.verdict === 'reject').length ?? 0 }));
function exportRefs() {
  if (!refs.value?.items.length) return;
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const blob = new Blob([JSON.stringify(refs.value.items, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url; a.download = `review-references-draft-${stamp}.json`; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// ---- 給 AI 的說明 ----
const notes = ref<AiNoteItem[] | null>(null);
const notesFailed = ref(false);
const noteType = ref<AiNoteType | null>(null);
let notesGeneration = 0;
async function loadNotes() {
  if (!allowed.value) return;
  const gen = ++notesGeneration;
  notesFailed.value = false; notes.value = null;
  try {
    const res = await fetchAiNotes(await token(), { days: days.value, type: noteType.value });
    if (alive && gen === notesGeneration) notes.value = res.items;
  } catch (e) {
    if (!alive || gen !== notesGeneration) return;
    if (e instanceof ApiError && e.status === 403) forbidden.value = true; else notesFailed.value = true;
  }
}
function pickNoteType(v: string) { noteType.value = (AI_NOTE_TYPES as readonly string[]).includes(v) ? (v as AiNoteType) : null; }

watch(days, () => { void load(); void loadNotes(); });
watch(noteType, () => void loadNotes());
watch(allowed, (a) => { if (a && !versions.value) { void load(); void loadRefs(); void loadNotes(); } });
onMounted(() => { document.title = pageTitle(t('reviewAi.arb.title')); if (allowed.value) { void load(); void loadRefs(); void loadNotes(); } });

// ---- 格式化 ----
const loc = computed(() => String(locale.value));
const int = (n: number) => new Intl.NumberFormat(loc.value).format(n);
const pct = (r: number | null) => (r == null ? DASH : new Intl.NumberFormat(loc.value, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(r));
const usd = (n: number) => new Intl.NumberFormat(loc.value, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(n);
const small = () => t('reviewStats.suppressed');
const arbTotal = (v: AiReportVersion) => (v.arbitration ? ARBITRATION_VALUES.reduce((n, k) => n + v.arbitration!.values[k], 0) : 0);
const reasonRows = (v: AiReportVersion) => Object.entries(v.arbitration?.reasons ?? {}).map(([code, c]) => ({ code, ...c, n: c.humanWrong + c.aiWrong })).sort((a, b) => b.n - a.n);
/** 兩段式定案筆數（舊版伺服器不帶 finalSource：整段不畫） */
const finalTotal = (v: AiReportVersion) => FINAL_SOURCES.reduce((n, k) => n + (v.finalSource?.[k] ?? 0), 0);
/** 被說服：已判不到 10 筆寫樣本不足（不看仲裁筆數） */
const persuadedCell = (v: AiReportVersion) => {
  const p = v.persuasion;
  if (!p || !enough(p.rated)) return small();
  return t('reviewAi.arb.report.persuadedCell', { pct: pct(p.convinced / p.rated), yes: int(p.convinced), total: int(p.rated) });
};
const MATRIX_ROWS = ['approved', 'rejected', 'dropped'] as const;
const MATRIX_COLS = ['pass', 'reject', 'handoff'] as const;
</script>

<template>
  <section class="ai-rep" data-page="review-ai-report" :aria-label="t('reviewAi.arb.title')">
    <ReviewAiNav />
    <p v-if="denied || forbidden" class="notice notice--error" role="alert" data-forbidden>{{ t('state.forbidden') }}</p>
    <template v-else>
      <div class="ai-rep__bar">
        <select class="input ai-rep__days" :value="String(days)" :aria-label="t('reviewAi.arb.report.window')" data-filter="days" @change="pickDays(($event.target as HTMLSelectElement).value)">
          <option v-for="n in DAY_OPTIONS" :key="n" :value="String(n)">{{ t('reviewAi.arb.report.days', { n }) }}</option>
        </select>
        <p class="subtle ai-rep__note">{{ t('reviewAi.arb.report.rule') }}</p>
      </div>

      <div v-if="failed" class="notice notice--error ai-rep__row" role="alert" data-error>
        <span>{{ t('reviewAi.arb.report.loadFailed') }}</span>
        <button type="button" class="btn btn--sm" @click="load">{{ t('reviewAi.arb.retry') }}</button>
      </div>
      <div v-else-if="loading" class="ai-rep__skeleton" aria-busy="true" data-skeleton><div v-for="n in 2" :key="n" class="ghost ai-rep__ghost" /></div>
      <section v-else-if="versions && !versions.length" class="panel ai-rep__block" data-empty>
        <h2 class="ai-rep__h">{{ t('reviewAi.arb.report.emptyTitle') }}</h2>
        <p class="muted ai-rep__note">{{ t('reviewAi.arb.report.emptyBody') }}</p>
      </section>

      <section v-for="v in versions ?? []" :key="v.criteriaVersion" class="panel ai-rep__block" :data-version="v.criteriaVersion" :aria-labelledby="`ai-rep-${v.criteriaVersion}`">
        <h2 :id="`ai-rep-${v.criteriaVersion}`" class="ai-rep__h">{{ t('reviewAi.arb.criteria', { v: v.criteriaVersion }) }}</h2>
        <dl class="ai-rep__tiles">
          <div class="stat"><dt>{{ t('reviewAi.arb.report.total') }}</dt><dd>{{ int(v.total) }}</dd></div>
          <div class="stat" data-cell="agreement"><dt>{{ t('reviewAi.arb.report.agreement') }}</dt><dd>{{ enough(v.comparable) ? pct(v.agreement) : small() }}</dd><dd class="subtle ai-rep__sub">{{ t('reviewAi.arb.report.comparable', { n: int(v.comparable) }) }}</dd></div>
          <div class="stat" data-cell="aiStricter"><dt>{{ t('reviewAi.arb.report.aiStricter') }}</dt><dd>{{ enough(v.comparable) ? int(v.aiStricter) : small() }}</dd></div>
          <div class="stat" data-cell="humanStricter"><dt>{{ t('reviewAi.arb.report.humanStricter') }}</dt><dd>{{ enough(v.comparable) ? int(v.humanStricter) : small() }}</dd></div>
          <div class="stat" data-cell="handoff"><dt>{{ t('reviewAi.arb.report.handoffRate') }}</dt><dd>{{ enough(v.total) ? pct(v.handoffRate) : small() }}</dd></div>
          <div class="stat" data-cell="cost"><dt>{{ t('reviewAi.arb.report.cost') }}</dt><dd>{{ usd(v.costUsd) }}</dd></div>
        </dl>

        <h3 class="ai-rep__h3">{{ t('reviewAi.arb.report.matrix') }}</h3>
        <div class="ai-rep__scroll">
          <table class="ai-rep__table" data-table="matrix">
            <thead><tr><th scope="col"><span class="sr-only">{{ t('reviewAi.arb.human') }}</span></th><th v-for="c in MATRIX_COLS" :key="c" scope="col">{{ t(`reviewAi.arb.report.col.${c}`) }}</th></tr></thead>
            <tbody>
              <tr v-for="r in MATRIX_ROWS" :key="r">
                <th scope="row">{{ t(`reviewAi.arb.decision.${r}`) }}</th>
                <template v-if="enough(v.total)"><td v-for="c in MATRIX_COLS" :key="c">{{ int(v.matrix[r][c]) }}</td></template>
                <td v-else colspan="3" class="ai-rep__state">{{ small() }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 class="ai-rep__h3">{{ t('reviewAi.arb.report.arbitration') }}</h3>
        <p v-if="!arbTotal(v)" class="muted ai-rep__note" data-arb-none>{{ t('reviewAi.arb.report.noArbitration') }}</p>
        <p v-else-if="!enough(arbTotal(v))" class="muted ai-rep__note" data-arb-small>{{ t('reviewAi.arb.report.smallArbitration', { n: int(arbTotal(v)) }) }}</p>
        <div v-else class="ai-rep__scroll">
          <table class="ai-rep__table" data-table="arbitration">
            <thead><tr><th scope="col">{{ t('reviewAi.arb.report.col.arbitrated') }}</th><th v-for="k in ARBITRATION_VALUES" :key="k" scope="col">{{ t(`reviewAi.arb.value.${k}`) }}</th><th scope="col">{{ t('reviewAi.arb.report.col.persuaded') }}</th></tr></thead>
            <tbody><tr><td>{{ int(arbTotal(v)) }}</td><td v-for="k in ARBITRATION_VALUES" :key="k">{{ pct(v.arbitration!.values[k] / arbTotal(v)) }} <span class="subtle">({{ int(v.arbitration!.values[k]) }})</span></td><td data-cell="persuaded">{{ persuadedCell(v) }}</td></tr></tbody>
          </table>
        </div>
        <div v-if="!enough(arbTotal(v)) && v.persuasion?.rated" class="ai-rep__scroll">
          <table class="ai-rep__table" data-table="persuasion">
            <thead><tr><th scope="col">{{ t('reviewAi.arb.report.col.persuaded') }}</th></tr></thead>
            <tbody><tr><td data-cell="persuaded">{{ persuadedCell(v) }}</td></tr></tbody>
          </table>
        </div>

        <template v-if="v.finalSource">
          <h3 class="ai-rep__h3">{{ t('reviewAi.arb.report.finalSource') }}</h3>
          <p v-if="!finalTotal(v)" class="muted ai-rep__note" data-final-none>{{ t('reviewAi.arb.report.finalNone') }}</p>
          <p v-else-if="!enough(finalTotal(v))" class="muted ai-rep__note" data-final-small>{{ t('reviewAi.arb.report.finalSmall', { n: int(finalTotal(v)) }) }}</p>
          <div v-else class="ai-rep__scroll">
            <table class="ai-rep__table" data-table="final">
              <thead><tr><th scope="col">{{ t('reviewAi.arb.report.col.finals') }}</th><th v-for="k in FINAL_SOURCES" :key="k" scope="col">{{ t(`reviewAi.two.source.${k}`) }}</th><th scope="col">{{ t('reviewAi.arb.report.corrected') }}</th></tr></thead>
              <tbody><tr><td>{{ int(finalTotal(v)) }}</td><td v-for="k in FINAL_SOURCES" :key="k" :data-final-cell="k">{{ int(v.finalSource[k] ?? 0) }}</td><td data-final-cell="corrected">{{ int(v.corrected ?? 0) }}</td></tr></tbody>
            </table>
          </div>
          <p v-if="enough(finalTotal(v))" class="subtle ai-rep__note">{{ t('reviewAi.arb.report.correctedNote') }}</p>
        </template>

        <template v-if="reasonRows(v).length">
          <h3 class="ai-rep__h3">{{ t('reviewAi.arb.report.reasons') }}</h3>
          <p class="subtle ai-rep__note">{{ t('reviewAi.arb.report.reasonsNote') }}</p>
          <div class="ai-rep__scroll">
            <table class="ai-rep__table" data-table="reasons">
              <thead><tr><th scope="col">{{ t('reviewAi.arb.report.col.reason') }}</th><th scope="col">{{ t('reviewAi.arb.report.col.humanWrong') }}</th><th scope="col">{{ t('reviewAi.arb.report.col.aiWrong') }}</th></tr></thead>
              <tbody>
                <tr v-for="r in reasonRows(v)" :key="r.code" :data-row="r.code">
                  <th scope="row">{{ t(reasonKey(r.code, 'name')) }}</th>
                  <template v-if="enough(r.n)"><td>{{ int(r.humanWrong) }}</td><td>{{ int(r.aiWrong) }}</td></template>
                  <td v-else colspan="2" class="ai-rep__state">{{ small() }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>

      <!-- 給 AI 的說明：定案與仲裁時寫的全文，新的在前；不列審核員 -->
      <section class="panel ai-rep__block" data-block="notes" aria-labelledby="ai-rep-notes">
        <h2 id="ai-rep-notes" class="ai-rep__h">{{ t('reviewAi.arb.notes.title') }}</h2>
        <div class="ai-rep__bar">
          <select class="input ai-rep__days" :value="noteType ?? ''" :aria-label="t('reviewAi.arb.notes.filter')" data-filter="note-type" @change="pickNoteType(($event.target as HTMLSelectElement).value)">
            <option value="">{{ t('reviewAi.arb.notes.filterAll') }}</option>
            <option v-for="type in AI_NOTE_TYPES" :key="type" :value="type">{{ t(`reviewAi.note.type.${type}`) }}</option>
          </select>
          <p class="subtle ai-rep__note">{{ t('reviewAi.arb.notes.rule', { n: AI_NOTES_LIMIT }) }}</p>
        </div>
        <div v-if="notesFailed" class="notice notice--error ai-rep__row" role="alert">
          <span>{{ t('reviewAi.arb.notes.failed') }}</span>
          <button type="button" class="btn btn--sm" @click="loadNotes">{{ t('reviewAi.arb.retry') }}</button>
        </div>
        <div v-else-if="!notes" class="ghost ai-rep__ghost--sm" aria-hidden="true" />
        <p v-else-if="!notes.length" class="muted ai-rep__note" data-notes-empty>{{ t(noteType ? 'reviewAi.arb.notes.emptyFiltered' : 'reviewAi.arb.notes.empty') }}</p>
        <ul v-else class="ai-rep__notes" data-notes>
          <li v-for="(n, i) in notes" :key="i" class="ai-rep__noteItem" :data-note-kind="n.kind">
            <p class="ai-rep__chips">
              <span class="chip ai-rep__chip ai-rep__chip--strong">{{ t(`reviewAi.arb.notes.kind.${n.kind}`) }}</span>
              <span v-if="n.kind === 'final' && n.finalSource" class="chip ai-rep__chip">{{ t(`reviewAi.two.source.${n.finalSource}`) }}</span>
              <span v-if="n.kind === 'arbitration' && n.arbitration" class="chip ai-rep__chip">{{ t(`reviewAi.arb.value.${n.arbitration}`) }}</span>
              <span v-if="n.criteriaVersion" class="chip ai-rep__chip">{{ t('reviewAi.arb.criteria', { v: n.criteriaVersion }) }}</span>
              <span class="subtle">{{ dateTime(n.at) }}</span>
            </p>
            <p v-if="n.types.length" class="ai-rep__chips"><span v-for="type in n.types" :key="type" class="chip ai-rep__chip">{{ t(`reviewAi.note.type.${type}`) }}</span></p>
            <p v-if="n.note" class="ai-rep__noteText">{{ n.note }}</p>
            <p v-else class="muted ai-rep__note">{{ t('reviewAi.arb.notes.typesOnly') }}</p>
          </li>
        </ul>
      </section>

      <!-- 參考範例 -->
      <section class="panel ai-rep__block" data-block="references" aria-labelledby="ai-rep-refs">
        <h2 id="ai-rep-refs" class="ai-rep__h">{{ t('reviewAi.arb.refs.title') }}</h2>
        <div v-if="refsFailed" class="notice notice--error ai-rep__row" role="alert">
          <span>{{ t('reviewAi.arb.refs.failed') }}</span>
          <button type="button" class="btn btn--sm" @click="loadRefs">{{ t('reviewAi.arb.retry') }}</button>
        </div>
        <div v-else-if="!refs" class="ghost ai-rep__ghost--sm" aria-hidden="true" />
        <template v-else>
          <p class="ai-rep__note" data-ref-counts>{{ refs.items.length ? t('reviewAi.arb.refs.counts', { n: int(refs.items.length), pass: int(poolCounts.pass), reject: int(poolCounts.reject) }) : t('reviewAi.arb.refs.empty') }}</p>
          <p v-if="refs.skipped" class="subtle ai-rep__note" data-ref-skipped>{{ t('reviewAi.arb.refs.skipped', { n: int(refs.skipped) }) }}</p>
          <p class="subtle ai-rep__note">{{ t('reviewAi.arb.refs.cap') }}</p>
          <div class="ai-rep__acts"><button type="button" class="btn" :disabled="!refs.items.length" data-action="export" @click="exportRefs">{{ t('reviewAi.arb.refs.export') }}</button></div>
          <p class="subtle ai-rep__note">{{ t('reviewAi.arb.refs.note') }}</p>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
.ai-rep { display: grid; gap: var(--s-4); min-width: 0; }
.ai-rep__bar { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-3); align-items: center; }
.ai-rep__days { width: auto; min-width: 140px; max-width: 100%; }
.ai-rep__row { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; }
.ai-rep__skeleton { display: grid; gap: var(--s-3); }
.ai-rep__ghost { height: 220px; border-radius: var(--r-lg); }
.ai-rep__ghost--sm { height: 72px; border-radius: var(--r-md); }
.ai-rep__block { padding: var(--s-5); display: grid; gap: var(--s-3); min-width: 0; }
.ai-rep__h { margin: 0; font-size: 16px; font-weight: 600; }
.ai-rep__h3 { margin: var(--s-2) 0 0; font-size: 13px; font-weight: 600; color: var(--text-2); }
.ai-rep__note { margin: 0; overflow-wrap: anywhere; }
.ai-rep__tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--s-3); margin: 0; }
.ai-rep__tiles .stat { display: grid; gap: var(--s-1); align-content: start; min-width: 0; }
.ai-rep__tiles dd { margin: 0; }
.ai-rep__sub { font-size: 12px; font-weight: 400; letter-spacing: 0; }
.ai-rep__scroll { overflow-x: auto; min-width: 0; }
.ai-rep__table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
.ai-rep__table th, .ai-rep__table td { padding: var(--s-2) var(--s-3); border-bottom: 1px solid var(--line); text-align: end; white-space: nowrap; }
.ai-rep__table thead th { font-size: 12px; font-weight: 500; color: var(--text-3); }
.ai-rep__table tbody th { text-align: start; font-weight: 500; white-space: normal; min-width: 120px; }
.ai-rep__table tbody tr:last-child > * { border-bottom: 0; }
.ai-rep__state { color: var(--text-2); }
.ai-rep__acts { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.ai-rep__notes { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
.ai-rep__noteItem { display: grid; gap: var(--s-2); min-width: 0; padding-top: var(--s-3); border-top: 1px solid var(--line); }
.ai-rep__noteItem:first-child { padding-top: 0; border-top: 0; }
.ai-rep__chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); margin: 0; }
.ai-rep__chip { cursor: default; max-width: 100%; }
.ai-rep__chip:hover { color: var(--text-2); background: var(--surface-2); }
.ai-rep__chip--strong, .ai-rep__chip--strong:hover { color: var(--accent-text); background: var(--accent-tint); font-weight: 600; }
.ai-rep__noteText { margin: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 14px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .ai-rep__block { padding: var(--s-4); }
  .ai-rep__days, .ai-rep__acts .btn { min-height: var(--h-lg); }
  .ai-rep__tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
