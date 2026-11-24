<script setup lang="ts">
/**
 * 兩段式決定第二步的並排比較（ui-two-stage.md「揭曉」）：你的盲審判斷｜AI 的判斷，桌機兩欄、手機直排，
 * 下面以文字加符號標示「✓ 一致」「≠ 不一致」。
 *
 * AI 欄的狀態：loading（重新進來時讀取中）、error（讀不到）、pending（還沒審完：骨架＋已等多久）、
 * none（交人、拒答：只有你的判斷）、ready。
 * AI 欄分成兩塊：內部說明（信心與依據，虛線灰底、鎖頭「只有審核員看得到」）與給作者的說明（AI 的草稿，實線強調框、
 * 眼睛「作者會看到」）；結論與理由代碼在上。盲審欄不變。
 * AI 欄的內容在 aria-live 區裡：AI 審完自動換上時讀屏器會唸一次，不搶焦點；每秒跳的「已等 N 秒」放在區外，免得一直唸。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ReviewBlind } from "@/lib/api";
import type { AiSuggestion } from "@/lib/review-ai-api";
import { aiAsHuman, aiReasonCodes, type AiView } from "@/lib/review-ai";
import { reasonKey } from "@/lib/review-reasons";
import ReviewVisibility from "./ReviewVisibility.vue";

const props = defineProps<{ blind: ReviewBlind; view: AiView; suggestion: AiSuggestion | null; waited: number; busy?: boolean }>();
const emit = defineEmits<{ retry: [] }>();
const { t, locale } = useI18n();

const mine = computed(() => props.blind.payload);
const aiVerdict = computed(() => (props.view === "ready" && props.suggestion ? aiAsHuman(props.suggestion.verdict) : null));
const agree = computed(() => (aiVerdict.value ? aiVerdict.value === props.blind.verdict : null));
const aiReasons = computed(() => (props.suggestion && aiVerdict.value === "reject" ? aiReasonCodes(props.suggestion) : []));
const pct = (n: number) => new Intl.NumberFormat(String(locale.value), { style: "percent", maximumFractionDigits: 0 }).format(n);
const authorNote = computed(() => props.suggestion?.authorNote?.trim() ?? "");
const waitedText = computed(() => (props.waited < 60 ? t("reviewAi.two.pending.waitedSeconds", { n: props.waited }) : t("reviewAi.two.pending.waitedMinutes", { n: Math.floor(props.waited / 60) })));
</script>

<template>
  <div class="cmp" data-two-stage-compare>
    <div class="cmp__cols">
      <section class="cmp__col" aria-labelledby="cmp-mine" data-col="blind">
        <h4 id="cmp-mine" class="cmp__title">{{ t("reviewAi.two.mine") }}</h4>
        <p class="cmp__chips">
          <span class="chip cmp__chip" :class="blind.verdict === 'approve' ? 'cmp__chip--pass' : 'cmp__chip--reject'" :data-blind-verdict="blind.verdict">{{ t(`review.action.${blind.verdict}`) }}</span>
        </p>
        <ul v-if="blind.verdict === 'reject' && mine.reasons.length" class="cmp__chips cmp__list" data-blind-reasons>
          <li v-for="code in mine.reasons" :key="code" class="chip cmp__chip">{{ t(reasonKey(code, "name")) }}</li>
        </ul>
        <div v-if="blind.verdict === 'approve' && mine.suggestions.length" class="cmp__group">
          <p class="cmp__label">{{ t("reviewAi.two.mineSuggestions") }}</p>
          <ul class="cmp__chips cmp__list"><li v-for="code in mine.suggestions" :key="code" class="chip cmp__chip">{{ t(reasonKey(code, "name")) }}</li></ul>
        </div>
        <div v-if="mine.note" class="cmp__group">
          <p class="cmp__label">{{ t("reviewAi.two.mineNote") }}</p>
          <p class="cmp__text">{{ mine.note }}</p>
        </div>
      </section>

      <section class="cmp__col" aria-labelledby="cmp-ai" data-col="ai" :data-ai-view="view">
        <h4 id="cmp-ai" class="cmp__title">{{ t("reviewAi.two.ai") }}</h4>
        <div class="cmp__live" aria-live="polite" :aria-busy="view === 'loading' || view === 'pending' ? 'true' : undefined">
          <template v-if="view === 'loading'">
            <div class="ghost cmp__ghost" aria-hidden="true" />
          </template>
          <template v-else-if="view === 'error'">
            <p class="cmp__text cmp__text--plain">{{ t("reviewAi.reveal.loadFailed") }}</p>
            <button type="button" class="btn btn--sm cmp__retry" :disabled="busy" data-ai-retry @click="emit('retry')">{{ t("reviewAi.two.none.retry") }}</button>
          </template>
          <template v-else-if="view === 'pending'">
            <div class="ghost cmp__ghost" aria-hidden="true" />
            <p class="cmp__state" data-ai-pending>{{ t("reviewAi.two.pending.title") }}</p>
            <p class="subtle cmp__note">{{ t("reviewAi.two.pending.body") }}</p>
          </template>
          <template v-else-if="view === 'none'">
            <p class="cmp__state" data-ai-none>{{ t("reviewAi.two.none.title") }}</p>
            <p class="muted cmp__note">{{ t("reviewAi.two.none.body") }}</p>
            <button type="button" class="btn btn--sm cmp__retry" :disabled="busy" data-ai-retry @click="emit('retry')">{{ t("reviewAi.two.none.retry") }}</button>
          </template>
          <template v-else-if="suggestion">
            <p class="cmp__chips">
              <span class="chip cmp__chip" :class="suggestion.verdict === 'pass' ? 'cmp__chip--pass' : 'cmp__chip--reject'" :data-ai-verdict="suggestion.verdict">{{ t(`reviewAi.reveal.verdict.${suggestion.verdict}`) }}</span>
            </p>
            <ul v-if="aiReasons.length" class="cmp__chips cmp__list" data-ai-reasons>
              <li v-for="code in aiReasons" :key="code" class="chip cmp__chip">{{ t(reasonKey(code, "name")) }}</li>
            </ul>
            <!-- 揭曉區分欄：誰看得到要一眼分得出（符號＋文字＋框線樣式，不單靠顏色） -->
            <section v-if="suggestion.confidence !== null || suggestion.note" class="cmp__block cmp__block--internal" aria-labelledby="cmp-ai-internal" data-ai-internal>
              <div class="cmp__block-head">
                <h5 id="cmp-ai-internal" class="cmp__block-title">{{ t("reviewAi.two.internalNote.title") }}</h5>
                <ReviewVisibility who="reviewers" />
              </div>
              <p v-if="suggestion.confidence !== null" class="cmp__chips">
                <span class="chip cmp__chip cmp__chip--num" data-ai-confidence>{{ t("reviewAi.reveal.confidence", { pct: pct(suggestion.confidence) }) }}</span>
              </p>
              <p v-if="suggestion.note" class="cmp__text" data-ai-internal-note>{{ suggestion.note }}</p>
            </section>
            <section class="cmp__block cmp__block--author" aria-labelledby="cmp-ai-author" data-ai-author-note>
              <div class="cmp__block-head">
                <h5 id="cmp-ai-author" class="cmp__block-title">{{ t("reviewAi.two.authorNote.title") }}</h5>
                <ReviewVisibility who="author" />
              </div>
              <p v-if="authorNote" class="cmp__text" data-ai-author-note-text>{{ authorNote }}</p>
              <p v-else class="muted cmp__note" data-ai-author-note-empty>{{ t("reviewAi.two.authorNote.empty") }}</p>
            </section>
          </template>
        </div>
        <p v-if="view === 'pending'" class="subtle cmp__note cmp__waited" data-ai-waited>{{ waitedText }}</p>
      </section>
    </div>
    <p v-if="agree !== null" class="cmp__chips" role="status">
      <span class="chip cmp__chip" :class="agree ? 'cmp__chip--pass' : 'cmp__chip--differ'" :data-agree="agree ? 'same' : 'differ'">{{ agree ? t("reviewAi.two.agree") : t(blind.verdict === "approve" ? "reviewAi.two.differ.approveReject" : "reviewAi.two.differ.rejectApprove") }}</span>
    </p>
  </div>
</template>

<style scoped>
.cmp { display: grid; gap: var(--s-3); min-width: 0; }
/* 桌機兩欄、手機直排（與審核詳情的分欄同一個 760 斷點） */
.cmp__cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); align-items: start; }
@media (min-width: 761px) { .cmp__cols { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.cmp__col { display: grid; gap: var(--s-2); min-width: 0; padding: var(--s-3); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); }
.cmp__live { display: grid; gap: var(--s-2); min-width: 0; }
.cmp__title { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-2); }
.cmp__group { display: grid; gap: var(--s-1); min-width: 0; }
.cmp__label { margin: 0; font-size: 12px; font-weight: 600; color: var(--text-3); }
.cmp__chips { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: 0; padding: 0; }
.cmp__list { list-style: none; }
.cmp__text { margin: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow-y: auto; }
.cmp__text--plain { padding: 0; background: none; }
.cmp__state { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.cmp__note { margin: 0; overflow-wrap: anywhere; }
.cmp__ghost { height: 64px; border-radius: var(--r-md); }
.cmp__retry { justify-self: start; }
/* 內部說明：虛線、灰底（中性）；給作者的說明：實線強調框。圓角比欄位小一階 */
.cmp__block { display: grid; gap: var(--s-2); min-width: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); }
.cmp__block--internal { border: 1px dashed var(--border-strong); background: var(--surface-2); }
.cmp__block--author { border: 1px solid var(--accent); background: var(--surface); }
.cmp__block-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-1) var(--s-2); min-width: 0; }
.cmp__block-title { margin: 0; font-size: 13px; font-weight: 600; color: var(--text); }
/* 灰底區塊裡的文字框換回卡面底，才分得出層次 */
.cmp__block--internal .cmp__text { background: var(--surface); }
.cmp__waited { font-variant-numeric: tabular-nums; }
/* 只是標示，不能點：拿掉 .chip 的 hover 與手指游標 */
.cmp__chip { cursor: default; max-width: 100%; }
.cmp__chip:hover { color: var(--text-2); background: var(--surface-2); }
.cmp__chip--num { font-variant-numeric: tabular-nums; }
.cmp__chip--pass, .cmp__chip--pass:hover { color: var(--success); background: var(--success-soft); font-weight: 600; }
.cmp__chip--reject, .cmp__chip--reject:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, var(--surface)); font-weight: 600; }
.cmp__chip--differ, .cmp__chip--differ:hover { color: var(--warning-text); background: color-mix(in srgb, var(--warning-text) 12%, var(--surface)); font-weight: 600; }
.cmp__note:lang(ko), .cmp__state:lang(ko) { word-break: keep-all; }
</style>
