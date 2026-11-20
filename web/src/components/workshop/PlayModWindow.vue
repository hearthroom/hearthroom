<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import ExtensionCover from "./ExtensionCover.vue";
import PlayPrivateModEntries from "./PlayPrivateModEntries.vue";
import { ApiError } from "@/lib/api";
import { fetchConversationMods, applyConversationMod, listUniversalMods } from "@/lib/workshop";
import type { ConversationMod, ConversationMods, ModAction, UniversalModChoice } from "@/lib/workshop-mods";
import { useLocalePath } from "@/lib/use-locale";

const props = defineProps<{
  open: boolean;
  conversationId: string;
  token: () => Promise<string | null>;
  browseHref: string;
  acceptedTurn: number;
  settingsChanged: number;
  capacityPending?: boolean;
}>();
const emit = defineEmits<{ close: []; changed: [view: ConversationMods]; capacity: [] }>();
const { t, n } = useI18n();
const { lp } = useLocalePath();
const tr = (key: string, params: Record<string, string | number> = {}) => t("workshop.window." + key, params);
const dialog = ref<HTMLDialogElement | null>(null);
const view = shallowRef<ConversationMods>();
const loading = ref(false);
const loadFailed = ref(false);
const busy = ref(false);
const pendingRow = ref("");
const sorted = ref(false);
const privateOpen = ref(false);
const universalOpen = ref(false);
const universalChoices = shallowRef<UniversalModChoice[]>([]);
const universalLoading = ref(false);
const universalFailed = ref(false);
const changed = ref(false);
const refreshed = ref(false);
const expanded = ref<string[]>([]);
const failure = shallowRef<{ row: string; action: ModAction }>();
let loadSequence = 0;
let refreshAfterWrite = false;
let universalRequest = 0;

const items = computed(() => view.value?.items ?? []);
const onCount = computed(() => items.value.filter(item => item.status === "resident" || item.status === "triggered").length);
const noticeCount = computed(() => Number(!!props.capacityPending) + Number(!!view.value?.triggeredCount));
const slotsAfterOpening = computed(() => noticeCount.value + Number(!!view.value?.openingName) < 2);
const isExpanded = (item: ConversationMod) => expanded.value.includes(item.workshopId);
const rowActive = (item: ConversationMod) => item.status === "resident" || item.status === "triggered";

async function auth() {
  const token = await props.token();
  if (!token) throw new Error("Missing workshop session");
  return token;
}

async function load() {
  const sequence = ++loadSequence;
  const id = props.conversationId;
  loading.value = true;
  loadFailed.value = false;
  try {
    const next = await fetchConversationMods(id, await auth());
    if (sequence === loadSequence) {
      view.value = next;
      if (!next.workshopClosed) void loadUniversalChoices();
    }
  } catch {
    if (sequence === loadSequence) loadFailed.value = true;
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

watch(() => props.conversationId, () => {
  loadSequence++;
  refreshAfterWrite = false;
  loading.value = false;
  view.value = undefined;
  sorted.value = false;
  privateOpen.value = false;
  universalOpen.value = false;
  universalRequest++;
  universalChoices.value = [];
  universalLoading.value = false;
  expanded.value = [];
  changed.value = false;
  refreshed.value = false;
  failure.value = undefined;
  busy.value = false;
  pendingRow.value = "";
});
watch(() => props.open, async open => {
  if (open) {
    await nextTick();
    if (!props.open) return;
    if (!dialog.value?.open) dialog.value?.showModal();
    if (busy.value) refreshAfterWrite = true;
    else void load();
  } else {
    dialog.value?.close();
  }
}, { immediate: true });
watch(() => props.acceptedTurn, () => { changed.value = false; });
watch(() => props.settingsChanged, () => {
  changed.value = true;
  if (!props.open) return;
  if (busy.value) refreshAfterWrite = true;
  else void load();
});

function expand(item: ConversationMod) {
  expanded.value = isExpanded(item)
    ? expanded.value.filter(id => id !== item.workshopId)
    : [...expanded.value, item.workshopId];
}

async function mutate(action: ModAction, row: string, version = view.value?.version) {
  if (!version || busy.value || loading.value) return false;
  const id = props.conversationId;
  const accepted = props.acceptedTurn;
  busy.value = true;
  pendingRow.value = row;
  failure.value = undefined;
  refreshed.value = false;
  try {
    const next = await applyConversationMod(id, version, action, await auth());
    if (id !== props.conversationId) return false;
    loadSequence++;
    loading.value = false;
    view.value = next;
    if (accepted === props.acceptedTurn) changed.value = true;
    emit("changed", next);
    return true;
  } catch (err) {
    if (id !== props.conversationId) return false;
    if (err instanceof ApiError && err.status === 409) {
      await load();
      refreshed.value = !loadFailed.value;
    } else {
      failure.value = { row, action };
    }
    return false;
  } finally {
    if (id === props.conversationId) {
      busy.value = false;
      pendingRow.value = "";
      if (refreshAfterWrite && props.open) void load();
      refreshAfterWrite = false;
    }
  }
}
function move(index: number, direction: number) {
  const order = items.value.map(item => item.workshopId);
  const from = order[index];
  const to = order[index + direction];
  if (!from || !to) return;
  order[index] = to;
  order[index + direction] = from;
  void mutate({ action: "order", order }, from);
}
function rowError(action: ModAction) {
  return action.action === "order" ? "error.sortFailed"
    : action.action === "toggle" || action.action === "packs" ? "error.toggleFailed" : "error.actionFailed";
}
const scrollArea = ref<HTMLElement | null>(null);
let listScroll = 0;
function openPrivate() {
  listScroll = scrollArea.value?.scrollTop ?? 0;
  privateOpen.value = true;
  void nextTick(() => dialog.value?.querySelector<HTMLElement>("[data-mod-back]")?.focus());
}
async function loadUniversalChoices() {
  const request = ++universalRequest;
  universalLoading.value = true;
  universalFailed.value = false;
  try {
    const data = await listUniversalMods(await auth(), props.conversationId);
    if (request === universalRequest) universalChoices.value = data.items;
  } catch {
    if (request === universalRequest) universalFailed.value = true;
  } finally {
    if (request === universalRequest) universalLoading.value = false;
  }
}
function openUniversal() {
  listScroll = scrollArea.value?.scrollTop ?? 0;
  universalOpen.value = true;
  void loadUniversalChoices();
  void nextTick(() => dialog.value?.querySelector<HTMLElement>("[data-universal-back]")?.focus());
}
async function joinUniversal(item: UniversalModChoice) {
  if (await mutate({ action: "join_universal", workshopId: item.id }, item.id)) {
    universalChoices.value = universalChoices.value.map((choice) => choice.id === item.id ? { ...choice, joined: true } : choice);
  }
}
function returnToList() {
  const selector = universalOpen.value ? "[data-mod-universal]" : "[data-mod-private]";
  privateOpen.value = false;
  universalOpen.value = false;
  void nextTick(() => {
    if (scrollArea.value) scrollArea.value.scrollTop = listScroll;
    dialog.value?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  });
}
async function saveNotice() {
  const accepted = props.acceptedTurn;
  await load();
  if (accepted === props.acceptedTurn) changed.value = true;
  if (view.value) emit("changed", view.value);
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog" class="mod-window" :aria-labelledby="view?.workshopClosed ? 'play-mod-title' : universalOpen ? 'play-universal-title' : privateOpen ? 'play-private-mod-title' : 'play-mod-title'"
      @cancel.prevent="emit('close')" @click.self="emit('close')"
    >
      <PlayPrivateModEntries
        v-if="conversationId" v-show="privateOpen && !view?.workshopClosed"
        :key="conversationId" :shown="open && privateOpen && !view?.workshopClosed"
        :conversation-id="conversationId" :auth="auth" :change-entry="mutate" :settings-busy="busy || loading"
        :version="view?.version" @back="returnToList" @close="emit('close')" @saved="saveNotice"
      />
      <section v-if="universalOpen && !view?.workshopClosed" class="mod-window__section">
        <header class="mod-window__head">
          <button type="button" class="btn btn--ghost mod-window__icon" data-universal-back :aria-label="t('workshop.mineEntries.back')" @click="returnToList">←</button>
          <h2 id="play-universal-title">{{ tr("universal.title") }}</h2>
          <button class="btn btn--ghost mod-window__icon" type="button" :aria-label="tr('close')" @click="emit('close')">×</button>
        </header>
        <div class="mod-window__scroll">
          <p class="mod-window__muted">{{ tr("universal.subtitle") }}</p>
          <p v-if="universalFailed" class="mod-window__notice" role="alert">
            {{ tr("state.loadFailed") }}
            <button class="btn" type="button" @click="loadUniversalChoices">{{ tr("state.retry") }}</button>
          </p>
          <div v-else-if="universalLoading && !universalChoices.length" class="mod-window__skeleton" aria-busy="true" />
          <div v-else-if="!universalChoices.length" class="mod-window__empty">
            <strong>{{ tr("universal.emptyTitle") }}</strong>
            <p>{{ tr("universal.emptyBody") }}</p>
            <a class="btn btn--primary" :href="lp('/mine?tab=workshops&new=universal')" target="_blank" rel="noopener">{{ tr("universal.createAction") }}</a>
          </div>
          <ul v-else class="mod-window__list">
            <li v-for="item in universalChoices" :key="item.id">
              <div class="mod-window__row" :aria-busy="pendingRow === item.id || undefined">
                <ExtensionCover class="mod-window__cover" :src="''" :name="item.name" square />
                <div class="mod-window__row-copy">
                  <strong>{{ item.name || t("workshop.mine.row.untitled") }}</strong>
                  <span class="mod-window__muted">{{ tr("row.resident", { chars: n(item.residentChars) }) }}</span>
                </div>
                <span v-if="item.joined || items.some(row => row.workshopId === item.id)" class="chip">{{ tr("universal.joinedChip") }}</span>
                <button v-else type="button" class="btn mod-window__universal-join" :disabled="busy || loading || universalLoading" @click="joinUniversal(item)">{{ tr("universal.joinAction") }}</button>
              </div>
              <p v-if="failure?.row === item.id" class="mod-window__row-error" role="alert">{{ tr("error.actionFailed") }}</p>
            </li>
          </ul>
        </div>
        <footer class="mod-window__foot">
          <a :href="lp('/mine?tab=workshops')" target="_blank" rel="noopener">{{ tr("universal.manageLink") }} <span class="sr-only">{{ tr("footer.newTabSr") }}</span></a>
        </footer>
      </section>
      <section v-show="(!privateOpen && !universalOpen) || view?.workshopClosed" class="mod-window__section">
        <header class="mod-window__head">
          <h2 id="play-mod-title">{{ tr("title") }}</h2>
          <button class="btn btn--ghost mod-window__icon" type="button" :aria-label="tr('close')" autofocus @click="emit('close')">×</button>
        </header>
        <div ref="scrollArea" class="mod-window__scroll">
          <p class="mod-window__muted">{{ tr("subtitle") }}</p>
          <p v-if="changed" role="status" class="mod-window__notice">{{ tr("status.changed") }}</p>
          <p v-if="refreshed" role="status" class="mod-window__notice">{{ tr("notice.refreshed") }}</p>
          <div v-if="loadFailed" role="alert" class="mod-window__notice">
            {{ tr("state.loadFailed") }} <button class="btn" type="button" @click="load">{{ tr("state.retry") }}</button>
          </div>
          <div v-else-if="!view && loading" class="mod-window__skeleton" aria-busy="true" />
          <template v-else-if="view">
            <p v-if="view.workshopClosed" class="mod-window__notice" data-mod-paused>{{ tr("notice.closed") }}</p>
            <template v-else>
              <p v-if="capacityPending" class="mod-window__notice">
                {{ tr("notice.overCapacity") }} <button class="btn" type="button" @click="emit('capacity')">{{ tr("notice.overCapacityAction") }}</button>
              </p>
              <p v-if="view.triggeredCount" class="mod-window__notice">{{ tr("notice.demoted", { n: view.triggeredCount }) }}</p>
              <p v-if="view.openingName && noticeCount < 2" class="mod-window__notice">{{ tr("notice.openingFrom", { name: view.openingName }) }}</p>
              <div v-if="view.availableCount && slotsAfterOpening" class="mod-window__notice">
                {{ tr("notice.newlyAdded", { n: view.availableCount }) }}
                <button class="btn" type="button" :disabled="busy || loading" @click="mutate({ action: 'add' }, 'add')">{{ tr("notice.newlyAddedAction") }}</button>
                <p v-if="failure?.row === 'add'" role="alert">
                  {{ tr(rowError(failure.action)) }}
                  <button class="btn btn--ghost" type="button" :disabled="busy || loading" @click="mutate(failure.action, 'add')">{{ tr("state.retry") }}</button>
                </p>
              </div>
            </template>

            <div v-if="!items.length && !view.workshopClosed" class="mod-window__empty">
              <strong>{{ tr("empty.title") }}</strong>
              <p>{{ tr("empty.body") }}</p>
              <a v-if="browseHref" class="btn btn--primary" :href="browseHref" target="_blank" rel="noopener">
                {{ tr("footer.browse") }} <span class="sr-only">{{ tr("footer.newTabSr") }}</span>
              </a>
            </div>
            <div v-if="items.length || view.workshopClosed" class="mod-window__list-head">
              <strong>{{ view.workshopClosed ? tr("list.paused") : tr("list.count", { on: onCount, total: items.length }) }}</strong>
              <button class="btn btn--ghost" type="button" :disabled="busy || loading || view.workshopClosed || items.length < 2" @click="sorted = !sorted">
                {{ tr(sorted ? "list.sortDone" : "list.sort") }}
              </button>
            </div>
            <p v-if="sorted && !view.workshopClosed" class="mod-window__muted">{{ tr("list.sortHint") }}</p>
            <ul class="mod-window__list">
              <li v-for="(item, index) in items" :key="item.workshopId">
                <div class="mod-window__row" :aria-busy="pendingRow === item.workshopId || undefined"
                     :class="{ 'mod-window__row--muted': item.status === 'removed' || view.workshopClosed }">
                  <button
                    v-if="item.packs?.length && !sorted" class="btn btn--ghost mod-window__icon" type="button"
                    :disabled="!rowActive(item) || view.workshopClosed" :aria-expanded="rowActive(item) && isExpanded(item)"
                    :aria-label="tr(isExpanded(item) ? 'a11y.collapsePacks' : 'a11y.expandPacks', { name: item.name })"
                    @click="expand(item)"
                  >{{ isExpanded(item) && rowActive(item) ? "⌄" : "›" }}</button>
                  <ExtensionCover class="mod-window__cover" :src="item.coverUrl ?? ''" :name="item.name" square />
                  <div class="mod-window__row-copy">
                    <strong>{{ item.name }}</strong>
                    <div class="mod-window__meta">
                      <span class="chip">{{ tr(item.kind === "dlc" ? "layer.dlc" : item.kind === "universal" ? "layer.universal" : "layer.ext") }}</span>
                      <span v-if="item.status === 'removed'">{{ tr("row.removedChip") }} · {{ tr("row.removedSub") }}</span>
                      <span v-else-if="view.workshopClosed || !item.enabled">{{ tr(item.enabled ? "row.pausedChip" : "row.offChip") }}</span>
                      <template v-else>
                        <span v-if="item.status === 'triggered'">{{ tr("row.demoted") }}</span>
                        <span v-if="item.residentChars">{{ tr("row.resident", { chars: n(item.residentChars) }) }}</span>
                        <span v-if="item.packs?.length">{{ tr("row.packCount", { on: item.packs.filter(pack => pack.enabled).length, total: item.packs.length }) }}</span>
                      </template>
                    </div>
                  </div>
                  <template v-if="sorted && !view.workshopClosed">
                    <button class="btn btn--ghost mod-window__icon" type="button" :aria-label="tr('a11y.moveUp', { name: item.name })" :disabled="busy || loading || index === 0" @click="move(index, -1)">↑</button>
                    <button class="btn btn--ghost mod-window__icon" type="button" :aria-label="tr('a11y.moveDown', { name: item.name })" :disabled="busy || loading || index === items.length - 1" @click="move(index, 1)">↓</button>
                  </template>
                  <button
                    v-else-if="item.status === 'removed'" class="btn btn--ghost" type="button" :disabled="busy || loading || view.workshopClosed"
                    @click="mutate({ action: 'remove', workshopId: item.workshopId }, item.workshopId)"
                  >{{ tr("row.removeAction") }}</button>
                  <button
                    v-else class="mod-window__switch" role="switch" type="button" :aria-checked="item.enabled"
                    :aria-label="tr('a11y.toggle', { name: item.name })" :disabled="busy || loading || view.workshopClosed"
                    @click="mutate({ action: 'toggle', workshopId: item.workshopId, enabled: !item.enabled }, item.workshopId)"
                  ><span /></button>
                </div>
                <ul v-if="!sorted && !view.workshopClosed && rowActive(item) && isExpanded(item)" class="mod-window__packs">
                  <li v-if="item.scriptCanSwitchPacks" class="mod-window__muted">{{ tr("pack.scriptManagedHint") }}</li>
                  <li v-for="pack in item.packs" :key="pack.id" class="mod-window__row">
                    <div class="mod-window__row-copy">
                      <strong>{{ pack.name }}</strong>
                      <div class="mod-window__meta">
                        <span v-if="pack.description">{{ pack.description }}</span>
                        <span v-if="pack.residentChars">{{ tr("row.resident", { chars: n(pack.residentChars) }) }}</span>
                      </div>
                    </div>
                    <button
                      class="mod-window__switch mod-window__switch--pack" role="switch" type="button" :aria-checked="pack.enabled"
                      :aria-label="tr('pack.a11yToggle', { name: pack.name })" :disabled="busy || loading"
                      @click="mutate({ action: 'packs', packs: [{ workshopId: item.workshopId, packId: pack.id, enabled: !pack.enabled }] }, item.workshopId)"
                    ><span /></button>
                  </li>
                </ul>
                <p v-if="failure?.row === item.workshopId" class="mod-window__row-error" role="alert">
                  {{ tr(rowError(failure.action)) }}
                  <button class="btn btn--ghost" type="button" :disabled="busy || loading" @click="mutate(failure.action, item.workshopId)">{{ tr("state.retry") }}</button>
                </p>
              </li>
              <li v-if="!sorted || view.workshopClosed">
                <button class="mod-window__private" type="button" data-mod-private :disabled="view.workshopClosed" @click="openPrivate">
                  <span class="mod-window__row-copy">
                    <strong>{{ t("workshop.mineEntries.title") }}</strong>
                    <span v-if="view.workshopClosed" class="mod-window__muted">{{ t("workshop.mineEntries.rowSubClosed") }}</span>
                    <span v-else class="mod-window__muted">{{ view.privateEntryCount
                      ? t("workshop.mineEntries.rowSubCount", { on: view.activePrivateEntryCount, total: view.privateEntryCount })
                      : t("workshop.mineEntries.rowSubEmpty") }}</span>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              </li>
              <li v-if="!sorted && !view.workshopClosed && (items.length || universalChoices.length)">
                <button type="button" class="btn" data-mod-universal @click="openUniversal">{{ tr("universal.addEntry") }}</button>
              </li>
            </ul>
          </template>
        </div>
        <footer v-if="browseHref && view && !view.workshopClosed && items.length" class="mod-window__foot">
          <a :href="browseHref" target="_blank" rel="noopener">
            {{ tr("footer.browse") }} <span class="sr-only">{{ tr("footer.newTabSr") }}</span>
          </a>
        </footer>
      </section>
    </dialog>
  </Teleport>
</template>
