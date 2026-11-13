<script setup lang="ts">
/**
 * 「我的卡片」›擴充分頁（ui.md §3.6、§3.8 製作者端、§4.5）。
 *
 *   右上「建立擴充」（這一屏的主行動）→ 選卡彈層；列：橫圖、名稱、為《卡》・版本・人數、狀態 chip、「編輯擴充」。
 *
 * 審核意見與原作者的理由是關鍵結果，所以常駐在列上（不只在通知或 toast 裡），直到狀態改變。
 * 被原作者退回／隱藏、還沒申訴時多一顆「申訴」；送出後換成「申訴中」chip，不能重複送。
 * 這個元件在「卡片」分頁時也掛著（v-show），好讓分頁標籤上的數字不必另打一次請求。
 */
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import ExtensionCover from "./ExtensionCover.vue";
import UndoToast from "./UndoToast.vue";
import CardPickerDialog from "./CardPickerDialog.vue";
import { ApiError } from "@/lib/api";
import { confirmForm } from "@/lib/confirm";
import { compact } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { appealWorkshop, fetchMyWorkshops, publishState, type MineItem } from "@/lib/workshop";

const emit = defineEmits<{ count: [number] }>();
const { t } = useI18n();
const session = useSession();
const { lp } = useLocalePath();

const items = ref<MineItem[]>([]);
const loading = ref(true);
const failed = ref(false);
const actionError = ref("");
const busy = ref<string | null>(null);
const picking = ref(false);
const toast = ref<InstanceType<typeof UndoToast> | null>(null);

let seq = 0;
async function load() {
  const n = ++seq;
  loading.value = true;
  failed.value = false;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const got = await fetchMyWorkshops(token);
    if (n !== seq) return;
    items.value = got.items;
    emit("count", got.items.length);
  } catch {
    if (n === seq) failed.value = true;
  } finally {
    if (n === seq) loading.value = false;
  }
}
// 「我的卡片」是 optimisticAuth：身分可能還在背景確認，等到有人再讀，不然重新整理會先看到一則假的「登入已失效」
watch(() => session.me?.accountNumId, (id) => { if (id) void load(); }, { immediate: true });

type Chip = { key: string; tone: "" | "on" | "ok" | "warn" | "bad" };
/**
 * 九種發布狀態收成列上的六種 chip（§4.5）。新版審核中（live_pending）寫「審核中」：製作者此刻在等的是審核結果；
 * 已發布有修改（live_changed）還是「已發布」；新版未通過（live_rejected）寫「審核未通過」，公開版照常（意見常駐在下面）。
 */
function chip(item: MineItem): Chip {
  switch (publishState(item.status, item.ownerState)) {
    case "draft": return { key: "workshop.status.draft", tone: "" };
    case "review": case "liveup": return { key: "workshop.status.inReview", tone: "warn" };
    case "rejected": case "liverej": return { key: "workshop.status.rejected", tone: "bad" };
    case "live": case "livechg": return { key: "workshop.status.published", tone: "ok" };
    case "returned": return { key: "workshop.status.returned", tone: "bad" };
    case "hidden": return { key: "workshop.status.hidden", tone: "warn" };
  }
}
// 理由照資料畫，不照 chip：新版未通過的列 chip 是「審核未通過」，但被退回的列也可能同時帶著舊的審核意見
const rejectNote = (item: MineItem) => ((item.status === "rejected" || item.status === "live_rejected") && item.rejectNote ? item.rejectNote : "");
const ownerReason = (item: MineItem) => (item.ownerState !== "visible" && item.ownerReason ? item.ownerReason : "");
const canAppeal = (item: MineItem) => item.ownerState !== "visible" && !item.appeal;
const meta = (item: MineItem) => item.version > 0
  ? t("workshop.mine.row.meta", { card: item.card.name, ver: `v${item.version}`, count: compact(item.joinCount) })
  : t("workshop.mine.row.metaDraft", { card: item.card.name });
const displayName = (item: MineItem) => item.name.trim() || t("workshop.mine.row.untitled");
const editTo = (item: MineItem) => lp(`/mine/workshops/${encodeURIComponent(item.id)}/edit`);
const hasItems = computed(() => items.value.length > 0);
const isEmpty = computed(() => !hasItems.value && !loading.value && !failed.value);

async function appeal(item: MineItem) {
  actionError.value = "";
  const answer = await confirmForm({
    title: t("workshop.appeal.title"), message: t("workshop.appeal.body"), confirmText: t("workshop.appeal.submit"),
    focusCancel: true, phraseWrap: true,
    field: { label: t("workshop.appeal.label"), required: true, multiline: true, maxlength: 500 },
  });
  if (!answer) return;
  busy.value = item.id;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const got = await appealWorkshop(item.id, answer.text, token);
    item.appeal = got.appeal ?? "pending";
    toast.value?.say(t("workshop.appeal.toast"));
  } catch (err) {
    // 已經申訴過（例如另一個分頁送過）：列上照實改成申訴中，不再給按鈕
    if (err instanceof ApiError && err.code === "appeal_exists") item.appeal = "pending";
    else actionError.value = err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="mine-ws">
    <!-- 空態自己帶主按鈕；有列表（或還在讀、讀失敗）時主按鈕在右上 -->
    <div v-if="!isEmpty" class="mine-ws__tools">
      <button type="button" class="btn btn--primary btn--sm mine-ws__create" data-ws-create @click="picking = true">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>{{ $t("workshop.create") }}
      </button>
    </div>

    <p v-if="actionError" class="notice notice--error" role="alert">{{ actionError }}</p>

    <div v-if="loading && !hasItems" class="mine-ws__list" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="ghost mine-ws__ghost" />
    </div>

    <div v-else-if="failed && !hasItems" class="notice notice--error mine-ws__error" role="alert">
      <span class="ws-text">{{ $t("workshop.mine.error.load") }}</span>
      <button type="button" class="btn btn--sm" :disabled="loading" @click="load">{{ $t("library.retry") }}</button>
    </div>

    <div v-else-if="isEmpty" class="empty panel mine-ws__empty">
      <p class="empty__title ws-text">{{ $t("workshop.mine.empty.title") }}</p>
      <p class="empty__body ws-text">{{ $t("workshop.mine.empty.body") }}</p>
      <button type="button" class="btn btn--primary" data-ws-create @click="picking = true">{{ $t("workshop.create") }}</button>
    </div>

    <ul v-else class="mine-ws__list" :aria-busy="loading || undefined">
      <li v-for="item in items" :key="item.id" class="panel mine-ws__row" :data-ws-mine="item.id">
        <ExtensionCover class="mine-ws__cover" :src="item.coverUrl" :name="displayName(item)" />
        <div class="mine-ws__body">
          <h3 class="mine-ws__name">{{ displayName(item) }}</h3>
          <p class="subtle mine-ws__meta">{{ meta(item) }}</p>
          <p class="mine-ws__chips">
            <span class="chip" :class="chip(item).tone ? `ws-chip--${chip(item).tone}` : ''" data-ws-status>{{ $t(chip(item).key) }}</span>
            <span v-if="item.appeal === 'pending'" class="chip ws-chip--warn" data-ws-appealing>{{ $t("workshop.status.appeal") }}</span>
          </p>
          <p v-if="rejectNote(item)" class="ws-reason" data-ws-reason>{{ $t("workshop.mine.row.rejectNote", { note: rejectNote(item) }) }}</p>
          <p v-if="ownerReason(item)" class="ws-reason" data-ws-reason>{{ $t("workshop.publish.ownerReason", { reason: ownerReason(item) }) }}</p>
        </div>
        <div class="mine-ws__actions">
          <RouterLink :to="editTo(item)" class="btn btn--sm">{{ $t("workshop.mine.edit") }}</RouterLink>
          <button v-if="canAppeal(item)" type="button" class="btn btn--sm btn--ghost" data-ws-appeal :disabled="busy === item.id" @click="appeal(item)">{{ $t("workshop.mine.appeal") }}</button>
        </div>
      </li>
    </ul>

    <CardPickerDialog v-if="picking" @close="picking = false" />
    <UndoToast ref="toast" />
  </div>
</template>

<style scoped>
.mine-ws { display: grid; gap: var(--s-4); padding-bottom: var(--s-6); }
.mine-ws__tools { display: flex; justify-content: flex-end; }
.mine-ws__create { gap: 6px; }
.mine-ws__create svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.mine-ws__list { display: grid; gap: var(--s-3); margin: 0; padding: 0; list-style: none; }
.mine-ws__ghost { height: 112px; border-radius: var(--r-lg); }
.mine-ws__error { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); }
.mine-ws__row { display: grid; grid-template-columns: 120px minmax(0, 1fr) auto; align-items: start; gap: var(--s-4); padding: var(--s-3); }
.mine-ws__cover { width: 120px; border-radius: var(--r-md); }
.mine-ws__body { display: grid; gap: 6px; min-width: 0; }
.mine-ws__name { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mine-ws__meta { margin: 0; overflow-wrap: anywhere; }
.mine-ws__chips { display: flex; flex-wrap: wrap; gap: var(--s-1); margin: 0; }
.mine-ws__actions { display: flex; flex-direction: column; align-items: stretch; gap: var(--s-2); }
.empty { padding: var(--s-8) var(--s-5); text-align: center; display: grid; gap: var(--s-3); justify-items: center; }
.empty__title { margin: 0; font-size: 16px; font-weight: 600; }
.empty__body { margin: 0; max-width: 34em; font-size: 14px; color: var(--text-2); }
/* 手機：圖與字一列，按鈕換到下面靠右，一排放得下兩顆 */
@media (max-width: 760px) {
  .mine-ws__row { grid-template-columns: 96px minmax(0, 1fr); gap: var(--s-3); }
  .mine-ws__cover { width: 96px; }
  .mine-ws__actions { grid-column: 1 / -1; flex-direction: row; justify-content: flex-end; flex-wrap: wrap; }
}
</style>
