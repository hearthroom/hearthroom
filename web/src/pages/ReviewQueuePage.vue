<script setup lang="ts">
/**
 * /review — 社群審核的共享佇列。
 *
 * 誰想審就自己領；領了就是「我正在看」，逾時自動放回。這裡只列狀態與入口，
 * 看設定、蓋章在 ReviewDetailPage。不顯示作者（盲審）。
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, claimReview, fetchReviewQueue, releaseReview, type ReviewQueueItem } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { useReviewer } from "@/lib/review";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { zoneLabel } from "@/lib/i18n";

const { t, locale } = useI18n();
const { lp } = useLocalePath();
const session = useSession();
const reviewerStore = useReviewer();

const items = ref<ReviewQueueItem[]>([]);
const loading = ref(true);
const error = ref("");
const busy = ref<string | null>(null);
const forbidden = ref(false);

const mine = computed(() => items.value.filter((i) => i.claim === "mine"));
const others = computed(() => items.value.filter((i) => i.claim !== "mine"));

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
  busy.value = item.id;
  error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    await claimReview(item.id, token);
    item.claim = "mine";
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.actionFailed");
    await load();
  } finally {
    busy.value = null;
  }
}

async function release(item: ReviewQueueItem) {
  busy.value = item.id;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    await releaseReview(item.id, token);
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
  <div class="page">
    <header class="head">
      <div>
        <p class="eyebrow">{{ $t("review.eyebrow") }}</p>
        <h1 class="head__title display">{{ $t("review.title") }}</h1>
      </div>
      <button class="btn btn--sm" :disabled="loading" @click="load">{{ $t("review.refresh") }}</button>
    </header>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <div v-if="forbidden" class="empty panel"><p class="empty__title">{{ $t("review.notReviewer") }}</p></div>
    <div v-else-if="loading" class="list" aria-hidden="true"><div v-for="i in 4" :key="i" class="ghost row-ghost" /></div>
    <div v-else-if="!items.length" class="empty panel"><p class="empty__title">{{ $t("review.empty") }}</p></div>

    <template v-else>
      <ul v-for="(group, gi) in [mine, others]" :key="gi" class="list">
        <li v-for="item in group" :key="item.id" class="row panel" :class="{ 'row--mine': item.claim === 'mine' }">
          <RouterLink :to="lp(`/review/${item.id}`)" class="row__art">
            <img v-if="item.card.avatarUrl" :src="item.card.avatarUrl" alt="" loading="lazy" />
            <div v-else class="row__void" />
          </RouterLink>
          <div class="row__body">
            <div class="row__top">
              <RouterLink :to="lp(`/review/${item.id}`)" class="row__name">{{ item.card.name }}</RouterLink>
              <span class="chip" :class="{ 'chip--re': item.kind === 're' }">{{ $t(`review.kind.${item.kind}`) }}</span>
              <span class="chip">{{ $t("review.stamps", { n: item.stamps.approve, required: item.stamps.required }) }}</span>
              <span v-if="item.nsfw" class="chip chip--nsfw">{{ $t("review.rating.nsfw") }}</span>
            </div>
            <p class="row__hook">{{ item.card.summary }}</p>
            <p class="row__meta">
              {{ zoneLabel(item.card.zone) }} · {{ relativeTime(item.submittedAt) }}
              <span v-if="item.stampedByMe"> · {{ $t("review.stampedByMe") }}</span>
              <span v-else> · {{ $t(`review.claim.${item.claim}`) }}</span>
            </p>
          </div>
          <div class="row__acts">
            <RouterLink class="btn btn--sm" :to="lp(`/review/${item.id}`)">{{ $t("review.action.open") }}</RouterLink>
            <button v-if="item.claim === 'mine'" class="btn btn--sm" :disabled="busy === item.id" @click="release(item)">
              {{ $t("review.action.release") }}
            </button>
            <button
              v-else
              class="btn btn--sm btn--primary"
              :disabled="busy === item.id || item.claim === 'other' || item.stampedByMe"
              @click="claim(item)"
            >
              {{ $t("review.action.claim") }}
            </button>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.head { display: flex; flex-wrap: wrap; gap: var(--s-4); align-items: center; justify-content: space-between; margin-bottom: var(--s-4); }
.head__title { font-size: clamp(20px, 2.6vw, 24px); }
.list { list-style: none; margin: 0 0 var(--s-4); padding: 0; display: grid; gap: var(--s-3); }
.row { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: var(--s-3); padding: var(--s-3); align-items: center; }
.row--mine { box-shadow: 0 0 0 1px var(--accent), var(--shadow-sm); }
.row__art { display: block; width: 64px; aspect-ratio: 3 / 4; border-radius: var(--r-sm); overflow: hidden; background: var(--surface-2); }
.row__art img { width: 100%; height: 100%; object-fit: cover; }
.row__void { width: 100%; height: 100%; }
.row__body { display: grid; gap: 4px; min-width: 0; }
.row__top { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
.row__name { font-weight: 600; font-size: 15px; }
.row__hook { font-size: 12.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row__meta { font-size: 12px; color: var(--text-3); }
.row__acts { display: grid; gap: var(--s-2); }
.chip--re { background: var(--accent-tint); color: var(--accent-text); }
.row-ghost { height: 96px; border-radius: var(--r-md); }
.empty { padding: var(--s-8) var(--s-5); text-align: center; }
.empty__title { font-size: 16px; font-weight: 600; }
@media (max-width: 520px) {
  .row { grid-template-columns: 48px minmax(0, 1fr); }
  .row__art { width: 48px; }
  .row__acts { grid-column: 1 / -1; grid-auto-flow: column; }
}
</style>
