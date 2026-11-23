<script setup lang="ts">
/**
 * /review/ai/:suggestionId — 單筆 AI 分歧仲裁（管理員，ui-arbitration.md「單筆仲裁」）。
 *
 * 桌機三欄：卡片｜人工｜AI；手機直排，角色設定與世界書折疊。卡片內容是 AI 讀到的那一份封存版本；
 * 定案後原始設定讀不到時（content.state=unavailable）明說，只留審核紀錄。
 *
 * 仲裁四選一、不預選；備註選填（≤500）。「加入參考範例」只有人對／AI 對能勾，池照仲裁後的正確結論（與伺服器同一條規則）。
 * 仲裁不改原決定、不通知作者，可以重新仲裁（報表取最後一筆），所以不需要確認層。
 * 送出失敗保留選擇與備註；同一組內容重試沿用同一個 operationId（伺服器回同一筆，不會多記），內容改了才換新的。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/lib/api';
import { ARBITRATION_VALUES, arbitrate, fetchDisagreement, fetchDisagreements, type Arbitration, type DisagreementDetail } from '@/lib/review-ai-api';
import { isManagerRole, referencePool } from '@/lib/review-ai';
import { reasonKey } from '@/lib/review-reasons';
import { reviewDiffFieldLabel } from '@/lib/review-diff-labels';
import { useReviewer } from '@/lib/review';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { dateTime } from '@/lib/format';
import { pageTitle } from '@/lib/i18n';
import ReviewAiNav from '@/components/ReviewAiNav.vue';

const NOTE_MAX = 500;
const { t, te, locale } = useI18n();
const { lp } = useLocalePath();
const session = useSession();
const reviewer = useReviewer();
const route = useRoute();

// 審核身分查回來之前不讀也不擋（骨架）；查回來不是管理員就只說一句，不發請求
const allowed = computed(() => reviewer.reviewer === true && isManagerRole(reviewer.role));
const denied = computed(() => reviewer.reviewer !== null && !allowed.value);
const forbidden = ref(false);
const id = computed(() => String(route.params.suggestionId ?? ''));
const data = ref<DisagreementDetail | null>(null);
const loading = ref(true);
const loadError = ref<'' | 'failed' | 'notFound'>('');
let alive = true, generation = 0;
onBeforeUnmount(() => { alive = false; media?.removeEventListener('change', onMedia); });

async function token() {
  const v = await session.accessToken();
  if (!v) throw new Error(t('auth.expired'));
  return v;
}
async function load() {
  if (!allowed.value || !id.value) return;
  const gen = ++generation, target = id.value;
  loading.value = true; loadError.value = '';
  try {
    const res = await fetchDisagreement(target, await token());
    if (!alive || gen !== generation) return;
    data.value = res;
    document.title = pageTitle(`${t('reviewAi.arb.title')} · ${res.content.state === 'ready' ? res.content.card.name : t('reviewAi.arb.cardNo', { id: res.submission.cardId })}`);
  } catch (e) {
    if (!alive || gen !== generation) return;
    if (e instanceof ApiError && e.status === 403) forbidden.value = true;
    else loadError.value = e instanceof ApiError && e.status === 404 ? 'notFound' : 'failed';
  } finally {
    if (gen === generation) loading.value = false;
  }
}
function reset() { data.value = null; choice.value = null; note.value = ''; addRef.value = false; sendError.value = ''; result.value = null; next.value = null; pendingOp = null; }
watch(id, () => { reset(); void load(); });
watch(allowed, (a) => { if (a && !data.value) void load(); });
onMounted(() => { document.title = pageTitle(t('reviewAi.arb.title')); void load(); });

/** 桌機（≥1080，與審核詳情同一個斷點）三欄並排、設定與世界書展開；手機直排、預設折疊 */
const wide = ref(false);
const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 1080px)') : null;
const onMedia = () => { wide.value = !!media?.matches; };
onMedia();
media?.addEventListener('change', onMedia);

const card = computed(() => (data.value?.content.state === 'ready' ? data.value.content.card : null));
const name = computed(() => card.value?.name || (data.value ? t('reviewAi.arb.cardNo', { id: data.value.submission.cardId }) : ''));
const opening = computed(() => {
  const o = card.value?.openings;
  if (!o) return '';
  return o.mode === 'page' && o.page ? o.page : o.welcome || o.page;
});
const pct = (n: number) => new Intl.NumberFormat(String(locale.value), { style: 'percent', maximumFractionDigits: 0 }).format(n);
const update = computed(() => data.value?.update ?? null);
/** 更新：逐欄列出改前改後（AI 讀到的也是這一份，每邊最多 1,500 字），折疊，點開才看 */
const fieldLabel = (key: string) => reviewDiffFieldLabel(key, t, te);

// ---- 仲裁 ----
const choice = ref<Arbitration | null>(null);
const note = ref('');
const addRef = ref(false);
const sending = ref(false);
const sendError = ref('');
const result = ref<{ value: Arbitration; referencePool: 'pass' | 'reject' | null; note: string } | null>(null);
/** 下一筆待仲裁：送出後查一次（清單第一筆與總數） */
const next = ref<{ id: string | null; total: number } | null>(null);
let pendingOp: { key: string; id: string } | null = null;

const pool = computed(() => (data.value ? referencePool(choice.value, data.value.human.decision, data.value.ai.verdict) : null));
// 換成不能當範例的結果時取消勾選，不然伺服器會拒絕（reference_needs_a_winner）
watch(pool, (p) => { if (!p) addRef.value = false; });
const poolHint = computed(() => (!choice.value ? t('reviewAi.arb.form.pool.pick') : pool.value ? t(`reviewAi.arb.form.pool.${pool.value}`) : t('reviewAi.arb.form.pool.none')));
/** 選「AI 對」而原決定是通過：仲裁不會改它，指向既有的重新審核入口 */
const reopenHint = (value: Arbitration | null) => value === 'ai_right' && data.value?.human.decision === 'approved';
const reopenTo = computed(() => (data.value ? lp(`/review/cards?q=${encodeURIComponent(data.value.submission.cardId)}`) : ''));

async function submit() {
  const d = data.value, value = choice.value;
  if (!d || !value || sending.value) return;
  const body = { value, addToReference: !!pool.value && addRef.value, note: note.value.trim() };
  const key = JSON.stringify(body);
  if (!pendingOp || pendingOp.key !== key) pendingOp = { key, id: crypto.randomUUID() };
  const target = id.value;
  sending.value = true; sendError.value = '';
  try {
    const res = await arbitrate(target, await token(), { ...body, operationId: pendingOp.id });
    if (!alive || target !== id.value) return;
    pendingOp = null;
    result.value = { value: res.value, referencePool: res.referencePool, note: body.note };
    d.arbitrations = [...d.arbitrations, { value: res.value, referencePool: res.referencePool, note: body.note, at: Date.now(), arbiter: null }];
    void loadNext();
  } catch (e) {
    if (!alive || target !== id.value) return;
    if (e instanceof ApiError && e.status === 403) forbidden.value = true;
    else if (e instanceof ApiError && e.code === 'disagreement_not_found') sendError.value = t('reviewAi.arb.form.notFound');
    else if (e instanceof ApiError && e.code === 'arbitration_operation_repeated') { pendingOp = null; sendError.value = t('reviewAi.arb.form.failed'); }
    else sendError.value = t('reviewAi.arb.form.failed');
  } finally {
    sending.value = false;
  }
}
async function loadNext() {
  try {
    const res = await fetchDisagreements(await token(), { state: 'open', limit: 1, offset: 0 });
    if (alive) next.value = { id: res.items.find((i) => i.suggestionId !== id.value)?.suggestionId ?? null, total: res.total };
  } catch { if (alive) next.value = null; }
}
function again() { result.value = null; choice.value = null; note.value = ''; addRef.value = false; sendError.value = ''; }
const history = computed(() => [...(data.value?.arbitrations ?? [])].reverse());
</script>

<template>
  <section class="ai-item" data-page="review-ai-item" :aria-label="t('reviewAi.arb.title')">
    <ReviewAiNav />
    <p v-if="denied || forbidden" class="notice notice--error" role="alert" data-forbidden>{{ t('state.forbidden') }}</p>
    <template v-else>
      <RouterLink class="btn btn--ghost btn--sm ai-item__back" :to="lp('/review/ai')">← {{ t('reviewAi.arb.back') }}</RouterLink>
      <div v-if="loadError" class="notice notice--error ai-item__row" role="alert" data-error>
        <span>{{ t(loadError === 'notFound' ? 'reviewAi.arb.detail.notFound' : 'reviewAi.arb.detail.loadFailed') }}</span>
        <button v-if="loadError === 'failed'" type="button" class="btn btn--sm" @click="load">{{ t('reviewAi.arb.retry') }}</button>
      </div>
      <div v-else-if="loading && !data" class="ai-tri" aria-busy="true" data-skeleton>
        <div v-for="n in 3" :key="n" class="ghost ai-item__ghost" />
      </div>

      <template v-if="data && !loadError">
        <header class="ai-item__head">
          <h2 class="ai-item__title">{{ name }}</h2>
          <span class="chip ai-tag ai-tag--warn" :data-direction="data.direction">{{ t(`reviewAi.arb.direction.${data.direction}`) }}</span>
        </header>

        <div class="ai-tri">
          <!-- 卡片 -->
          <section class="panel ai-col" data-col="card" aria-labelledby="ai-col-card">
            <h3 id="ai-col-card" class="ai-col__title">{{ t('reviewAi.arb.card') }}</h3>
            <p v-if="!card" class="notice" data-unavailable>{{ t('reviewAi.arb.content.unavailable') }}</p>
            <template v-else>
              <p v-if="card.tags.length || card.originalWork" class="ai-chips">
                <span v-if="card.originalWork" class="chip ai-tag">{{ t('reviewAi.arb.content.originalWork', { name: card.originalWork }) }}</span>
                <span v-for="tag in card.tags" :key="tag" class="chip ai-tag">{{ tag }}</span>
              </p>
              <div class="ai-field">
                <p class="ai-label">{{ t(card.openings.mode === 'page' ? 'reviewAi.arb.content.openingPage' : 'reviewAi.arb.content.opening') }}</p>
                <p class="ai-text" data-opening>{{ opening || t('reviewAi.arb.none') }}</p>
                <p v-if="card.openings.alternates.length" class="subtle ai-note">{{ t('reviewAi.arb.content.alternates', { n: card.openings.alternates.length }) }}</p>
              </div>
              <details class="ai-fold" :open="wide" data-fold="setting">
                <summary>{{ t('reviewAi.arb.content.setting') }}</summary>
                <p class="ai-text">{{ card.setting || t('reviewAi.arb.none') }}</p>
              </details>
              <details class="ai-fold" :open="wide" data-fold="lorebook">
                <summary>{{ t('reviewAi.arb.content.lorebook', { n: card.lorebook.entryCount }) }}</summary>
                <ul v-if="card.lorebook.entries.length" class="ai-entries">
                  <li v-for="(e, i) in card.lorebook.entries" :key="i"><strong>{{ e.name }}</strong><p class="ai-text">{{ e.content }}</p></li>
                </ul>
                <p v-else class="muted ai-note">{{ t('reviewAi.arb.none') }}</p>
              </details>
            </template>
            <div v-if="update" class="ai-field" data-update>
              <p class="ai-label">{{ update.state === 'ready' ? t('reviewAi.arb.update.ready', { n: update.fields.length, a: update.lorebook.added, r: update.lorebook.removed, m: update.lorebook.modified }) : t('reviewAi.arb.update.unavailable') }}</p>
              <template v-if="update.state === 'ready'">
                <details v-for="f in update.fields" :key="f.key" class="ai-fold" :data-update-field="f.key">
                  <summary>{{ fieldLabel(f.key) }}</summary>
                  <div class="ai-diff">
                    <p class="ai-label">{{ t('reviewAi.arb.update.before') }}</p>
                    <p class="ai-text">{{ f.before || t('reviewAi.arb.none') }}</p>
                    <p class="ai-label">{{ t('reviewAi.arb.update.after') }}</p>
                    <p class="ai-text">{{ f.after || t('reviewAi.arb.none') }}</p>
                  </div>
                </details>
              </template>
            </div>
            <p class="subtle ai-note">{{ t('reviewAi.arb.content.same') }}</p>
          </section>

          <!-- 人工 -->
          <section class="panel ai-col" data-col="human" aria-labelledby="ai-col-human">
            <h3 id="ai-col-human" class="ai-col__title">{{ t('reviewAi.arb.human') }}</h3>
            <p class="ai-chips">
              <span class="chip ai-tag" :class="data.human.decision === 'approved' ? 'ai-tag--pass' : 'ai-tag--reject'" data-human-decision>{{ t(`reviewAi.arb.decision.${data.human.decision}`) }}</span>
              <span v-if="data.human.at" class="subtle">{{ dateTime(data.human.at) }}</span>
            </p>
            <div class="ai-field">
              <p class="ai-label">{{ t('reviewAi.arb.reasons') }}</p>
              <p v-if="data.human.reasons.length" class="ai-chips"><span v-for="code in data.human.reasons" :key="code" class="chip ai-tag">{{ t(reasonKey(code, 'name')) }}</span></p>
              <p v-else class="muted ai-note">{{ t('reviewAi.arb.none') }}</p>
            </div>
            <div class="ai-field">
              <p class="ai-label">{{ t('reviewAi.arb.note') }}</p>
              <p class="ai-text">{{ data.human.note || t('reviewAi.arb.none') }}</p>
            </div>
            <div v-if="data.human.stamps.length" class="ai-field">
              <p class="ai-label">{{ t('reviewAi.arb.stamps') }}</p>
              <ul class="ai-lines">
                <li v-for="(s, i) in data.human.stamps" :key="i">{{ t('reviewAi.arb.stampLine', { who: s.reviewer || t('reviewAi.arb.unknownReviewer'), verdict: t(`review.action.${s.verdict}`), time: dateTime(s.at) }) }}</li>
              </ul>
            </div>
            <div class="ai-field" data-feedback>
              <p class="ai-label">{{ t('reviewAi.arb.feedback') }}</p>
              <ul v-if="data.human.feedback.length" class="ai-lines">
                <li v-for="(f, i) in data.human.feedback" :key="i">{{ t('reviewAi.arb.feedbackLine', { who: f.reviewer || t('reviewAi.arb.unknownReviewer'), value: t(`reviewAi.reveal.feedback.${f.value}`) }) }}</li>
              </ul>
              <p v-else class="muted ai-note">{{ t('reviewAi.arb.noFeedback') }}</p>
            </div>
          </section>

          <!-- AI -->
          <section class="panel ai-col" data-col="ai" aria-labelledby="ai-col-ai">
            <h3 id="ai-col-ai" class="ai-col__title">{{ t('reviewAi.arb.ai') }}</h3>
            <p class="ai-chips">
              <span class="chip ai-tag" :class="data.ai.verdict === 'pass' ? 'ai-tag--pass' : 'ai-tag--reject'" data-ai-verdict>{{ t(`reviewAi.arb.aiVerdict.${data.ai.verdict}`) }}</span>
              <span v-if="data.ai.confidence !== null" class="chip ai-tag ai-tag--num">{{ t('reviewAi.reveal.confidence', { pct: pct(data.ai.confidence) }) }}</span>
            </p>
            <div class="ai-field">
              <p class="ai-label">{{ t('reviewAi.arb.reasons') }}</p>
              <p v-if="data.ai.reasons.length" class="ai-chips"><span v-for="code in data.ai.reasons" :key="code" class="chip ai-tag">{{ t(reasonKey(code, 'name')) }}</span></p>
              <p v-else class="muted ai-note">{{ t('reviewAi.arb.none') }}</p>
            </div>
            <div v-if="data.ai.flags.length" class="ai-field">
              <p class="ai-label">{{ t('reviewAi.arb.flags') }}</p>
              <p class="ai-chips"><span v-for="f in data.ai.flags" :key="f" class="chip ai-tag">{{ t(`reviewAi.flag.${f}`) }}</span></p>
            </div>
            <div class="ai-field">
              <p class="ai-label">{{ t('reviewAi.arb.basis') }}</p>
              <p class="ai-text">{{ data.ai.note || t('reviewAi.arb.none') }}</p>
            </div>
            <p class="subtle ai-note" data-ai-meta>{{ t('reviewAi.arb.criteriaModel', { v: data.ai.criteriaVersion, model: data.ai.model }) }}</p>
          </section>
        </div>

        <!-- 仲裁 -->
        <section class="panel ai-form" aria-labelledby="ai-form-title" aria-live="polite" data-arbitration>
          <h3 id="ai-form-title" class="ai-col__title">{{ t(result ? 'reviewAi.arb.done.title' : 'reviewAi.arb.form.title') }}</h3>

          <template v-if="result">
            <p class="ai-chips" data-result>
              <span class="chip ai-tag ai-tag--strong">{{ t(`reviewAi.arb.value.${result.value}`) }}</span>
              <span v-if="result.referencePool" class="chip ai-tag" data-result-pool>{{ t(`reviewAi.arb.done.pool.${result.referencePool}`) }}</span>
            </p>
            <p v-if="result.note" class="ai-text">{{ t('reviewAi.arb.done.note', { note: result.note }) }}</p>
            <div v-if="reopenHint(result.value)" class="notice ai-item__row" role="note" data-reopen-hint>
              <span>{{ t('reviewAi.arb.form.reopenHint') }}</span>
              <RouterLink class="btn btn--sm" :to="reopenTo" data-reopen-link>{{ t('reviewAi.arb.form.reopenLink') }}</RouterLink>
            </div>
            <p class="subtle ai-note">{{ t('reviewAi.arb.done.rule') }}</p>
            <p v-if="next && !next.id" class="subtle ai-note" data-next-none>{{ t('reviewAi.arb.done.nextNone') }}</p>
            <div class="ai-form__acts">
              <button type="button" class="btn btn--lg" data-action="again" @click="again">{{ t('reviewAi.arb.done.again') }}</button>
              <RouterLink v-if="next?.id" class="btn btn--primary btn--lg" :to="lp(`/review/ai/${next.id}`)" data-next>{{ t('reviewAi.arb.done.next', { n: next.total }) }}</RouterLink>
              <RouterLink v-else class="btn btn--primary btn--lg" :to="lp('/review/ai')">{{ t('reviewAi.arb.back') }}</RouterLink>
            </div>
          </template>

          <template v-else>
            <p v-if="sendError" class="notice notice--error" role="alert" data-send-error>{{ sendError }}</p>
            <div class="ai-choices" role="radiogroup" aria-labelledby="ai-form-title">
              <label v-for="v in ARBITRATION_VALUES" :key="v" class="ai-choice" :class="{ 'ai-choice--on': choice === v }">
                <input v-model="choice" type="radio" name="ai-arbitration" :value="v" :disabled="sending" :data-value="v" />
                <span class="ai-choice__name">{{ t(`reviewAi.arb.value.${v}`) }}</span>
                <span class="ai-choice__hint">{{ t(`reviewAi.arb.valueHint.${v}`) }}</span>
              </label>
            </div>
            <div v-if="reopenHint(choice)" class="notice ai-item__row" role="note" data-reopen-hint>
              <span>{{ t('reviewAi.arb.form.reopenHint') }}</span>
              <RouterLink class="btn btn--sm" :to="reopenTo" data-reopen-link>{{ t('reviewAi.arb.form.reopenLink') }}</RouterLink>
            </div>
            <div class="field ai-form__field">
              <label for="ai-arb-note">{{ t('reviewAi.arb.form.noteLabel') }}</label>
              <textarea id="ai-arb-note" v-model="note" class="input" rows="3" :maxlength="NOTE_MAX" :placeholder="t('reviewAi.arb.form.notePlaceholder')" :disabled="sending" autocomplete="off" />
            </div>
            <label class="ai-check" :class="{ 'ai-check--off': !pool }">
              <input v-model="addRef" type="checkbox" :disabled="!pool || sending" data-reference aria-describedby="ai-arb-pool" />
              <span class="ai-check__text">
                <span class="ai-check__name">{{ t('reviewAi.arb.form.reference') }}</span>
                <span id="ai-arb-pool" class="subtle" data-pool-hint>{{ poolHint }}</span>
              </span>
            </label>
            <div class="ai-form__acts">
              <button type="button" class="btn btn--primary btn--lg ai-form__submit" :disabled="!choice || sending" data-action="submit" @click="submit">{{ sending ? t('reviewAi.arb.form.submitting') : t('reviewAi.arb.form.submit') }}</button>
            </div>
            <p class="subtle ai-note">{{ t('reviewAi.arb.form.footnote') }}</p>
          </template>

          <div v-if="history.length" class="ai-field" data-history>
            <p class="ai-label">{{ t('reviewAi.arb.history') }}</p>
            <ul class="ai-lines">
              <li v-for="(h, i) in history" :key="i">
                {{ t('reviewAi.arb.historyLine', { value: t(`reviewAi.arb.value.${h.value}`), who: h.arbiter || t('reviewAi.arb.you'), time: dateTime(h.at) }) }}<template v-if="h.referencePool"> · {{ t(`reviewAi.arb.done.pool.${h.referencePool}`) }}</template>
                <span v-if="h.note" class="ai-text ai-history__note">{{ h.note }}</span>
              </li>
            </ul>
          </div>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.ai-item { display: grid; gap: var(--s-4); min-width: 0; }
.ai-item__back { justify-self: start; padding-inline-start: 0; min-height: var(--h-md); }
.ai-item__row { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-3); align-items: center; margin: 0; overflow-wrap: anywhere; }
.ai-item__ghost { height: 240px; border-radius: var(--r-lg); }
.ai-item__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); }
.ai-item__title { margin: 0; font-size: clamp(18px, 2.4vw, 22px); overflow-wrap: anywhere; }
/* 手機直排；≥1080 三欄並排（卡片欄最寬） */
.ai-tri { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); align-items: start; }
@media (min-width: 1080px) { .ai-tri { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr); } }
.ai-col, .ai-form { padding: var(--s-4); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); min-width: 0; }
.ai-col__title { margin: 0; font-size: 15px; }
.ai-field { display: grid; gap: var(--s-1); min-width: 0; }
.ai-label { margin: 0; font-size: 12px; font-weight: 600; color: var(--text-3); }
.ai-chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); margin: 0; }
.ai-text { margin: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 14px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 360px; overflow-y: auto; }
.ai-note { margin: 0; overflow-wrap: anywhere; }
.ai-lines { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); font-size: 13px; overflow-wrap: anywhere; }
.ai-history__note { display: block; margin-top: var(--s-1); }
.ai-fold > summary { cursor: pointer; min-height: var(--h-sm); display: flex; align-items: center; font-size: 13px; font-weight: 600; color: var(--text-2); }
.ai-fold[open] > summary { margin-bottom: var(--s-2); }
.ai-diff { display: grid; gap: var(--s-1); }
.ai-entries { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); font-size: 13px; }
.ai-entries strong { display: block; margin-bottom: 2px; overflow-wrap: anywhere; }
.ai-tag { cursor: default; max-width: 100%; }
.ai-tag:hover { color: var(--text-2); background: var(--surface-2); }
.ai-tag--num { font-variant-numeric: tabular-nums; }
.ai-tag--strong, .ai-tag--strong:hover { color: var(--accent-text); background: var(--accent-tint); font-weight: 600; }
.ai-tag--pass, .ai-tag--pass:hover { color: var(--success); background: var(--success-soft); font-weight: 600; }
.ai-tag--reject, .ai-tag--reject:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, var(--surface)); font-weight: 600; }
.ai-tag--warn, .ai-tag--warn:hover { color: var(--warning-text); background: color-mix(in srgb, var(--warning-text) 12%, var(--surface)); font-weight: 600; }
.ai-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr)); gap: var(--s-2); min-width: 0; }
.ai-choice { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: var(--s-2); row-gap: 2px; align-items: center; min-width: 0; min-height: var(--h-lg); padding: var(--s-3); border: 1px solid var(--border); border-radius: var(--r-md); cursor: pointer; }
.ai-choice input { grid-row: span 2; width: 18px; height: 18px; margin: 0; }
.ai-choice--on { border-color: var(--accent); background: var(--accent-tint); }
.ai-choice__name { font-weight: 600; overflow-wrap: anywhere; }
.ai-choice__hint { font-size: 12px; color: var(--text-2); overflow-wrap: anywhere; }
.ai-form__field { margin-bottom: 0; }
.ai-check { display: flex; align-items: flex-start; gap: var(--s-2); min-height: var(--h-md); cursor: pointer; }
.ai-check input { flex: none; width: 18px; height: 18px; margin: 2px 0 0; }
.ai-check--off { cursor: not-allowed; }
.ai-check--off .ai-check__name { color: var(--text-3); }
.ai-check__text { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.ai-check__name { font-weight: 600; }
.ai-form__acts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--s-2); }
.ai-form__submit { min-width: 128px; }
.ai-choice__hint:lang(ko), .ai-note:lang(ko), .ai-check__text:lang(ko) { word-break: keep-all; }
@media (max-width: 760px) { .ai-choices { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px) { .ai-form__acts > .btn--lg { flex: 1 1 auto; } }
</style>
