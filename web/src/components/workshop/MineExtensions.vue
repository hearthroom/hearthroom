<script setup lang="ts">
import { stageAvailable } from "@stage-site";
/**
 * 「我的卡片」›擴充分頁（docs studio/tasks/2026-11-15-workshop-v2-dlc-and-lorebook/ui.md §3.5）。
 *
 *   右上「建立擴充」（這一屏的主行動）→ 選卡彈層；列：橫圖、名稱、為《卡》・版本・人數、類型 chip＋狀態 chip、「編輯」。
 *
 * 狀態只有草稿｜已發布。原卡作者關了工坊、或原作者隱藏了這個玩家擴充，是另外的標記：列上一個 chip 加一行說明，
 * 不是處分、沒有申訴，所以沒有動作。
 * 這個元件在「卡片」分頁時也掛著（v-show），好讓分頁標籤上的數字不必另打一次請求。
 */
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import ExtensionCover from "./ExtensionCover.vue";
import WorkshopScopeDialog from "./WorkshopScopeDialog.vue";
import { compact } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { fetchMyWorkshops, listUniversalMods, type MineItem } from "@/lib/workshop";
import type { UniversalModChoice } from "@/lib/workshop-mods";

const emit = defineEmits<{ count: [number] }>();
const { t } = useI18n();
const session = useSession();
const { lp } = useLocalePath();
const route = useRoute();
const router = useRouter();

const items = ref<MineItem[]>([]);
const universal = ref<UniversalModChoice[]>([]);
const loading = ref(true);
const failed = ref(false);
const universalFailed = ref(false);
const picking = ref(false);
const preselectUniversal = computed(() => route.query.new === "universal");
watch(preselectUniversal, (value) => { if (value) picking.value = true; }, { immediate: true });
function closePicker() {
  picking.value = false;
  if (route.query.new) void router.replace({ query: { ...route.query, new: undefined } });
}

let seq = 0;
async function load() {
  const n = ++seq;
  loading.value = true;
  failed.value = false;
  universalFailed.value = false;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const [got, local] = await Promise.all([
      fetchMyWorkshops(token),
      listUniversalMods(token).catch(() => null),
    ]);
    if (n !== seq) return;
    items.value = got.items;
    if (local) universal.value = local.items;
    universalFailed.value = !local;
    emit("count", got.items.length + universal.value.length);
  } catch {
    if (n === seq) failed.value = true;
  } finally {
    if (n === seq) loading.value = false;
  }
}
// 「我的卡片」是 optimisticAuth：身分可能還在背景確認，等到有人再讀，不然重新整理會先看到一則假的「登入已失效」
watch(() => session.me?.accountNumId, (id) => { if (id) void load(); }, { immediate: true });

const isDlc = (item: MineItem) => item.kind === "dlc";
const published = (item: MineItem) => item.status !== "draft";
/** 原卡作者關了工坊：只在已發布的列上標（草稿本來就沒有在套用） */
const closedNote = (item: MineItem) => (item.workshopClosed && published(item)
  ? isDlc(item)
    ? { chip: "workshop.status.ownWorkshopClosed", line: "workshop.mine.row.ownWorkshopClosed" }
    : { chip: "workshop.status.cardWorkshopClosed", line: "workshop.mine.row.cardWorkshopClosed" }
  : null);
const shareStatus = {
  private: "workshop.status.private",
  pending: "workshop.status.waitingAuthor",
  displayed: "workshop.status.showing",
  unlisted: "workshop.status.notShownByAuthor",
};
const statusOf = (item: MineItem) => isDlc(item)
  ? (published(item) ? "workshop.status.published" : "workshop.status.draft")
  : shareStatus[item.playerShareState ?? "private"];
const meta = (item: MineItem) => {
  if (!isDlc(item)) return t("workshop.mine.row.metaCard", { card: item.card.name });
  if (!item.version) return t("workshop.mine.row.metaDraft", { card: item.card.name });
  return t("workshop.mine.row.meta", { card: item.card.name, ver: `v${item.version}`, count: compact(item.joinCount) });
};
const displayName = (item: MineItem) => item.name.trim() || t(isDlc(item) ? "workshop.mine.row.untitledDlc" : "workshop.mine.row.untitled");
const editTo = (item: MineItem) => lp(`/mine/workshops/${encodeURIComponent(item.id)}/edit`);
const hasItems = computed(() => items.value.length > 0 || universal.value.length > 0);
const isEmpty = computed(() => !hasItems.value && !loading.value && !failed.value);
</script>

<template>
  <div class="mine-ws">
    <!-- 空態自己帶主按鈕；有列表（或還在讀、讀失敗）時主按鈕在右上 -->
    <div v-if="!isEmpty" class="mine-ws__tools">
      <button v-if="stageAvailable" type="button" class="btn btn--primary btn--sm mine-ws__create" data-ws-create @click="picking = true">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>{{ $t("workshop.create") }}
      </button>
    </div>

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
      <button v-if="stageAvailable" type="button" class="btn btn--primary" data-ws-create @click="picking = true">{{ $t("workshop.create") }}</button>
    </div>

    <ul v-else class="mine-ws__list" :aria-busy="loading || undefined">
      <li v-for="item in items" :key="item.id" class="panel mine-ws__row" :data-ws-mine="item.id">
        <ExtensionCover class="mine-ws__cover" :src="item.coverUrl" :name="displayName(item)" />
        <div class="mine-ws__body">
          <h3 class="mine-ws__name">{{ displayName(item) }}</h3>
          <p class="subtle mine-ws__meta">{{ meta(item) }}</p>
          <p class="mine-ws__chips">
            <span class="chip" data-ws-kind>{{ isDlc(item) ? $t("workshop.layer.dlc") : $t("workshop.layer.extChip") }}</span>
            <span class="chip" :class="{ 'ws-chip--ok': isDlc(item) ? published(item) : item.playerShareState === 'displayed' }" data-ws-status>{{ $t(statusOf(item)) }}</span>
            <span v-if="closedNote(item)" class="chip ws-chip--warn" data-ws-closed>{{ $t(closedNote(item)!.chip) }}</span>
          </p>
          <p v-if="closedNote(item)" class="subtle ws-text mine-ws__note" data-ws-closed-note>{{ $t(closedNote(item)!.line) }}</p>
        </div>
        <div class="mine-ws__actions">
          <RouterLink v-if="stageAvailable" :to="editTo(item)" class="btn btn--sm">{{ $t("workshop.mine.edit") }}</RouterLink>
        </div>
      </li>
      <li v-for="item in universal" :key="item.id" class="panel mine-ws__row" :data-ws-mine="item.id">
        <ExtensionCover class="mine-ws__cover" :src="''" :name="item.name" />
        <div class="mine-ws__body">
          <h3 class="mine-ws__name">{{ item.name || $t("workshop.mine.row.untitled") }}</h3>
          <p class="subtle mine-ws__meta">{{ $t("workshop.mine.row.universalMeta") }}</p>
          <p class="mine-ws__chips"><span class="chip">{{ $t("workshop.layer.universal") }}</span></p>
        </div>
        <div class="mine-ws__actions">
          <RouterLink v-if="stageAvailable" :to="{ path: lp(`/mine/workshops/${encodeURIComponent(item.id)}/edit`), query: { scope: 'universal' } }" class="btn btn--sm">{{ $t("workshop.mine.edit") }}</RouterLink>
        </div>
      </li>
    </ul>

    <p v-if="universalFailed" class="notice notice--error" role="alert">
      {{ $t("workshop.mine.error.load") }}
      <button type="button" class="btn btn--sm" @click="load">{{ $t("library.retry") }}</button>
    </p>
    <WorkshopScopeDialog v-if="stageAvailable && picking" :initial-universal="preselectUniversal" @close="closePicker" />
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
.mine-ws__note { margin: 0; line-height: 1.5; }
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
