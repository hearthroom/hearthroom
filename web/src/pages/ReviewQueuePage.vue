<script setup lang="ts">
/**
 * /review — 社群審核的共享佇列。
 *
 * 誰想審就自己領；領了就是「我正在看」，逾時自動放回。這裡只列狀態與入口，
 * 看設定、蓋章在 ReviewDetailPage。不顯示作者（盲審）。
 *
 * 領取與開始審是同一顆按鈕（2026-11-02 體檢 R1）：以前領取不導頁、「查看」又隨時可按，
 * 太早點就撞進「請先領取」。現在只有領成功才進詳情；領取送出中這一列的按鈕都不能按。
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, claimReview, fetchReviewQueue, releaseReview, type ReviewQueueItem } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { useReviewer } from "@/lib/review";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { zoneLabel } from "@/lib/i18n";
import RatingMark from "@/components/RatingMark.vue";
import ReviewListTabs from "@/components/ReviewListTabs.vue";

const { t, locale } = useI18n();
const { lp } = useLocalePath();
const session = useSession();
const reviewerStore = useReviewer();
const router = useRouter();

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

/** 重送＝同一張卡之前審過至少一次（被駁回後再送，或過審後改內容再送）。
 *  篩選只收窄還沒領的；自己領著的永遠列著，免得忘了手上還有一張。 */
const resubmittedOnly = ref(false);
const mine = computed(() => items.value.filter((i) => i.claim === "mine"));
const others = computed(() => items.value.filter((i) => i.claim !== "mine" && (!resubmittedOnly.value || (i.attempt ?? 1) >= 2)));

async function load() {
  error.value = "";
  loading.value = !items.value.length;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    items.value = (await fetchReviewQueue(token, String(locale.value))).items;
    forbidden.value = false;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) forbidden.value = true;
    else error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}

async function claim(item: ReviewQueueItem) {
  if (busy.value) return;
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
    // 被別人先領走：這一列改成「有人在看」並說明；其他失敗只說沒領成，按鈕照樣可以再按
    const taken = err instanceof ApiError && err.status === 409 && err.code !== "you already reviewed this submission";
    const text = err instanceof ApiError && err.code === "moderation_self_review" ? t("review.selfReview.claim")
      : taken ? t("review.claim.taken")
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

onMounted(() => {
  document.title = pageTitle(t("review.title"));
  void reviewerStore.refresh();
  void load();
});
</script>

<template>
  <section class="review-queue">
    <header class="head">
      <ReviewListTabs active="pending" :pending="reviewerStore.reviewer ? reviewerStore.pendingReviews : null" />
      <button class="btn btn--sm" :disabled="loading" @click="load">{{ $t("review.refresh") }}</button>
    </header>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <div v-if="forbidden" class="empty panel"><p class="empty__title">{{ $t("review.notReviewer") }}</p></div>
    <div v-else-if="loading" class="list" aria-hidden="true"><div v-for="i in 4" :key="i" class="ghost row-ghost" /></div>
    <!-- 讀不到就只說讀不到：沒載入成功的清單不能說成「沒有待審的卡」 -->
    <template v-else-if="!items.length">
      <div v-if="!error" class="empty panel">
        <p class="empty__title">{{ $t("review.empty") }}</p>
        <p class="subtle">{{ $t("review.emptyHint") }}</p>
      </div>
    </template>

    <template v-else>
      <div class="seg filter" role="group" :aria-label="$t('review.filter.label')">
        <button class="seg__item" :class="{ 'seg__item--on': !resubmittedOnly }" :aria-pressed="!resubmittedOnly" @click="resubmittedOnly = false">{{ $t("review.filter.all") }}</button>
        <button class="seg__item" :class="{ 'seg__item--on': resubmittedOnly }" :aria-pressed="resubmittedOnly" @click="resubmittedOnly = true">{{ $t("review.filter.resubmitted") }}</button>
      </div>
      <ul v-for="(group, gi) in [mine, others]" :key="gi" class="list">
        <li v-for="item in group" :key="item.id" class="row panel" :class="{ 'row--mine': item.claim === 'mine' }" :data-review-row="item.id">
          <div class="row__art">
            <img v-if="item.card.avatarUrl" :src="item.card.avatarUrl" alt="" loading="lazy" />
            <div v-else class="row__void" />
          </div>
          <div class="row__body">
            <div class="row__top">
              <span class="row__name">{{ item.card.name }}</span>
              <span class="chip" :class="{ 'chip--re': item.kind === 're' }">{{ $t(`review.kind.${item.kind}`) }}</span>
              <span v-if="(item.attempt ?? 1) >= 2" class="chip chip--attempt" data-attempt>{{ $t("review.attempt", { n: item.attempt }) }}</span>
              <span v-if="lengthChip(item)" class="chip chip--length" :class="{ 'chip--short': lengthChip(item)!.short }" data-length-chip>{{ lengthChip(item)!.text }}</span>
              <!-- 世界書條目與正規表示式規則（全部，含停用）：挑卡前先知道要讀多少；不知道就不標，0 照標 -->
              <span v-if="typeof item.worldbookEntries === 'number'" class="chip chip--count" data-worldbook-chip>{{ $t("review.queue.worldbook", { n: numbers.format(item.worldbookEntries) }) }}</span>
              <span v-if="typeof item.regexRules === 'number'" class="chip chip--count" data-regex-chip>{{ $t("review.queue.regex", { n: numbers.format(item.regexRules) }) }}</span>
              <span v-if="item.stampedByMe" class="chip">{{ $t("review.queue.reviewed") }}</span>
              <RatingMark v-if="item.rating" :rating="item.rating" variant="chip" />
            </div>
            <p class="row__hook">{{ item.card.summary }}</p>
            <p class="row__meta">{{ zoneLabel(item.card.zone) }} · {{ relativeTime(item.submittedAt) }}</p>
            <p v-if="rowError?.id === item.id" class="notice notice--error row__error" role="alert">{{ rowError.text }}</p>
          </div>
          <div class="row__acts">
            <template v-if="item.claim === 'mine'">
              <RouterLink class="btn btn--primary row__main" :to="lp(`/review/${item.id}`)">{{ $t("review.action.continue") }}</RouterLink>
              <button class="btn btn--ghost row__minor" :disabled="busy === item.id" @click="release(item)">{{ $t("review.action.release") }}</button>
            </template>
            <RouterLink v-else-if="item.stampedByMe" class="btn row__main" :to="lp(`/review/${item.id}`)">{{ $t("review.action.open") }}</RouterLink>
            <button v-else-if="item.claim === 'other'" class="btn row__main" disabled>{{ $t("review.claim.other") }}</button>
            <button v-else class="btn btn--primary row__main" :disabled="!!busy" :aria-busy="busy === item.id" @click="claim(item)">
              {{ busy === item.id ? $t("review.action.claiming") : $t("review.action.claim") }}
            </button>
          </div>
        </li>
      </ul>
      <div v-if="resubmittedOnly && !others.length" class="empty panel"><p class="empty__title">{{ $t("review.filter.empty") }}</p></div>
    </template>
  </section>
</template>

<style scoped>
.head { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between; margin-bottom: var(--s-4); }
.list { list-style: none; margin: 0 0 var(--s-4); padding: 0; display: grid; gap: var(--s-3); }
.row { display: grid; grid-template-columns: 56px minmax(0, 1fr) 150px; gap: var(--s-3); padding: var(--s-3); align-items: center; }
.row--mine { box-shadow: 0 0 0 1px var(--accent), var(--shadow-sm); }
.row__art { display: block; width: 56px; aspect-ratio: 3 / 4; border-radius: var(--r-sm); overflow: hidden; background: var(--surface-2); }
.row__art img { width: 100%; height: 100%; object-fit: cover; }
.row__void { width: 100%; height: 100%; }
.row__body { display: grid; gap: 4px; min-width: 0; }
.row__top { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
.row__name { font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
.row__hook { font-size: 12.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row__meta { font-size: 12px; color: var(--text-3); }
.row__error { margin: var(--s-1) 0 0; font-size: 13px; }
.row__acts { display: grid; gap: var(--s-2); }
/* 主行動 44（觸控主行動）；放回是次要動作，至少 36 */
.row__main { min-height: var(--h-lg); width: 100%; white-space: normal; text-align: center; line-height: 1.25; }
.row__minor { min-height: var(--h-md); width: 100%; }
.chip--re { background: var(--accent-tint); color: var(--accent-text); }
.chip--attempt { color: var(--warning-text); }
.chip--length, .chip--count { font-variant-numeric: tabular-nums; }
.chip--short { color: var(--warning-text); }
.filter { margin-bottom: var(--s-3); }
.row-ghost { height: 96px; border-radius: var(--r-md); }
.empty { padding: var(--s-8) var(--s-5); text-align: center; display: grid; gap: var(--s-2); }
.empty__title { font-size: 16px; font-weight: 600; }
@media (max-width: 600px) {
  .row { grid-template-columns: 48px minmax(0, 1fr); }
  .row__art { width: 48px; }
  .row__acts { grid-column: 1 / -1; }
}
</style>
