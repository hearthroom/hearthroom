<script setup lang="ts">
import { stageAvailable } from "@stage-site";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ApiError, fetchMyCards, type MyCard } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import {
  fetchMyWorkshops, fetchPlayerShares, markPlayerShareSeen, readPlayerShare, setPlayerShareDisplay,
  type MineItem, type PlayerShareContent, type PlayerShareItem,
} from "@/lib/workshop";
import { useWorkshopSharePending } from "@/lib/workshop-share-pending";
import CardPickerDialog from "./CardPickerDialog.vue";
import ExtensionCover from "./ExtensionCover.vue";
import LineTabs from "./LineTabs.vue";
import UndoToast from "./UndoToast.vue";

const { t, locale } = useI18n();
const { lp } = useLocalePath();
const route = useRoute();
const router = useRouter();
const session = useSession();
const { refreshPending } = useWorkshopSharePending();

type Tab = "unshown" | "showing" | "myDlc";
const tab = ref<Tab>("unshown");
const cardFilter = computed(() => typeof route.query.card === "string" ? route.query.card : "");
const cards = ref<MyCard[]>([]);
const playerShares = ref<PlayerShareItem[]>([]);
const dlcs = ref<MineItem[]>([]);
const loading = ref(true);
const failed = ref(false);
const writeFailed = ref(false);
const picking = ref(false);
const busy = ref("");
const toast = ref<InstanceType<typeof UndoToast> | null>(null);
const drawer = ref<HTMLDialogElement | null>(null);
const selected = ref<PlayerShareItem | null>(null);
const content = ref<PlayerShareContent | null>(null);
const drawerStatus = ref<"loading" | "ready" | "failed" | "withdrawn">("loading");
const drawerUpdated = ref(false);
let loadSequence = 0;
let drawerSequence = 0;

async function token() {
  const access = await session.accessToken();
  if (!access) throw new Error(t("auth.expired"));
  return access;
}

async function ownCards(access: string) {
  const items: MyCard[] = [];
  for (let page = 1; ; page++) {
    const data = await fetchMyCards(access, { provider: "harbor", page, pageSize: 100 });
    items.push(...data.items);
    if (!data.hasNext || !data.items.length) return items;
  }
}

async function load() {
  const request = ++loadSequence;
  loading.value = true;
  failed.value = false;
  try {
    const access = await token();
    const [shareResult, mine, cardRows] = await Promise.all([
      fetchPlayerShares("", access), fetchMyWorkshops(access), ownCards(access),
    ]);
    if (request !== loadSequence) return;
    playerShares.value = shareResult.items;
    dlcs.value = mine.items.filter((item) => item.kind === "dlc");
    cards.value = cardRows;
    void acknowledgeUnshown().catch(() => {});
  } catch {
    if (request === loadSequence) failed.value = true;
  } finally {
    if (request === loadSequence) loading.value = false;
  }
}

watch(() => session.me?.accountNumId, (id) => {
  playerShares.value = [];
  cards.value = [];
  dlcs.value = [];
  if (id) void load();
  else loadSequence++;
}, { immediate: true });

const selectedCard = computed(() => cards.value.find((card) =>
  [card.roleId, card.sourceRoleId, String(card.num ?? "")].includes(cardFilter.value),
));
const filterMatches = (roleId: string, number: number) => !cardFilter.value ||
  cardFilter.value === roleId || cardFilter.value === String(number) ||
  roleId === selectedCard.value?.roleId || roleId === selectedCard.value?.sourceRoleId;
const filteredShares = computed(() => playerShares.value.filter((item) => filterMatches(item.roleId, item.cardNumber)));
const filteredDLCs = computed(() => dlcs.value.filter((item) => filterMatches(item.card.roleId, item.card.num)));
const unshown = computed(() => filteredShares.value.filter((item) => item.state !== "displayed"));
const shown = computed(() => filteredShares.value.filter((item) => item.state === "displayed"));
const rows = computed(() => tab.value === "showing" ? shown.value : unshown.value);
const tabs = computed(() => [
  { key: "unshown" as const, label: t("workshop.managePage.tab.unshown"), count: unshown.value.filter((item) => item.new).length },
  { key: "showing" as const, label: t("workshop.managePage.tab.showing"), count: shown.value.length },
  { key: "myDlc" as const, label: t("workshop.managePage.tab.myDlc"), count: filteredDLCs.value.length },
]);
const selectedClosed = computed(() => !!cardFilter.value &&
  (filteredShares.value.some((item) => item.closed) || filteredDLCs.value.some((item) => item.workshopClosed)),
);
const filterValue = computed(() => selectedCard.value?.roleId ?? cardFilter.value);
const dateFormat = computed(() => new Intl.DateTimeFormat(String(locale.value), { month: "numeric", day: "numeric" }));

function selectCard(event: Event) {
  const card = (event.target as HTMLSelectElement).value;
  void router.replace({ query: { ...route.query, card: card || undefined } });
}

let acknowledging = false;
async function acknowledgeUnshown() {
  if (tab.value !== "unshown" || acknowledging) return;
  const fresh = unshown.value.filter((item) => item.new);
  if (!fresh.length) return;
  acknowledging = true;
  try {
    const access = await token();
    for (const item of fresh) {
      try {
        await markPlayerShareSeen(item, access);
        const current = playerShares.value.find((row) => row.workshopId === item.workshopId);
        if (current?.generation === item.generation) current.new = false;
      } catch {
        // A concurrent content or permission change keeps its unread marker.
      }
    }
    await refreshPending();
  } finally {
    acknowledging = false;
  }
}
watch([tab, cardFilter], () => { void acknowledgeUnshown().catch(() => {}); });

async function openContent(item: PlayerShareItem, inPlace = false) {
  const request = ++drawerSequence;
  if (!inPlace) {
    selected.value = item;
    drawerUpdated.value = item.hasUpdate;
  }
  content.value = null;
  drawerStatus.value = "loading";
  await nextTick();
  if (!drawer.value?.open) drawer.value?.showModal();
  try {
    const access = await token();
    const view = await readPlayerShare(item.workshopId, access);
    if (request !== drawerSequence) return;
    content.value = view;
    drawerUpdated.value ||= view.hasUpdate;
    drawerStatus.value = "ready";
    await markPlayerShareSeen(view, access);
    if (request !== drawerSequence) return;
    const row = playerShares.value.find((candidate) => candidate.workshopId === item.workshopId);
    if (row?.draftRevision === view.draftRevision && row.generation === view.generation) {
      row.new = false;
      row.hasUpdate = false;
    }
    void refreshPending();
  } catch (error) {
    if (request !== drawerSequence) return;
    if (error instanceof ApiError && error.status === 404) {
      content.value = null;
      drawerStatus.value = "withdrawn";
      playerShares.value = playerShares.value.filter((row) => row.workshopId !== item.workshopId);
    } else if (!content.value) {
      drawerStatus.value = "failed";
    }
  }
}

function closeContent() {
  drawerSequence++;
  selected.value = null;
  content.value = null;
}

function recheckOpenContent() {
  if (document.visibilityState === "visible" && selected.value && drawer.value?.open) {
    void openContent(selected.value, true);
  }
}
onMounted(() => document.addEventListener("visibilitychange", recheckOpenContent));
onBeforeUnmount(() => {
  drawerSequence++;
  loadSequence++;
  document.removeEventListener("visibilitychange", recheckOpenContent);
});

async function setDisplay(item: PlayerShareItem, show: boolean, latest?: PlayerShareContent) {
  if (busy.value || item.closed) return;
  writeFailed.value = false;
  busy.value = item.workshopId;
  try {
    const updated = await setPlayerShareDisplay(latest ?? item, show, await token());
    const replacement = { ...item, ...updated };
    playerShares.value = playerShares.value.map((row) => row.workshopId === item.workshopId ? replacement : row);
    if (selected.value?.workshopId === item.workshopId) drawer.value?.close();
    const message = t(show ? "workshop.managePage.toast.shown" : "workshop.managePage.toast.unshown", { name: item.name });
    toast.value?.say(message, show ? undefined : () => { void setDisplay(replacement, true); });
    void refreshPending();
  } catch (error) {
    writeFailed.value = true;
    if (error instanceof ApiError && error.status === 404 && selected.value?.workshopId === item.workshopId) {
      content.value = null;
      drawerStatus.value = "withdrawn";
    }
    await load();
  } finally {
    busy.value = "";
  }
}

const editTo = (id: string) => lp(`/mine/workshops/${encodeURIComponent(id)}/edit`);
const emptyLabel = computed(() => tab.value === "showing" ? "showing" : "unshown");
</script>

<template>
  <div class="workshop-management">
    <header>
      <h2 class="display">{{ $t("workshop.managePage.title") }}</h2>
      <p class="muted ws-text">{{ $t("workshop.managePage.subtitle") }}</p>
    </header>

    <div v-if="loading" class="workshop-management__list" aria-busy="true">
      <div v-for="i in 3" :key="i" class="ghost workshop-management__ghost" />
    </div>
    <div v-else-if="failed" class="notice notice--error" role="alert">
      <p>{{ $t("workshop.managePage.state.loadFailed") }}</p>
      <button class="btn btn--sm" type="button" @click="load">{{ $t("library.retry") }}</button>
    </div>
    <div v-else-if="!cards.length && !playerShares.length && !dlcs.length" class="panel workshop-management__empty">
      <h3>{{ $t("workshop.managePage.noCards.title") }}</h3>
      <RouterLink :to="lp('/mine')" class="btn btn--primary">{{ $t("workshop.managePage.noCards.action") }}</RouterLink>
    </div>
    <template v-else>
      <label class="workshop-management__filter">
        <span class="sr-only">{{ $t("workshop.managePage.filter.label") }}</span>
        <select class="input" :value="filterValue" @change="selectCard">
          <option value="">{{ $t("workshop.managePage.filter.allCards") }}</option>
          <option v-if="cardFilter && !selectedCard" :value="cardFilter">{{ filteredShares[0]?.cardName || cardFilter }}</option>
          <option v-for="card in cards" :key="card.roleId" :value="card.roleId">{{ card.name }}</option>
        </select>
      </label>
      <LineTabs v-model="tab" :tabs="tabs" :label="$t('workshop.managePage.title')" id-prefix="workshop-management" />
      <div id="workshop-management-panel" class="workshop-management__list" role="tabpanel" :aria-labelledby="`workshop-management-tab-${tab}`">
        <p v-if="writeFailed" class="notice notice--error" role="alert">{{ $t("workshop.managePage.error.actionFailed") }}</p>
        <p v-if="selectedClosed" class="notice">{{ $t("workshop.managePage.closed.cardFilterBanner", { card: selectedCard?.name || filteredShares[0]?.cardName }) }}</p>
        <template v-if="tab === 'myDlc'">
          <div v-if="stageAvailable" class="workshop-management__tools">
            <button class="btn btn--sm" type="button" @click="picking = true">{{ $t("workshop.owner.dlc.create") }}</button>
          </div>
          <p v-if="!filteredDLCs.length" class="panel workshop-management__empty">{{ $t("workshop.managePage.empty.myDlc") }}</p>
          <article v-for="item in filteredDLCs" :key="item.id" class="workshop-management__row panel">
            <ExtensionCover :src="item.coverUrl" :name="item.name" />
            <div>
              <h3>{{ item.name || $t("workshop.mine.row.untitledDlc") }}</h3>
              <p class="muted">{{ item.card.name }} · {{ $t(item.status === "draft" ? "workshop.status.draft" : "workshop.status.published") }}</p>
            </div>
            <RouterLink v-if="stageAvailable" class="btn btn--sm workshop-management__actions" :to="editTo(item.id)">{{ $t("workshop.mine.edit") }}</RouterLink>
          </article>
        </template>
        <div v-else-if="!rows.length" class="panel workshop-management__empty">
          <template v-if="!playerShares.length && tab === 'unshown'">
            <h3>{{ $t("workshop.managePage.empty.allTitle") }}</h3>
            <p>{{ $t("workshop.managePage.empty.allBody") }}</p>
          </template>
          <p v-else>{{ $t(`workshop.managePage.empty.${emptyLabel}`) }}</p>
        </div>
        <article v-for="item in tab === 'myDlc' ? [] : rows" :key="item.workshopId" class="workshop-management__row panel">
          <ExtensionCover :src="item.coverUrl" :name="item.name" />
          <div class="workshop-management__copy">
            <h3>{{ item.name }}</h3>
            <p class="muted ws-text">
              {{ item.authorName ? `${item.authorName} · ` : "" }}#{{ item.authorNumber }} ·
              {{ $t("workshop.managePage.row.entries", { n: item.entryCount }) }} ·
              {{ $t("workshop.managePage.row.resident", { chars: item.residentChars }) }} ·
              {{ $t("workshop.managePage.row.updatedAt", { date: dateFormat.format(item.updatedAt) }) }}
              <template v-if="item.state === 'displayed'"> · {{ $t("workshop.managePage.row.joins", { count: item.joinCount }) }}</template>
            </p>
            <div class="workshop-management__chips">
              <span v-if="item.new" class="chip workshop-management__chip--new">{{ $t("workshop.managePage.chip.new") }}</span>
              <span v-if="item.state === 'displayed'" class="chip">{{ $t("workshop.managePage.chip.showing") }}</span>
              <span v-if="item.state === 'unlisted'" class="chip">{{ $t("workshop.managePage.chip.unshownByAuthor") }}</span>
              <span v-if="item.hasUpdate" class="chip workshop-management__chip--new">{{ $t("workshop.managePage.chip.updated") }}</span>
              <span v-if="!cardFilter" class="chip">{{ item.cardName }}</span>
            </div>
            <p v-if="item.closed && !cardFilter" class="muted">{{ $t("workshop.managePage.closed.rowNote") }}</p>
          </div>
          <div class="workshop-management__actions">
            <button type="button" class="btn btn--sm" @click="openContent(item)">{{ $t("workshop.managePage.action.viewContent") }}</button>
            <button type="button" class="btn btn--sm" :class="{ 'workshop-management__show': item.state !== 'displayed' }"
                    :disabled="!!busy || item.closed" @click="setDisplay(item, item.state !== 'displayed')">
              {{ $t(item.state === "displayed" ? "workshop.managePage.action.unshow" : "workshop.managePage.action.show") }}
            </button>
          </div>
        </article>
      </div>
    </template>

    <Teleport to="body">
      <dialog ref="drawer" class="workshop-management__drawer panel" aria-labelledby="workshop-review-title" @close="closeContent">
        <header class="workshop-management__drawer-head">
          <h2 id="workshop-review-title">{{ content?.name || selected?.name || $t("workshop.managePage.action.viewContent") }}</h2>
          <button class="btn btn--sm" type="button" autofocus @click="drawer?.close()">{{ $t("dialog.close") }}</button>
        </header>
        <div v-if="drawerStatus === 'loading'" class="ghost workshop-management__ghost" aria-busy="true" />
        <p v-else-if="drawerStatus === 'withdrawn'" class="notice" role="status">{{ $t("workshop.managePage.drawer.withdrawnBanner") }}</p>
        <div v-else-if="drawerStatus === 'failed' && selected" class="notice notice--error" role="alert">
          <p>{{ $t("workshop.managePage.state.loadFailed") }}</p>
          <button class="btn btn--sm" type="button" @click="openContent(selected, true)">{{ $t("library.retry") }}</button>
        </div>
        <div v-else-if="content && selected" class="workshop-management__drawer-body">
          <p class="muted ws-text">{{ $t("workshop.managePage.drawer.hint") }}</p>
          <p v-if="drawerUpdated" class="notice">{{ $t("workshop.managePage.drawer.updatedNotice") }}</p>
          <p class="ws-text">{{ content.summary }}</p>
          <article v-for="(entry, index) in content.entries" :key="entry.id || entry.entryId || index" class="panel workshop-management__entry">
            <h3>{{ entry.name }}</h3>
            <p v-if="entry.keywords?.length" class="muted ws-text">{{ $t("workshop.managePage.drawer.entryKeywords", { keywords: entry.keywords.join(", ") }) }}</p>
            <p class="workshop-management__entry-content">{{ entry.content }}</p>
          </article>
          <p class="muted ws-text">{{ $t("workshop.managePage.drawer.withdrawNote") }}</p>
          <p v-if="content.state === 'displayed'" class="muted ws-text">{{ $t("workshop.managePage.drawer.unshowHint") }}</p>
          <button type="button" class="btn" :class="{ 'btn--primary': content.state !== 'displayed' }"
                  :disabled="!!busy || selected.closed" @click="setDisplay(selected, content.state !== 'displayed', content)">
            {{ $t(content.state === "displayed" ? "workshop.managePage.action.unshow" : "workshop.managePage.action.show") }}
          </button>
        </div>
      </dialog>
    </Teleport>
    <CardPickerDialog v-if="stageAvailable && picking" dlc-only @close="picking = false" />
    <UndoToast ref="toast" />
  </div>
</template>

<style scoped>
.workshop-management, .workshop-management__list, .workshop-management__drawer-body { display: grid; gap: var(--s-3); min-width: 0; }
.workshop-management h2, .workshop-management h3, .workshop-management p, .workshop-management__drawer :is(h2, h3, p) { margin: 0; }
.workshop-management header { display: grid; gap: var(--s-2); }
.workshop-management .line-tabs { flex: none; }
.workshop-management__filter { width: min(100%, 380px); }
.workshop-management__filter select { width: 100%; }
.workshop-management__row { display: grid; grid-template-columns: 120px minmax(0, 1fr) auto; gap: var(--s-3); align-items: start; padding: var(--s-3); }
.workshop-management__copy { display: grid; gap: var(--s-1); min-width: 0; overflow-wrap: anywhere; }
.workshop-management__chips, .workshop-management__actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-1); }
.workshop-management__actions { justify-content: flex-end; justify-self: end; }
.workshop-management__actions .btn { min-height: 44px; }
.workshop-management__show { border-color: var(--accent); color: var(--accent-text); }
.workshop-management__chip--new { border-color: var(--accent); color: var(--accent-text); }
.workshop-management__ghost { min-height: 96px; }
.workshop-management__tools { display: flex; justify-content: flex-end; }
.workshop-management__empty { padding: var(--s-6); display: grid; gap: var(--s-3); text-align: center; justify-items: center; }
.workshop-management__drawer { inset: 0 0 0 auto; margin: 0; width: min(100%, 580px); height: 100dvh; max-height: 100dvh; max-width: 100%; overflow: auto; padding: var(--s-5); color: var(--text); background: var(--surface); }
.workshop-management__drawer::backdrop { background: var(--overlay, #0008); }
.workshop-management__drawer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-4); }
.workshop-management__drawer-head h2 { overflow-wrap: anywhere; }
.workshop-management__entry { padding: var(--s-3); display: grid; gap: var(--s-2); }
.workshop-management__entry-content { white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .workshop-management__row { grid-template-columns: 72px minmax(0, 1fr); }
  .workshop-management__actions { grid-column: 1 / -1; }
  .workshop-management__drawer { padding: var(--s-4); }
}
</style>
