<script setup lang="ts">
/**
 * 批次不受理（限管理員，審卡 V2 ui.md §2.2）：同一個安裝或同一位作者的待審卡一次移出。
 * 每列給封面、卡名、開場白第一行，讓管理員確認不是誤判；有人領著、冷凍中、已在清單裡的停用並寫原因。
 * 只有批次需要確認；結果分開寫已移出與略過，部分成功不說成全部成功，可一鍵復原這一批。
 * 作者身分不出現在這個畫面。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { dropReviewBatch, fetchReviewGroup, restoreReviewBatch, type ReviewBatchResult, type ReviewGroupItem } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import { wrapTab } from "@/lib/focus-trap";
import { useSession } from "@/lib/session";

const props = defineProps<{ anchorId: string; scope: "author" | "device" }>();
const emit = defineEmits<{ close: [changed: boolean] }>();
const { t, locale } = useI18n();
const session = useSession();

const items = ref<ReviewGroupItem[]>([]);
const picked = ref(new Set<string>());
const loading = ref(true);
const error = ref("");
const busy = ref(false);
const result = ref<ReviewBatchResult | null>(null);
const undone = ref(false);
const changed = ref(false);
const box = ref<HTMLElement | null>(null);
let opener: HTMLElement | null = null;

const selectable = (i: ReviewGroupItem) => !i.claimedByOther && !i.held && !i.dropped;
const chosen = computed(() => items.value.filter((i) => selectable(i) && picked.value.has(i.id)));
const skippedBy = (reason: string) => result.value?.skipped.filter((s) => s.reason === reason).length ?? 0;
const skippedOther = computed(() => (result.value?.skipped.length ?? 0) - skippedBy("claimed_by_other") - skippedBy("review_held"));

async function load() {
  loading.value = true; error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    items.value = (await fetchReviewGroup(props.anchorId, token, String(locale.value), props.scope)).items;
    picked.value = new Set(items.value.filter(selectable).map((i) => i.id));
  } catch (err) {
    error.value = err instanceof Error && err.message === t("auth.expired") ? err.message : t("reviewV2.dropped.loadFailed");
  } finally { loading.value = false; }
}

function toggle(id: string) {
  const next = new Set(picked.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  picked.value = next;
}

// 重送同一個批次不會多做：批次編號在這個 sheet 開著的期間固定
const batchId = crypto.randomUUID();
async function submit() {
  const list = chosen.value;
  if (!list.length || busy.value) return;
  const ok = await confirmDialog({
    title: t("reviewV2.batch.confirmTitle", { n: list.length }),
    message: [t("reviewV2.batch.confirmLine1", { n: list.length }), t("reviewV2.batch.confirmLine2"), t("reviewV2.batch.confirmLine3"), t("reviewV2.batch.confirmLine4")].join("\n"),
    items: list.map((i) => ({ name: i.name || "—", ...(i.coverUrl ? { image: i.coverUrl } : {}) })),
    confirmText: t("reviewV2.batch.confirmOk"), cancelText: t("reviewV2.batch.confirmBack"), focusCancel: true, phraseWrap: true,
  });
  if (!ok) return;
  busy.value = true; error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    result.value = await dropReviewBatch(token, { anchorId: props.anchorId, scope: props.scope, ids: list.map((i) => i.id), batchId });
    changed.value = result.value.dropped.length > 0;
  } catch (err) {
    error.value = err instanceof Error && err.message === t("auth.expired") ? err.message : t("reviewV2.toast.failed");
  } finally { busy.value = false; }
}

async function undo() {
  if (!result.value || busy.value) return;
  busy.value = true; error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    await restoreReviewBatch(token, result.value.batchId);
    undone.value = true;
  } catch {
    error.value = t("reviewV2.toast.failed");
  } finally { busy.value = false; }
}

function close() { if (!busy.value) emit("close", changed.value); }
function keydown(e: KeyboardEvent) {
  if (e.key === "Escape") { e.stopPropagation(); close(); }
  else if (e.key === "Tab") wrapTab(e, box.value);
}
onMounted(() => { opener = document.activeElement as HTMLElement | null; void load(); void nextTick(() => box.value?.focus()); });
onBeforeUnmount(() => opener?.focus());
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="close" @keydown="keydown">
      <section ref="box" class="modal panel batch" role="dialog" aria-modal="true" aria-labelledby="batch-title" tabindex="-1" data-batch-sheet>
        <h2 id="batch-title" class="batch__title">{{ $t("reviewV2.batch.sheetTitle", { n: items.length }) }}</h2>
        <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
        <div v-if="loading" class="batch__list" aria-hidden="true"><div v-for="i in 3" :key="i" class="ghost batch__ghost" /></div>

        <template v-else-if="result">
          <div class="batch__result" role="status" data-batch-result>
            <p class="batch__done">{{ undone ? $t("reviewV2.batch.undone", { n: result.dropped.length }, result.dropped.length) : result.skipped.length ? $t("reviewV2.batch.partial", { done: result.dropped.length, skipped: result.skipped.length }) : $t("reviewV2.batch.done", { n: result.dropped.length }) }}</p>
            <ul v-if="result.skipped.length && !undone" class="batch__skips">
              <li v-if="skippedBy('claimed_by_other')">{{ $t("reviewV2.batch.skippedClaimed", { k: skippedBy("claimed_by_other") }) }}</li>
              <li v-if="skippedBy('review_held')">{{ $t("reviewV2.batch.skippedHeld", { k: skippedBy("review_held") }) }}</li>
              <li v-if="skippedOther > 0">{{ $t("reviewV2.batch.skippedOther", { k: skippedOther }) }}</li>
            </ul>
          </div>
          <div class="batch__acts">
            <button v-if="result.dropped.length && !undone" class="btn" :disabled="busy" data-batch-undo @click="undo">{{ $t("reviewV2.batch.undo", { n: result.dropped.length }) }}</button>
            <button class="btn btn--primary btn--lg" :disabled="busy" @click="close">{{ $t("reviewV2.mark.back") }}</button>
          </div>
        </template>

        <template v-else>
          <ul class="batch__list">
            <li v-for="item in items" :key="item.id" class="batch__row" :class="{ 'batch__row--off': !selectable(item) }">
              <label class="batch__pick">
                <input type="checkbox" :checked="selectable(item) && picked.has(item.id)" :disabled="!selectable(item) || busy" @change="toggle(item.id)" />
                <span class="batch__art"><img v-if="item.coverUrl" :src="item.coverUrl" alt="" loading="lazy" /></span>
                <span class="batch__text">
                  <span class="batch__name">{{ item.name || "—" }}</span>
                  <span class="batch__line">{{ item.openingLine }}</span>
                  <span v-if="!selectable(item)" class="batch__why">{{ item.claimedByOther ? $t("reviewV2.batch.rowClaimed") : item.held ? $t("reviewV2.batch.rowHeld") : $t("reviewV2.batch.rowDropped") }}</span>
                </span>
              </label>
            </li>
          </ul>
          <div class="batch__acts">
            <button class="btn" :disabled="busy" @click="close">{{ $t("reviewV2.mark.back") }}</button>
            <button class="btn btn--primary btn--lg" :disabled="!chosen.length || busy" :aria-busy="busy" data-batch-submit @click="submit">
              {{ busy ? $t("reviewV2.batch.sending") : $t("reviewV2.batch.submit", { n: chosen.length }) }}
            </button>
          </div>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.batch { max-width: 560px; width: calc(100vw - var(--s-6)); max-height: min(80dvh, 720px); display: grid; grid-template-rows: auto auto 1fr auto; gap: var(--s-3); padding: var(--s-5); }
.batch__title { font-size: 18px; }
.batch__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); overflow-y: auto; min-height: 0; }
.batch__ghost { height: 72px; border-radius: var(--r-md); }
.batch__row { border: 1px solid var(--line); border-radius: var(--r-md); }
.batch__row--off .batch__name, .batch__row--off .batch__line { color: var(--text-3); }
.batch__pick { display: grid; grid-template-columns: auto 40px minmax(0, 1fr); gap: var(--s-3); align-items: center; padding: var(--s-2) var(--s-3); min-height: var(--h-lg); cursor: pointer; }
.batch__pick input { width: 20px; height: 20px; }
.batch__art { width: 40px; aspect-ratio: 3 / 4; border-radius: var(--r-sm); overflow: hidden; background: var(--surface-2); display: block; }
.batch__art img { width: 100%; height: 100%; object-fit: cover; }
.batch__text { display: grid; gap: 2px; min-width: 0; }
.batch__name { font-weight: 600; overflow-wrap: anywhere; }
.batch__line { font-size: 12.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.batch__why { font-size: 12px; color: var(--warning-text); }
.batch__acts { display: flex; gap: var(--s-2); justify-content: flex-end; flex-wrap: wrap; }
.batch__result { display: grid; gap: var(--s-2); }
.batch__done { font-weight: 600; }
.batch__skips { margin: 0; padding-left: var(--s-5); color: var(--text-2); font-size: 13px; }
.batch:lang(ko) { word-break: keep-all; }
@media (max-width: 480px) {
  .batch__acts { flex-direction: column-reverse; }
  .batch__acts .btn { width: 100%; min-height: var(--h-lg); }
}
</style>
