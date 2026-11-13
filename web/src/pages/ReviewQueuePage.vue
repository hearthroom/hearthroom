<script setup lang="ts">
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
 *
 * 擴充單（ui.md §3.9 ①）跟卡片混排在同一張清單（伺服器以 subjectKind 分流）。版面沿用卡片列，
 * 差別只在內容：16:9 橫圖、「擴充」chip 打頭、為《原卡》、首次／新版、常駐字數與三種內容數量
 * （審核員挑單前要知道讀多少；擴充不套字數門檻，所以沒有字數 chip）、新版多一行更新說明。
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, claimReview, fetchReviewQueue, releaseReview, unholdReview, type ReviewQueueItem } from "@/lib/api";
import { isWorkshopItem, isWorkshopUpdate, type ReviewQueueEntry } from "@/lib/workshop-review";
import { submissionTypeKey, submissionTypeOf } from "@/lib/review-type";
import { relativeTime } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { useReviewer } from "@/lib/review";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { zoneLabel } from "@/lib/i18n";
import RatingMark from "@/components/RatingMark.vue";
import ReviewListTabs from "@/components/ReviewListTabs.vue";
import ExtensionCover from "@/components/workshop/ExtensionCover.vue";

const { t, locale } = useI18n();
const { lp } = useLocalePath();
const session = useSession();
const reviewerStore = useReviewer();
const router = useRouter();

const items = ref<ReviewQueueEntry[]>([]);
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
 *  篩選只收窄還沒領的；自己領著的永遠列著，免得忘了手上還有一張。
 *  「擴充」篩選兩組都收窄：審核員按它就是只想看擴充，領著的卡片單仍在「全部」裡。 */
const filter = ref<"all" | "resubmitted" | "workshop">("all");
const resubmittedOnly = computed(() => filter.value === "resubmitted");
const workshopOnly = computed(() => filter.value === "workshop");
const mine = computed(() => items.value.filter((i) => i.claim === "mine" && (!workshopOnly.value || isWorkshopItem(i))));
const others = computed(() => items.value.filter((i) => i.claim !== "mine" && (!resubmittedOnly.value || (i.attempt ?? 1) >= 2) && (!workshopOnly.value || isWorkshopItem(i))));
const FILTERS = [
  { id: "all", label: "review.filter.all" },
  { id: "resubmitted", label: "review.filter.resubmitted" },
  { id: "workshop", label: "workshop.review.kind" },
] as const;

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

async function claim(item: ReviewQueueEntry) {
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
    // 擴充單被擋（自己的擴充、限制級還沒驗證年齡）：進詳情，那裡有原因與下一步（驗證年齡）
    if (isWorkshopItem(item) && err instanceof ApiError && err.status === 403) {
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
        <button v-for="f in FILTERS" :key="f.id" class="seg__item" :class="{ 'seg__item--on': filter === f.id }" :aria-pressed="filter === f.id" :data-filter="f.id" @click="filter = f.id">{{ $t(f.label) }}</button>
      </div>
      <ul v-for="(group, gi) in [mine, others]" :key="gi" class="list">
        <li v-for="item in group" :key="item.id" class="row panel" :class="{ 'row--mine': item.claim === 'mine', 'row--ws': isWorkshopItem(item) }" :data-review-row="item.id" :data-subject="isWorkshopItem(item) ? 'workshop' : 'card'">
          <!-- 擴充單：16:9 橫圖（96 寬）。名稱、chip、簡介換成擴充自己的；原卡只出現在「為《原卡》」 -->
          <div v-if="isWorkshopItem(item)" class="row__art row__art--ws" data-ws-cover>
            <ExtensionCover :src="item.workshop.coverUrl ?? ''" :name="item.workshop.name" />
          </div>
          <div v-else class="row__art">
            <img v-if="item.card.avatarUrl" :src="item.card.avatarUrl" alt="" loading="lazy" />
            <div v-else class="row__void" />
          </div>
          <div v-if="isWorkshopItem(item)" class="row__body">
            <div class="row__top">
              <span class="row__name">{{ item.workshop.name }}</span>
              <span class="chip ws-chip--on" data-ws-chip>{{ $t("workshop.review.kind") }}</span>
              <span v-if="item.card?.name" class="chip" data-ws-for>{{ $t("workshop.detail.forCard", { card: item.card.name }) }}</span>
              <span class="chip" :class="{ 'ws-chip--warn': isWorkshopUpdate(item) }" data-type-chip>{{ $t(isWorkshopUpdate(item) ? "workshop.review.update" : "review.type.first") }}</span>
              <span class="chip chip--count" data-resident-chip>{{ $t("workshop.manage.row.resident", { chars: numbers.format(item.workshop.residentChars) }) }}</span>
              <span class="chip chip--count" data-worldbook-chip>{{ $t("review.queue.worldbook", { n: numbers.format(item.workshop.loreCount) }) }}</span>
              <span class="chip chip--count" data-regex-chip>{{ $t("review.queue.regex", { n: numbers.format(item.workshop.ruleCount) }) }}</span>
              <span class="chip chip--count" data-opening-chip>{{ $t("workshop.detail.includes.opening", { n: numbers.format(item.workshop.openingCount) }, item.workshop.openingCount) }}</span>
              <span v-if="item.stampedByMe" class="chip">{{ $t("review.queue.reviewed") }}</span>
              <RatingMark v-if="item.rating" :rating="item.rating" variant="chip" />
              <span v-if="item.hold" class="chip chip--hold" data-hold-chip>{{ $t("review.hold.chip") }}</span>
            </div>
            <p class="row__hook">{{ item.workshop.summary }}</p>
            <!-- 新版：更新說明一行（省略），全文在詳情 -->
            <p v-if="isWorkshopUpdate(item) && item.workshop.updateNote" class="row__hook row__note" data-update-note>{{ $t("workshop.review.updateNote", { note: item.workshop.updateNote }) }}</p>
            <p class="row__meta">{{ item.workshop.authorName ? `${$t("workshop.review.by", { name: item.workshop.authorName })} · ` : "" }}{{ relativeTime(item.submittedAt) }}</p>
            <p v-if="item.hold" class="row__meta row__hold" data-hold-by>{{ item.hold.byMe ? $t("review.hold.byMe") : $t("review.hold.by", { name: item.hold.holder || $t("review.hold.someone") }) }} · {{ relativeTime(item.hold.at) }}</p>
            <p v-if="rowError?.id === item.id" class="notice notice--error row__error" role="alert">{{ rowError.text }}</p>
          </div>
          <div v-else class="row__body">
            <div class="row__top">
              <span class="row__name">{{ item.card.name }}</span>
              <span class="chip" :class="{ 'chip--re': submissionTypeOf(item) !== 'first' }" data-type-chip :data-reopen-chip="submissionTypeOf(item) === 'reopen' ? '' : undefined">{{ $t(submissionTypeKey(submissionTypeOf(item))) }}</span>
              <span v-if="submissionTypeOf(item) !== 'reopen' && (item.attempt ?? 1) >= 2" class="chip chip--attempt" data-attempt>{{ $t("review.attempt", { n: item.attempt }) }}</span>
              <span v-if="lengthChip(item)" class="chip chip--length" :class="{ 'chip--short': lengthChip(item)!.short }" data-length-chip>{{ lengthChip(item)!.text }}</span>
              <!-- 世界書條目與正規表示式規則（全部，含停用）：挑卡前先知道要讀多少；不知道就不標，0 照標 -->
              <span v-if="typeof item.worldbookEntries === 'number'" class="chip chip--count" data-worldbook-chip>{{ $t("review.queue.worldbook", { n: numbers.format(item.worldbookEntries) }) }}</span>
              <span v-if="typeof item.regexRules === 'number'" class="chip chip--count" data-regex-chip>{{ $t("review.queue.regex", { n: numbers.format(item.regexRules) }) }}</span>
              <span v-if="item.stampedByMe" class="chip">{{ $t("review.queue.reviewed") }}</span>
              <RatingMark v-if="item.rating" :rating="item.rating" variant="chip" />
              <span v-if="item.hold" class="chip chip--hold" data-hold-chip>{{ $t("review.hold.chip") }}</span>
            </div>
            <p class="row__hook">{{ item.card.summary }}</p>
            <p class="row__meta">{{ zoneLabel(item.card.zone) }} · {{ relativeTime(item.submittedAt) }}</p>
            <p v-if="item.hold" class="row__meta row__hold" data-hold-by>{{ item.hold.byMe ? $t("review.hold.byMe") : $t("review.hold.by", { name: item.hold.holder || $t("review.hold.someone") }) }} · {{ relativeTime(item.hold.at) }}</p>
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
              {{ busy === item.id ? $t("review.action.claiming") : $t(item.hold ? "review.action.claimHeld" : "review.action.claim") }}
            </button>
            <!-- 冷凍人自己解凍；管理員解別人的要寫理由，在審核頁 -->
            <button v-if="item.hold?.byMe" class="btn btn--ghost row__minor" :disabled="!!busy" data-unhold @click="unhold(item)">{{ $t("review.action.unhold") }}</button>
          </div>
        </li>
      </ul>
      <div v-if="resubmittedOnly && !others.length" class="empty panel"><p class="empty__title">{{ $t("review.filter.empty") }}</p></div>
      <div v-if="workshopOnly && !mine.length && !others.length" class="empty panel" data-ws-empty>
        <p class="empty__title">{{ $t("workshop.review.filterEmpty") }}</p>
        <p class="subtle">{{ $t("workshop.review.filterEmptyHint") }}</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.head { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between; margin-bottom: var(--s-4); }
.list { list-style: none; margin: 0 0 var(--s-4); padding: 0; display: grid; gap: var(--s-3); }
.row { display: grid; grid-template-columns: 56px minmax(0, 1fr) 150px; gap: var(--s-3); padding: var(--s-3); align-items: center; }
.row--ws { grid-template-columns: 96px minmax(0, 1fr) 150px; }
.row--mine { box-shadow: 0 0 0 1px var(--accent), var(--shadow-sm); }
.row__art { display: block; width: 56px; aspect-ratio: 3 / 4; border-radius: var(--r-sm); overflow: hidden; background: var(--surface-2); }
.row__art img { width: 100%; height: 100%; object-fit: cover; }
.row__void { width: 100%; height: 100%; }
.row__art--ws { width: 96px; aspect-ratio: 16 / 9; }
.row__note { color: var(--text); }
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
.chip--hold { color: var(--warning-text); }
.row__hold { color: var(--warning-text); overflow-wrap: anywhere; }
.filter { margin-bottom: var(--s-3); }
.row-ghost { height: 96px; border-radius: var(--r-md); }
.empty { padding: var(--s-8) var(--s-5); text-align: center; display: grid; gap: var(--s-2); }
.empty__title { font-size: 16px; font-weight: 600; }
@media (max-width: 600px) {
  .row { grid-template-columns: 48px minmax(0, 1fr); }
  .row__art { width: 48px; }
  .row--ws { grid-template-columns: 80px minmax(0, 1fr); }
  .row__art--ws { width: 80px; }
  .row__acts { grid-column: 1 / -1; }
}
</style>
