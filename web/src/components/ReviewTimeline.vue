<script setup lang="ts">
/**
 * 單卡審核紀錄（審卡 V2 第二批，ui.md §4.2）：送審、駁回（理由與補充）、冷凍、不受理與復原、撤回、重新審核、通過，
 * 依送審輪次排成一條線。事件名一律有文字，不單靠顏色或符號。第一次打開這個分頁才讀。
 * V2 之前的冷凍與不受理沒有事件，頂端照實寫起點，不補造。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { fetchReviewTimeline, type ReviewTimelineItem } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { reasonKey } from "@/lib/review-reasons";
import { useSession } from "@/lib/session";

const props = defineProps<{ submissionId: string }>();
const { t } = useI18n();
const session = useSession();

const items = ref<ReviewTimelineItem[] | null>(null);
const coverageFrom = ref<number | null>(null);
const error = ref(false);
const loading = ref(true);

async function load() {
  loading.value = true; error.value = false;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error("auth");
    const r = await fetchReviewTimeline(props.submissionId, token);
    items.value = r.items; coverageFrom.value = r.coverageFrom;
  } catch { error.value = true; } finally { loading.value = false; }
}
onMounted(load);

const label = (i: ReviewTimelineItem) =>
  i.action === "reopen_withdraw" ? t("review.action.withdraw")
  : i.action === "submit" && i.round > 1 ? t("reviewV2.timeline.event.resubmit")
  : t(`reviewV2.timeline.event.${i.action}`);
const rounds = computed(() => {
  const out: { round: number; items: ReviewTimelineItem[] }[] = [];
  for (const i of items.value ?? []) {
    const last = out[out.length - 1];
    if (last && last.round === i.round) last.items.push(i); else out.push({ round: i.round, items: [i] });
  }
  return out.reverse();
});
const latest = computed(() => {
  const list = items.value ?? [];
  const i = list[list.length - 1];
  return i ? t("reviewV2.timeline.latest", { result: label(i), who: i.actor ?? "—", time: dateTime(i.at) }) : "";
});
</script>

<template>
  <section class="timeline" data-review-timeline>
    <div v-if="loading" class="ghost timeline__ghost" aria-hidden="true" />
    <p v-else-if="error" class="notice notice--error" role="alert">{{ $t("state.loadFailed") }} <button type="button" class="btn btn--sm" @click="load">{{ $t("review.correction.reload") }}</button></p>
    <template v-else-if="items">
      <p class="timeline__latest" data-timeline-latest>{{ latest }}</p>
      <p v-if="coverageFrom" class="subtle">{{ $t("reviewV2.timeline.coverage", { date: dateTime(coverageFrom) }) }}</p>
      <p v-if="items.length <= 1" class="subtle" data-timeline-only>{{ $t("reviewV2.timeline.onlySubmit") }}</p>
      <div v-for="r in rounds" :key="r.round" class="round">
        <h4 class="round__title">{{ $t("review.attempt", { n: r.round }) }}</h4>
        <ol class="round__list">
          <li v-for="(i, k) in [...r.items].reverse()" :key="k" class="event" :class="{ 'event--current': i.current }" :data-timeline-event="i.action">
            <div class="event__head">
              <span class="chip" :class="{ 'chip--reject': i.action === 'reject', 'chip--warn': i.action === 'drop' || i.action === 'hold' }">{{ label(i) }}</span>
              <span v-if="i.source" class="chip chip--quiet">{{ $t(`reviewV2.dropped.source.${i.source === 'single' ? 'single' : i.source === 'auto_same_content' ? 'auto' : 'batch'}`) }}</span>
              <span class="subtle">{{ i.mine ? $t("reviewV2.timeline.you") : i.actor ?? "" }}</span>
              <time class="subtle event__time" :datetime="new Date(i.at).toISOString()">{{ dateTime(i.at) }}</time>
            </div>
            <ul v-if="i.marks?.length" class="event__reasons" data-timeline-marks>
              <li v-for="m in i.marks" :key="m" class="chip chip--warn">{{ $t(`reviewV2.marks.${m}`) }}</li>
            </ul>
            <ul v-if="i.reasons?.length" class="event__reasons">
              <li v-for="code in i.reasons" :key="code" class="chip">{{ $t(reasonKey(code, "name")) }}</li>
            </ul>
            <details v-if="i.note" class="event__note"><summary>{{ i.note.split("\n")[0] }}</summary><p>{{ i.note }}</p></details>
          </li>
        </ol>
      </div>
    </template>
  </section>
</template>

<style scoped>
.timeline { display: grid; gap: var(--s-3); min-width: 0; }
.timeline__ghost { height: 160px; border-radius: var(--r-md); }
.timeline__latest { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.round { display: grid; gap: var(--s-2); min-width: 0; }
.round__title { margin: 0; font-size: 14px; }
.round__list { list-style: none; margin: 0; padding: 0 0 0 var(--s-3); border-left: 2px solid var(--line); display: grid; gap: var(--s-2); }
.event { display: grid; gap: var(--s-1); padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); min-width: 0; }
.event--current { background: var(--surface-2); }
.event__head { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; min-width: 0; }
.event__time { margin-inline-start: auto; font-variant-numeric: tabular-nums; }
.event__reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--s-1); }
.event__note { font-size: 13px; color: var(--text-2); min-width: 0; }
.event__note summary { cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: list-item; }
.event__note p { margin: var(--s-1) 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.chip--reject { color: var(--danger); }
.chip--warn { color: var(--warning-text); }
.chip--quiet { color: var(--text-3); }
.timeline:lang(ko) { word-break: keep-all; }
</style>
