<script setup lang="ts">
import CoverSensitiveBadge from "@/components/CoverSensitiveBadge.vue";
/**
 * /review/dropped — 不受理清單（審卡 V2，ui.md §2.1）。被移出待審的卡：不是判定、不通知作者，
 * 作者那邊仍是審核中。每列可以立即復原（不確認，回到待審原位）或唯讀查看。
 * 「已滿 7 天」是管理員抽樣覆核的入口：另一位審核員先看內容，再決定要不要復原。
 */
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, fetchDroppedReviews, restoreReview, type ReviewDroppedFilter, type ReviewDroppedItem } from "@/lib/api";
import { pageTitle } from "@/lib/i18n";
import { useReviewer } from "@/lib/review";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { stageAvailable } from "@stage-site";
import RatingMark from "@/components/RatingMark.vue";
import ReviewListTabs from "@/components/ReviewListTabs.vue";
import ActionToast from "@/components/ActionToast.vue";

const DAY = 86_400_000;
const REVIEW_AFTER_DAYS = 7;
const { t, locale } = useI18n();
const { lp } = useLocalePath();
const session = useSession();
const reviewerStore = useReviewer();

const items = ref<ReviewDroppedItem[]>([]);
const total = ref<number | null>(null);
const filter = ref<ReviewDroppedFilter>("all");
const loading = ref(true);
const failed = ref(false);
const forbidden = ref(false);
const busy = ref<string | null>(null);
const toast = ref<{ id: number; text: string } | null>(null);
let seq = 0;

const filters: ReviewDroppedFilter[] = ["all", "single", "batch", "auto", "aged"];
const sourceKey = (s: ReviewDroppedItem["source"]) => (s === "single" ? "single" : s === "auto_same_content" ? "auto" : "batch");
const days = (since: number) => Math.max(0, Math.floor((Date.now() - since) / DAY));

async function load() {
  const mine = ++seq;
  failed.value = false;
  loading.value = !items.value.length;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const result = await fetchDroppedReviews(token, String(locale.value), filter.value);
    if (mine !== seq) return;
    items.value = result.items;
    if (filter.value === "all") total.value = result.total;
    forbidden.value = false;
  } catch (err) {
    if (mine !== seq) return;
    if (err instanceof ApiError && err.status === 403) forbidden.value = true;
    else failed.value = true;
  } finally {
    if (mine === seq) loading.value = false;
  }
}

function pick(next: ReviewDroppedFilter) {
  if (filter.value === next) return;
  filter.value = next;
  items.value = [];
  void load();
}

async function restore(item: ReviewDroppedItem) {
  if (busy.value) return;
  busy.value = item.id;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    await restoreReview(item.id, token);
    items.value = items.value.filter((i) => i.id !== item.id);
    if (total.value !== null) total.value = Math.max(0, total.value - 1);
    toast.value = { id: ++seq, text: t("reviewV2.toast.restored", { card: item.name || "—" }) };
    void reviewerStore.refresh();
  } catch {
    toast.value = { id: ++seq, text: t("reviewV2.toast.failed") };
  } finally {
    busy.value = null;
  }
}

onMounted(() => {
  document.title = pageTitle(t("reviewV2.dropped.title"));
  void reviewerStore.refresh();
  void load();
});
</script>

<template>
  <section class="dropped">
    <header class="head">
      <!-- 新卡與更新的數字在這一頁不另外讀：只寫名稱 -->
      <ReviewListTabs active="dropped" :counts="null" />
      <button class="btn btn--sm" :disabled="loading" @click="load">{{ $t("review.refresh") }}</button>
    </header>
    <h1 class="sr-only">{{ $t("reviewV2.dropped.title") }}</h1>

    <div v-if="forbidden" class="empty panel"><p class="empty__title">{{ $t("review.notReviewer") }}</p></div>
    <template v-else>
      <div class="seg filter" role="group" :aria-label="$t('reviewV2.dropped.filter.label')">
        <button v-for="f in filters" :key="f" class="seg__item" :class="{ 'seg__item--on': filter === f }" :aria-pressed="filter === f" :data-dropped-filter="f" @click="pick(f)">
          {{ f === "aged" ? $t("reviewV2.dropped.filter.aged", { n: REVIEW_AFTER_DAYS }) : $t(`reviewV2.dropped.filter.${f}`) }}
        </button>
      </div>

      <div v-if="failed" class="notice notice--error load-failed" role="alert">
        <span>{{ $t("reviewV2.dropped.loadFailed") }}</span>
        <button class="btn btn--sm" @click="load">{{ $t("reviewV2.dropped.retry") }}</button>
      </div>
      <div v-else-if="loading" class="list" aria-hidden="true"><div v-for="i in 3" :key="i" class="ghost row-ghost" /></div>
      <div v-else-if="!items.length" class="empty panel" data-dropped-empty>
        <p class="empty__title">{{ $t("reviewV2.dropped.empty.title") }}</p>
        <p class="subtle">{{ $t("reviewV2.dropped.empty.body") }}</p>
        <RouterLink class="btn" :to="lp('/review')">{{ $t("reviewV2.dropped.empty.action") }}</RouterLink>
      </div>
      <ul v-else class="list">
        <li v-for="item in items" :key="item.id" class="row panel" :data-dropped-row="item.id">
          <div class="row__art"><img v-if="item.avatarUrl" :src="item.avatarUrl" alt="" loading="lazy" /><CoverSensitiveBadge v-if="item.avatarUrl && item.coverSensitive" /></div>
          <div class="row__body">
            <div class="row__top">
              <span class="row__name">{{ item.name || "—" }}</span>
              <span class="chip" data-source-chip>{{ $t(`reviewV2.dropped.source.${sourceKey(item.source)}`) }}</span>
              <RatingMark v-if="item.rating" :rating="item.rating" variant="chip" />
            </div>
            <p class="row__meta">
              {{ $t("reviewV2.dropped.days", { n: days(item.droppedSince) }, days(item.droppedSince)) }}
              <template v-if="item.actor"> · {{ $t("reviewV2.dropped.by", { name: item.actor }) }}</template>
            </p>
          </div>
          <div class="row__acts">
            <button class="btn row__main" :disabled="!!busy" :aria-busy="busy === item.id" data-restore @click="restore(item)">{{ $t("reviewV2.dropped.restore") }}</button>
            <RouterLink v-if="stageAvailable" class="btn row__minor" :to="lp(`/review/${item.id}`)">{{ $t("reviewV2.dropped.view") }}</RouterLink>
          </div>
        </li>
      </ul>
    </template>
    <ActionToast v-if="toast" :key="toast.id" :message="toast.text" @dismiss="toast = null" />
  </section>
</template>

<style scoped>
.head { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between; margin-bottom: var(--s-4); }
.filter { margin-bottom: var(--s-3); max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.filter .seg__item { flex: none; white-space: nowrap; }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
.row { display: grid; grid-template-columns: 56px minmax(0, 1fr) 150px; gap: var(--s-3); padding: var(--s-3); align-items: center; }
.row__art { position: relative; width: 56px; aspect-ratio: 3 / 4; border-radius: var(--r-sm); overflow: hidden; background: var(--surface-2); }
.row__art img { width: 100%; height: 100%; object-fit: cover; }
.row__body { display: grid; gap: 4px; min-width: 0; }
.row__top { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
.row__name { font-weight: 600; font-size: 15px; overflow-wrap: anywhere; }
.row__meta { font-size: 12px; color: var(--text-3); overflow-wrap: anywhere; }
.row__acts { display: grid; gap: var(--s-2); }
.row__main { min-height: var(--h-lg); width: 100%; }
.row__minor { min-height: var(--h-md); width: 100%; justify-content: center; }
.row-ghost { height: 96px; border-radius: var(--r-md); }
.load-failed { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between; }
.empty { padding: var(--s-8) var(--s-5); text-align: center; display: grid; gap: var(--s-3); justify-items: center; }
.empty__title { font-size: 16px; font-weight: 600; }
.empty .subtle:lang(ko) { word-break: keep-all; }
@media (max-width: 600px) {
  .row { grid-template-columns: 48px minmax(0, 1fr); }
  .row__art { width: 48px; }
  .row__acts { grid-column: 1 / -1; grid-template-columns: 1fr 1fr; }
  .row__minor { min-height: var(--h-lg); }
}
</style>
