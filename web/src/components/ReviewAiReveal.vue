<script setup lang="ts">
/**
 * 審核詳情頁「不受理」結果卡下方的「AI 的判斷」（ui-reveal.md）。通過與駁回改走兩段式決定（ReviewTwoStageCompare），
 * 定案前就並排比過，不再掛這個元件。
 *
 * 雙盲：父層只在這位審核員剛不受理之後才掛上這個元件，掛上才去讀；決定前畫面上沒有任何痕跡，也不發請求。
 * 伺服器同樣擋（403 ai_hidden_until_decided）：收到 403 就什麼都不畫。
 *
 * 多個判準版本時揭曉最新版本；只有結論不同才有覆核（三選一、不預選）。覆核可以改選，每次送出都是新的 operationId，
 * 伺服器記一筆事件、取最後一筆。覆核不改決定，也不影響作者看到的結果。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/lib/api';
import { AI_FEEDBACK_VALUES, fetchReviewAi, sendAiFeedback, type AiFeedback, type AiReveal } from '@/lib/review-ai-api';
import { agrees, compareReasons, latestSuggestion, type MyDecision } from '@/lib/review-ai';
import { reasonKey } from '@/lib/review-reasons';
import { useSession } from '@/lib/session';

const props = defineProps<{ submissionId: string; mine: MyDecision; myReasons: readonly string[] }>();
const { t, locale } = useI18n();
const session = useSession();

const data = ref<AiReveal | null>(null);
const loading = ref(true);
const failed = ref(false);
/** 伺服器說還不能看：整個面板不出現 */
const hidden = ref(false);
let alive = true;
onBeforeUnmount(() => { alive = false; });

async function token() {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}
async function load() {
  loading.value = true; failed.value = false;
  try {
    const res = await fetchReviewAi(props.submissionId, await token());
    if (!alive) return;
    data.value = res;
  } catch (e) {
    if (!alive) return;
    if (e instanceof ApiError && e.status === 403) hidden.value = true;
    else failed.value = true;
  } finally {
    if (alive) loading.value = false;
  }
}
onMounted(load);

const suggestion = computed(() => (data.value ? latestSuggestion(data.value.suggestions) : null));
const agree = computed(() => (suggestion.value ? agrees(props.mine, suggestion.value.verdict) : null));
const pct = (n: number) => new Intl.NumberFormat(String(locale.value), { style: 'percent', maximumFractionDigits: 0 }).format(n);
/** 雙方都駁回時才比理由；不受理沒有理由，不比 */
const comparison = computed(() => {
  const s = suggestion.value;
  if (!s || agree.value !== true || s.verdict !== 'reject' || props.mine !== 'reject' || !props.myReasons.length) return [];
  return compareReasons(props.myReasons, s.reasons);
});

// ---- 覆核 ----
const recorded = computed<AiFeedback | null>(() => data.value?.myFeedback.find((f) => f.suggestionId === suggestion.value?.id)?.value ?? null);
const editing = ref(false);
const pick = ref<AiFeedback | null>(null);
const sending = ref(false);
const sendFailed = ref(false);
const showForm = computed(() => agree.value === false && (!recorded.value || editing.value));
function change() { pick.value = recorded.value; editing.value = true; sendFailed.value = false; }
function keep() { editing.value = false; pick.value = null; sendFailed.value = false; }
async function submit() {
  const s = suggestion.value, value = pick.value;
  if (!s || !value || sending.value || !data.value) return;
  sending.value = true; sendFailed.value = false;
  try {
    const res = await sendAiFeedback(props.submissionId, await token(), { suggestionId: s.id, value, operationId: crypto.randomUUID() });
    if (!alive || !data.value) return;
    data.value.myFeedback = [...data.value.myFeedback.filter((f) => f.suggestionId !== s.id), { suggestionId: s.id, value: res.value }];
    editing.value = false; pick.value = null;
  } catch {
    if (alive) sendFailed.value = true;
  } finally {
    if (alive) sending.value = false;
  }
}
</script>

<template>
  <section v-if="!hidden" class="panel ai-reveal" aria-live="polite" :aria-busy="loading ? 'true' : undefined" data-ai-reveal>
    <h3 class="ai-reveal__title">{{ t('reviewAi.reveal.title') }}</h3>

    <div v-if="loading" class="ghost ai-reveal__ghost" aria-hidden="true" data-ai-skeleton />
    <div v-else-if="failed" class="notice notice--error ai-reveal__row" role="alert" data-ai-error>
      <span>{{ t('reviewAi.reveal.loadFailed') }}</span>
      <button type="button" class="btn btn--sm" data-ai-retry @click="load">{{ t('reviewAi.reveal.retry') }}</button>
    </div>
    <p v-else-if="!suggestion" class="muted ai-reveal__text" data-ai-none>{{ t('reviewAi.reveal.none') }}</p>

    <template v-else-if="suggestion.verdict === 'handoff'">
      <p class="ai-reveal__chips"><span class="chip ai-chip" data-ai-handoff>{{ t('reviewAi.reveal.handoff') }}</span></p>
      <p class="muted ai-reveal__text">{{ t('reviewAi.reveal.handoffBody') }}</p>
    </template>

    <template v-else>
      <p class="ai-reveal__chips">
        <span class="chip ai-chip" :class="suggestion.verdict === 'pass' ? 'ai-chip--pass' : 'ai-chip--reject'" :data-ai-verdict="suggestion.verdict">{{ t(`reviewAi.reveal.verdict.${suggestion.verdict}`) }}</span>
        <span v-if="suggestion.confidence !== null" class="chip ai-chip ai-chip--num" data-ai-confidence>{{ t('reviewAi.reveal.confidence', { pct: pct(suggestion.confidence) }) }}</span>
        <span class="chip ai-chip" :class="agree ? 'ai-chip--pass' : 'ai-chip--differ'" :data-ai-agree="agree ? 'same' : 'differ'">{{ t(agree ? 'reviewAi.reveal.agree' : 'reviewAi.reveal.differ') }}</span>
      </p>

      <div v-if="suggestion.verdict === 'reject' && suggestion.reasons.length" class="ai-reveal__group" data-ai-reasons>
        <p class="ai-reveal__label">{{ t('reviewAi.reveal.aiReasons') }}</p>
        <ul class="ai-reveal__list">
          <li v-for="code in suggestion.reasons" :key="code" class="chip ai-chip">{{ t(reasonKey(code, 'name')) }}</li>
        </ul>
      </div>

      <div v-if="comparison.length" class="ai-reveal__group" data-ai-compare>
        <p class="ai-reveal__label">{{ t('reviewAi.reveal.compare.title') }}</p>
        <ul class="ai-reveal__compare">
          <li v-for="row in comparison" :key="row.code" :data-ai-side="row.side">
            <span class="chip ai-chip">{{ t(`reviewAi.reveal.compare.${row.side}`) }}</span>
            <span>{{ t(reasonKey(row.code, 'name')) }}</span>
          </li>
        </ul>
      </div>

      <template v-if="agree === false">
        <div v-if="showForm" class="ai-reveal__group" data-ai-feedback>
          <p :id="`ai-fb-${submissionId}`" class="ai-reveal__label">{{ t('reviewAi.reveal.feedback.title') }}</p>
          <div class="ai-choices" role="radiogroup" :aria-labelledby="`ai-fb-${submissionId}`">
            <label v-for="v in AI_FEEDBACK_VALUES" :key="v" class="ai-choice" :class="{ 'ai-choice--on': pick === v }">
              <input v-model="pick" type="radio" :name="`ai-fb-${submissionId}`" :value="v" :disabled="sending" :data-ai-option="v" />
              <span class="ai-choice__name">{{ t(`reviewAi.reveal.feedback.${v}`) }}</span>
            </label>
          </div>
          <p v-if="sendFailed" class="notice notice--error" role="alert" data-ai-send-error>{{ t('reviewAi.reveal.feedback.failed') }}</p>
          <div class="ai-reveal__acts">
            <button v-if="editing" type="button" class="btn btn--ghost" :disabled="sending" data-ai-keep @click="keep">{{ t('reviewAi.reveal.feedback.keep') }}</button>
            <button type="button" class="btn btn--lg ai-reveal__submit" :disabled="!pick || sending" data-ai-submit @click="submit">{{ sending ? t('reviewAi.reveal.feedback.submitting') : t('reviewAi.reveal.feedback.submit') }}</button>
          </div>
        </div>
        <div v-else class="notice ai-reveal__row" role="status" data-ai-recorded>
          <span>{{ t('reviewAi.reveal.feedback.recorded', { value: t(`reviewAi.reveal.feedback.${recorded}`) }) }}</span>
          <button type="button" class="btn btn--sm btn--ghost" data-ai-change @click="change">{{ t('reviewAi.reveal.feedback.change') }}</button>
        </div>
        <p class="subtle ai-reveal__text">{{ t('reviewAi.reveal.feedback.note') }}</p>
      </template>

      <p class="subtle ai-reveal__text" data-ai-footnote>{{ t('reviewAi.reveal.footnote') }}</p>
    </template>
  </section>
</template>

<style scoped>
.ai-reveal { padding: var(--s-4); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); margin-top: var(--s-4); min-width: 0; }
.ai-reveal__title { margin: 0; font-size: 16px; }
.ai-reveal__ghost { height: 96px; border-radius: var(--r-md); }
.ai-reveal__text { margin: 0; overflow-wrap: anywhere; }
.ai-reveal__row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); margin: 0; overflow-wrap: anywhere; }
.ai-reveal__chips, .ai-reveal__list { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: 0; padding: 0; list-style: none; }
.ai-reveal__group { display: grid; gap: var(--s-2); min-width: 0; }
.ai-reveal__label { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-2); overflow-wrap: anywhere; }
.ai-reveal__compare { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.ai-reveal__compare li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); font-size: 14px; overflow-wrap: anywhere; }
.ai-reveal__acts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--s-2); }
.ai-reveal__submit { min-width: 112px; }
/* 只是標示，不能點：拿掉 .chip 的 hover 與手指游標 */
.ai-chip { cursor: default; max-width: 100%; }
.ai-chip:hover { color: var(--text-2); background: var(--surface-2); }
.ai-chip--num { font-variant-numeric: tabular-nums; }
.ai-chip--pass, .ai-chip--pass:hover { color: var(--success); background: var(--success-soft); font-weight: 600; }
.ai-chip--reject, .ai-chip--reject:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, var(--surface)); font-weight: 600; }
.ai-chip--differ, .ai-chip--differ:hover { color: var(--warning-text); background: color-mix(in srgb, var(--warning-text) 12%, var(--surface)); font-weight: 600; }
/* 送出覆核用一般按鈕：結果卡的「下一張待審」才是這一屏的主行動 */
/* 覆核三選項：手機直排、桌機橫排；選中用 accent 淡底（實心留給主按鈕） */
.ai-choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-2); min-width: 0; }
@media (max-width: 760px) { .ai-choices { grid-template-columns: minmax(0, 1fr); } }
.ai-choice { display: flex; align-items: center; gap: var(--s-2); min-width: 0; min-height: var(--h-lg); padding: var(--s-2) var(--s-3); border: 1px solid var(--border); border-radius: var(--r-md); cursor: pointer; }
.ai-choice input { flex: none; width: 18px; height: 18px; margin: 0; }
.ai-choice--on { border-color: var(--accent); background: var(--accent-tint); }
.ai-choice__name { font-weight: 600; overflow-wrap: anywhere; }
.ai-choice__name:lang(ko), .ai-reveal__text:lang(ko), .ai-reveal__label:lang(ko) { word-break: keep-all; }
.ai-reveal__text:lang(ja), .ai-reveal__label:lang(ja) { word-break: auto-phrase; }
@media (max-width: 600px) { .ai-reveal__acts > .btn--lg { flex: 1 1 auto; } }
</style>
