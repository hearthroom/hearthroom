<script setup lang="ts">
import CoverSensitiveBadge from "@/components/CoverSensitiveBadge.vue";
import { stageAvailable } from "@stage-site";
/**
 * /review — 社群審核的共享佇列。
 *
 * 誰想審就自己領；領了就是「我正在看」，逾時自動放回。這裡只列狀態與入口，
 * 看設定、蓋章在 ReviewDetailPage。清單不列作者，作者在審核頁看。
 *
 * 每列標出送審類型（首次送審／更新／退回後再送／重新審核，由伺服器依上次結果判定）與第幾次送審；
 * 重新審核不標次數（審的是已發布的那一版，作者送了幾次跟這次無關）。
 *
 * 冷凍並討論的卡照樣列著，標出冷凍人；領了只能看、不能決定。冷凍人自己在這裡就能解凍
 * （管理員解別人的冷凍要寫理由，在審核頁做）。
 *
 * 領取與開始審是同一顆按鈕（2026-11-02 體檢 R1）：以前領取不導頁、「查看」又隨時可按，
 * 太早點就撞進「請先領取」。現在只有領成功才進詳情；領取送出中這一列的按鈕都不能按。
 */
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, claimReview, dropReview, fetchReviewQueue, releaseReview, restoreReview, unholdReview, type ReviewBatchGroup, type ReviewQueueCounts, type ReviewQueueItem } from "@/lib/api";
import { submissionTypeKey, submissionTypeOf } from "@/lib/review-type";
import { localDate, monthDay, relativeTime } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { useReviewer } from "@/lib/review";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { zoneLabel } from "@/lib/i18n";
import RatingMark from "@/components/RatingMark.vue";
import ReviewListTabs from "@/components/ReviewListTabs.vue";
import ReviewRowMenu from "@/components/ReviewRowMenu.vue";
import ReviewBatchSheet from "@/components/ReviewBatchSheet.vue";
import ActionToast from "@/components/ActionToast.vue";
import { diffSummaryChips } from "@/components/ReviewDiffView.vue";

const { t, locale } = useI18n();
const { lp } = useLocalePath();
const session = useSession();
const reviewerStore = useReviewer();
const router = useRouter();
const route = useRoute();
/** 新卡／更新兩頁共用這個元件：/review 是新卡，/review/updates 是更新（含駁回後重送、重新審核） */
const tab = computed<"new" | "updates">(() => (route.meta.reviewTab === "updates" ? "updates" : "new"));
const counts = ref<ReviewQueueCounts | null>(null);
const batchGroups = ref<ReviewBatchGroup[]>([]);
const batchOpen = ref<ReviewBatchGroup | null>(null);
const batchCount = computed(() => batchGroups.value.reduce((n, g) => n + g.count, 0));
/** 不受理後的復原提示（ActionToast：滑過或聚焦時暫停，可以 Tab 到）*/
const toast = ref<{ id: number; text: string; label?: string; action?: () => void } | null>(null);
let toastSeq = 0;

const items = ref<ReviewQueueItem[]>([]);
const loading = ref(true);
const error = ref("");
const busy = ref<string | null>(null);
const forbidden = ref(false);
/** 某一列領取失敗的說明：留在清單上那一列，不導頁 */
const rowError = ref<{ id: string; text: string } | null>(null);
const numbers = computed(() => new Intl.NumberFormat(String(locale.value)));
const lengthChip = (item: ReviewQueueItem) => {
  if(item.lengthExempt)return {short:false,text:t('lengthExemption.enabled')};
  const l = item.reviewLength;
  if (!l) return null;
  const params = { total: numbers.value.format(l.total), gap: numbers.value.format(l.remaining) };
  return { short: !l.eligible, text: t(l.eligible ? "review.queue.length.ok" : "review.queue.length.short", params) };
};

/**
 * 更新列的改動摘要（審卡 V2 第二批）：不進詳情就知道這次改了什麼，字跟詳情的摘要 chip 同一份。
 * 還沒算好（pending）或不是更新單就不寫；沒有基準或讀不到寫「無法比較」。
 */
const diffLine = (item: ReviewQueueItem): string => {
  const d = item.diff;
  if (!d) return "";
  if (d.state === "no_base" || d.state === "unreadable") return t("reviewV2.diff.queue.uncomparable");
  const s = d.state === "done" ? d.summary : null;
  if (!s) return "";
  if (s.unchanged) return t("reviewV2.diff.queue.unchanged");
  const fmt = (v: number) => numbers.value.format(v);
  const chips = diffSummaryChips(s, t, fmt);
  return chips.length ? chips.join(" · ") : typeof s.totalChanged === "number" ? t("reviewV2.diff.total", { n: fmt(s.totalChanged) }, s.totalChanged) : "";
};

/** 自己領著的永遠列在最上面，免得忘了手上還有一張 */
const mine = computed(() => items.value.filter((i) => i.claim === "mine"));
const others = computed(() => items.value.filter((i) => i.claim !== "mine"));

async function load() {
  error.value = "";
  loading.value = !items.value.length;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const result = await fetchReviewQueue(token, String(locale.value), tab.value);
    items.value = result.items;
    counts.value = result.counts ?? null;
    batchGroups.value = result.batchGroups ?? [];
    forbidden.value = false;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) forbidden.value = true;
    else error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function claim(item: ReviewQueueItem) {
  if (!stageAvailable || busy.value) return;
  busy.value = item.id;
  error.value = "";
  rowError.value = null;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const claimed = await claimReview(item.id, token);
    item.claimGeneration = claimed.generation;
    item.claim = "mine";
    void reviewerStore.refresh();
    await router.push(lp(`/review/${item.id}`));
  } catch (err) {
    if (err instanceof ApiError && (err.code === "review_withdrawal_pending" || err.code === "review_author_withdrawn")) {
      await router.push(lp(`/review/${item.id}`));
      return;
    }
    // 被別人先領走：這一列改成「有人在看」並說明；其他失敗只說沒領成，按鈕照樣可以再按
    const taken = err instanceof ApiError && err.status === 409 && err.code !== "you already reviewed this submission";
    const text = taken ? t("review.claim.taken")
      : err instanceof ApiError && err.code === "age_verification_required" ? t("error.ageVerificationRequired")
      : err instanceof Error && err.message === t("auth.expired") ? err.message
      : t("review.claim.failed");
    rowError.value = { id: item.id, text };
    if (taken) item.claim = "other";
    if (err instanceof ApiError && err.status === 409) void load();
  } finally {
    busy.value = null;
  }
}

async function unhold(item: ReviewQueueItem) {
  if (busy.value) return;
  busy.value = item.id;
  rowError.value = null;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    await unholdReview(item.id, token);
    item.hold = null;
  } catch (err) {
    rowError.value = { id: item.id, text: err instanceof Error && err.message === t("auth.expired") ? err.message : t("review.hold.unholdFailed") };
    if (err instanceof ApiError && err.status === 409) void load();
  } finally {
    busy.value = null;
  }
}

async function release(item: ReviewQueueItem) {
  busy.value = item.id;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    await releaseReview(item.id, token,item.claimGeneration);
    item.claim = "free";
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = null;
  }
}

/** 不受理：不必領取、不跳確認，一步完成；底部提示可以復原 */
async function drop(item: ReviewQueueItem) {
  if (busy.value) return;
  busy.value = item.id;
  rowError.value = null;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    await dropReview(item.id, token);
    items.value = items.value.filter((i) => i.id !== item.id);
    if (counts.value) counts.value = { ...counts.value, [tab.value]: Math.max(0, counts.value[tab.value] - 1), dropped: counts.value.dropped + 1 };
    showToast(t("reviewV2.toast.dropped", { card: item.card.name }), t("reviewV2.toast.undo"), () => void undo(item));
    void reviewerStore.refresh();
  } catch (err) {
    rowError.value = { id: item.id, text: err instanceof Error && err.message === t("auth.expired") ? err.message : err instanceof ApiError && err.code === "claimed_by_other" ? t("reviewV2.menu.claimedByOther") : err instanceof ApiError && err.code === "review_held" ? t("reviewV2.menu.held") : t("reviewV2.toast.failed") };
    if (err instanceof ApiError && err.status === 409) void load();
  } finally {
    busy.value = null;
  }
}

async function undo(item: ReviewQueueItem) {
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    await restoreReview(item.id, token);
    showToast(t("reviewV2.toast.restored", { card: item.card.name }));
    void load();
    void reviewerStore.refresh();
  } catch {
    showToast(t("reviewV2.toast.failed"));
  }
}

function showToast(text: string, label?: string, action?: () => void) { toast.value = { id: ++toastSeq, text, label, action }; }
function batchClosed(changed: boolean) { batchOpen.value = null; if (changed) void load(); }
watch(tab, () => { items.value = []; void load(); });

onMounted(() => {
  document.title = pageTitle(t("review.title"));
  void reviewerStore.refresh();
  void load();
});
</script>

<template>
  <section class="review-queue">
    <header class="head">
      <ReviewListTabs :active="tab" :counts="counts" />
      <button class="btn btn--sm" :disabled="loading" @click="load">{{ $t("review.refresh") }}</button>
    </header>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <!-- 疑似大量送審（只有管理員收得到）：一次處理一組，處理完下一組補上 -->
    <div v-if="batchGroups.length" class="notice batch-banner" data-batch-banner>
      <span>{{ $t("reviewV2.batch.banner", { groups: batchGroups.length, n: batchCount }) }}</span>
      <button class="btn btn--sm" @click="batchOpen = batchGroups[0]">{{ $t("reviewV2.batch.view") }}</button>
    </div>

    <div v-if="forbidden" class="empty panel"><p class="empty__title">{{ $t("review.notReviewer") }}</p></div>
    <div v-else-if="loading" class="list" aria-hidden="true"><div v-for="i in 4" :key="i" class="ghost row-ghost" /></div>
    <!-- 讀不到就只說讀不到：沒載入成功的清單不能說成「沒有待審的卡」 -->
    <template v-else-if="!items.length">
      <div v-if="!error" class="empty panel">
        <p class="empty__title">{{ $t("review.empty") }}</p>
        <p class="subtle">{{ $t("review.emptyHint") }}</p>
        <p v-if="counts?.dropped"><RouterLink class="link" :to="lp('/review/dropped')">{{ $t("reviewV2.tabs.dropped", { n: counts.dropped }) }}</RouterLink></p>
      </div>
    </template>

    <template v-else>
      <ul v-for="(group, gi) in [mine, others]" :key="gi" class="list">
        <li v-for="item in group" :key="item.id" class="row panel" :class="{ 'row--mine': item.claim === 'mine' }" :data-review-row="item.id">
          <div class="row__art">
            <img v-if="item.card.avatarUrl" :src="item.card.avatarUrl" alt="" loading="lazy" />
            <div v-else class="row__void" />
            <CoverSensitiveBadge v-if="item.card.avatarUrl && item.card.coverSensitive" />
          </div>
          <div class="row__body">
            <div class="row__top">
              <span class="row__name">{{ item.card.name }}</span>
              <span v-if="item.flip" class="chip chip--flip" data-flip-chip>{{ $t("review.flipApprove.chip") }}</span>
              <span class="chip" :class="{ 'chip--re': submissionTypeOf(item) !== 'first' }" data-type-chip :data-reopen-chip="submissionTypeOf(item) === 'reopen' ? '' : undefined">{{ $t(submissionTypeKey(submissionTypeOf(item))) }}</span>
              <span v-if="submissionTypeOf(item) !== 'reopen' && (item.attempt ?? 1) >= 2" class="chip chip--attempt" data-attempt>{{ $t("review.attempt", { n: item.attempt }) }}</span>
              <span v-if="lengthChip(item)" class="chip chip--length" :class="{ 'chip--short': lengthChip(item)!.short }" data-length-chip>{{ lengthChip(item)!.text }}</span>
              <!-- 世界書條目與正規表示式規則（全部，含停用）：挑卡前先知道要讀多少；不知道就不標，0 照標 -->
              <span v-if="typeof item.worldbookEntries === 'number'" class="chip chip--count" data-worldbook-chip>{{ $t("review.queue.worldbook", { n: numbers.format(item.worldbookEntries) }) }}</span>
              <span v-if="typeof item.regexRules === 'number'" class="chip chip--count" data-regex-chip>{{ $t("review.queue.regex", { n: numbers.format(item.regexRules) }) }}</span>
              <span v-if="item.stampedByMe" class="chip">{{ $t("review.queue.reviewed") }}</span>
              <RatingMark v-if="item.rating" :rating="item.rating" variant="chip" />
              <span v-if="item.hold" class="chip chip--hold" data-hold-chip>{{ $t("review.hold.chip") }}</span>
              <span v-if="item.fast" class="chip chip--fast" data-fast-chip>{{ $t("reviewV2.fast.chip") }}</span>
              <span v-if="item.afterDrop" class="chip" data-after-drop>{{ $t("reviewV2.queue.afterDrop") }}</span>
              <!-- 作者標記：只放標記與計數，不放身分 -->
              <span v-if="item.authorMark && item.authorMark.tier !== 'general'" class="chip chip--mark" data-author-mark>{{ $t(`reviewV2.mark.tier.${item.authorMark.tier}`) }}</span>
              <span v-if="item.authorMark?.batchSuspected" class="chip chip--batch" data-batch-flag>{{ $t("reviewV2.mark.batch") }}<template v-if="item.authorMark.deviceAccounts"> · {{ $t("reviewV2.mark.deviceAccounts", { n: item.authorMark.deviceAccounts }, item.authorMark.deviceAccounts) }}</template></span>
            </div>
            <p class="row__hook">{{ item.card.summary }}</p>
            <p v-if="diffLine(item)" class="row__diff" data-diff-summary>{{ diffLine(item) }}</p>
            <p class="row__meta">{{ zoneLabel(item.card.zone) }} · {{ relativeTime(item.submittedAt) }}</p>
            <!-- 改判單：誰發起、何時、原本哪天駁回（ui-flip-approve.md）；只有發起人能處理，別人看到有人在看 -->
            <p v-if="item.flip" class="row__meta" data-flip-by>{{ $t("review.flipApprove.queueSubline", { name: item.flip.by, time: relativeTime(item.flip.at), rejectedAt: item.flip.rejectedAt ? monthDay(localDate(item.flip.rejectedAt)) : "—" }) }}</p>
            <p v-if="item.hold" class="row__meta row__hold" data-hold-by>{{ item.hold.byMe ? $t("review.hold.byMe") : $t("review.hold.by", { name: item.hold.holder || $t("review.hold.someone") }) }} · {{ relativeTime(item.hold.at) }}</p>
            <p v-if="rowError?.id === item.id" class="notice notice--error row__error" role="alert">{{ rowError.text }}</p>
          </div>
          <div class="row__acts">
            <template v-if="item.claim === 'mine'">
              <RouterLink v-if="stageAvailable" class="btn btn--primary row__main" :to="lp(`/review/${item.id}`)">{{ $t("review.action.continue") }}</RouterLink>
              <button class="btn btn--ghost row__minor" :disabled="busy === item.id" @click="release(item)">{{ $t("review.action.release") }}</button>
            </template>
            <RouterLink v-else-if="stageAvailable && item.stampedByMe" class="btn row__main" :to="lp(`/review/${item.id}`)">{{ $t("review.action.open") }}</RouterLink>
            <button v-else-if="item.claim === 'other'" class="btn row__main" disabled>{{ $t("review.claim.other") }}</button>
            <button v-else-if="stageAvailable" class="btn btn--primary row__main" :disabled="!!busy" :aria-busy="busy === item.id" @click="claim(item)">
              {{ busy === item.id ? $t("review.action.claiming") : $t(item.hold ? "review.action.claimHeld" : "review.action.claim") }}
            </button>
            <!-- 冷凍人自己解凍；管理員解別人的要寫理由，在審核頁 -->
            <button v-if="item.hold?.byMe" class="btn btn--ghost row__minor" :disabled="!!busy" data-unhold @click="unhold(item)">{{ $t("review.action.unhold") }}</button>
          </div>
          <!-- 重新審核單不是作者送的，不能不受理 -->
          <ReviewRowMenu v-if="!item.reopen && !item.flip" class="row__menu" :name="item.card.name" :busy="busy === item.id"
            :blocked="item.claim === 'other' ? 'claimed' : item.hold ? 'held' : null" @drop="drop(item)" />
        </li>
      </ul>
    </template>
    <ReviewBatchSheet v-if="batchOpen" :anchor-id="batchOpen.anchorId" :scope="batchOpen.scope" @close="batchClosed" />
    <ActionToast v-if="toast" :key="toast.id" :message="toast.text" :action-label="toast.label" @action="toast?.action?.(); toast = null" @dismiss="toast = null" />
  </section>
</template>

<style scoped>
.head { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between; margin-bottom: var(--s-4); }
.list { list-style: none; margin: 0 0 var(--s-4); padding: 0; display: grid; gap: var(--s-3); }
.row { display: grid; grid-template-columns: 56px minmax(0, 1fr) 150px auto; gap: var(--s-3); padding: var(--s-3); align-items: center; }
.row__menu { align-self: start; }
.chip--fast, .chip--mark { background: var(--accent-tint); color: var(--accent-text); }
.chip--batch { color: var(--warning-text); }
.batch-banner { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between; margin-bottom: var(--s-3); }
.row--mine { box-shadow: 0 0 0 1px var(--accent), var(--shadow-sm); }
.row__art { position: relative; display: block; width: 56px; aspect-ratio: 3 / 4; border-radius: var(--r-sm); overflow: hidden; background: var(--surface-2); }
.row__art img { width: 100%; height: 100%; object-fit: cover; }
.row__void { width: 100%; height: 100%; }
.row__body { display: grid; gap: 4px; min-width: 0; }
.row__top { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
.row__name { font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
.row__hook { font-size: 12.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row__meta { font-size: 12px; color: var(--text-3); }
.row__diff { font-size: 12px; color: var(--text-2); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.row__error { margin: var(--s-1) 0 0; font-size: 13px; }
.row__acts { display: grid; gap: var(--s-2); }
/* 主行動 44（觸控主行動）；放回是次要動作，至少 36 */
.row__main { min-height: var(--h-lg); width: 100%; white-space: normal; text-align: center; line-height: 1.25; }
.row__minor { min-height: var(--h-md); width: 100%; }
.chip--re { background: var(--accent-tint); color: var(--accent-text); }
.chip--attempt { color: var(--warning-text); }
.chip--length, .chip--count { font-variant-numeric: tabular-nums; }
.chip--short { color: var(--warning-text); }
.chip--hold { color: var(--warning-text); }
.chip--flip { background: var(--accent-tint); color: var(--accent-text); }
.row__hold { color: var(--warning-text); overflow-wrap: anywhere; }
.row-ghost { height: 96px; border-radius: var(--r-md); }
.empty { padding: var(--s-8) var(--s-5); text-align: center; display: grid; gap: var(--s-2); }
.empty__title { font-size: 16px; font-weight: 600; }
@media (max-width: 600px) {
  .row { grid-template-columns: 48px minmax(0, 1fr) auto; }
  .row__art { width: 48px; }
  .row__menu { grid-column: 3; grid-row: 1; }
  .row__acts { grid-column: 1 / -1; }
}
</style>
