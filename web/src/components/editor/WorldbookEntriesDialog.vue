<script setup lang="ts">
/**
 * 世界書條目管理。
 *
 * 為什麼是彈窗而不是表單裡的一段：一本書幾十條，攤在建卡表單的中欄裡找一條要捲半天，
 * 而條目本身欄位又多（關鍵詞、次要關鍵詞、分類、觸發區域、匹配方式、內容）。左邊一覽、
 * 右邊編一條，是這個站的正則規則面板已經在用的形狀，兩邊維持同一套操作。
 *
 * Teleport 到 body 是必要的，不是偏好：這個元件掛在建卡表單的分區裡，那條路徑上有祖先
 * 建立了層疊上下文，position: fixed 會被關在裡面、z-index 只在那個上下文內比大小——
 * 先前那版「鋪滿整頁」就是這樣被右欄的預覽卡壓在下面的。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import type { WorldbookEntryDraft, WorldbookMatchOptions } from "@/lib/role-draft";
import { entryContentMax } from "@/lib/tavern";
import { looksLikeBareRegex } from "@/lib/lorebook-regex";
import WorkshopPackOptions from "@/components/workshop/WorkshopPackOptions.vue";
import { WORKSHOP_INLINE_PACKS, WORKSHOP_PACK_LIMIT } from "@/lib/workshop-mods";
import type { LorePackDraft } from "@/lib/workshop";

const props = defineProps<{
  modelValue: WorldbookEntryDraft[];
  /** 這本書所綁的卡的語區：條目內容上限跟著它走。 */
  language: string;
  /** 整本已啟用條目的有效字數（格式化後的數字字串；算不出時為 null）。 */
  totalChars?: string | null;
  lorePacks?: LorePackDraft[];
}>();
const emit = defineEmits<{
  "update:modelValue": [WorldbookEntryDraft[]];
  "update:lorePacks": [LorePackDraft[]];
  close: [];
}>();

const { t } = useI18n();

const NAME_MAX = 20;
const contentMax = computed(() => entryContentMax(props.language));
const CATEGORIES = ["character", "location", "item", "event", "rule", "custom"];
const TRIGGER_REGIONS = ["both", "user_only", "ai_only"];
const SELECTIVE_LOGIC = [0, 1, 2, 3];

const commit = (next: WorldbookEntryDraft[]) => emit("update:modelValue", next);

/** 選中的是第幾條。條目沒有穩定的本地 id（新加的還沒有 entryId），所以每次改動順序或刪除都要跟著調。 */
const selected = ref(props.modelValue.length ? 0 : -1);
const entry = computed(() => props.modelValue[selected.value] ?? null);

const primaryRegexHint = computed(() => entry.value?.keywords.some(looksLikeBareRegex) ?? false);
const secondaryRegexHint = computed(() => entry.value?.secondaryKeywords?.some(looksLikeBareRegex) ?? false);

const query = ref("");
const packFilter = ref("");
const largePackList = computed(() => (props.lorePacks?.length ?? 0) > WORKSHOP_INLINE_PACKS);
const packPicker = ref<HTMLDialogElement | null>(null);
const packPickerMode = ref<"filter" | "assign">("filter");
const pickerOpen = ref(false);
function openPackPicker(mode: typeof packPickerMode.value) {
  packPickerMode.value = mode;
  pickerOpen.value = true;
  packPicker.value?.showModal();
}
function selectPack(id: string) {
  if (packPickerMode.value === "filter") packFilter.value = id;
  else patch({ packId: id || undefined });
  packPicker.value?.close();
}
const batch = ref(false);
const selection = ref<number[]>([]);
const moveDialog = ref<HTMLDialogElement | null>(null);
const moveOpen = ref(false);
const targetPack = ref<string | null>(null);
const newPack = ref("");
const NEW_PACK = "new";
const availablePack = computed(() => new Map(props.lorePacks?.map(pack => [pack.id, pack.name])));
const newPackError = computed(() => {
  const name = newPack.value.trim();
  if (Array.from(name).length > 12) return t("wb.packs.form.nameTooLong", { max: 12 });
  if (props.lorePacks?.some(pack => pack.name.trim().toLowerCase() === name.toLowerCase())) return t("wb.packs.form.nameTaken");
  return "";
});

function setSelection(index: number, checked: boolean) {
  selection.value = checked ? [...selection.value, index] : selection.value.filter(value => value !== index);
}
function cancelBatch() {
  batch.value = false;
  selection.value = [];
}
function openMoveDialog() {
  targetPack.value = null;
  newPack.value = "";
  moveOpen.value = true;
  moveDialog.value?.showModal();
}
function saveMove() {
  if (!props.lorePacks || !selection.value.length || targetPack.value === null) return;
  let packId = targetPack.value || undefined;
  if (packId === NEW_PACK) {
    if (!newPack.value.trim() || newPackError.value || props.lorePacks.length >= WORKSHOP_PACK_LIMIT) return;
    packId = crypto.randomUUID();
    emit("update:lorePacks", [...props.lorePacks, { id: packId, name: newPack.value.trim(), defaultEnabled: true }]);
  }
  const picked = new Set(selection.value);
  commit(props.modelValue.map((row, index) => picked.has(index) ? { ...row, packId } : row));
  moveDialog.value?.close();
  cancelBatch();
}
const visible = computed(() => {
  const q = query.value.trim().toLowerCase();
  const rows = props.modelValue.map((row, index) => ({ row, index }))
    .filter(({ row }) => !packFilter.value || (row.packId ?? "unpacked") === packFilter.value);
  if (!q) return rows;
  return rows.filter(({ row }) =>
    [row.name, row.content, row.keywords.join(" "), (row.secondaryKeywords ?? []).join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
});

/** Only mount the viewport and a few neighbours. Heights are measured rather than fixed:
 * constant entries without keywords are shorter, and translated controls can change height. */
const rowsElement = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(600);
const measuredHeights = new WeakMap<WorldbookEntryDraft, number>();
const measurements = ref(0);
const GAP = 2;
const OVERSCAN = 4;
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);
const offsets = computed(() => {
  void measurements.value;
  const result = [0];
  for (const { row } of visible.value) result.push(result[result.length - 1] + (measuredHeights.get(row) ?? 48) + GAP);
  return result;
});
function positionAt(y: number) {
  const ends = offsets.value;
  let low = 0, high = visible.value.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ends[middle + 1] <= y) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, Math.max(0, visible.value.length - 1));
}
const windowRange = computed(() => {
  const top = Math.min(scrollTop.value, Math.max(0, offsets.value.at(-1)! - viewportHeight.value));
  const start = Math.max(0, positionAt(top) - OVERSCAN);
  const end = Math.min(visible.value.length, positionAt(top + viewportHeight.value) + OVERSCAN + 1);
  return { start, end };
});
const windowRows = computed(() => {
  const rows = visible.value.slice(windowRange.value.start, windowRange.value.end);
  // A native drag is cancelled when its source node is removed. Keep that single
  // keyed node mounted at its book offset while the viewport moves past it.
  const source = dragFrom.value;
  if (source !== null && !rows.some(item => item.index === source)) {
    const item = visible.value.find(item => item.index === source);
    if (item) { rows.push(item); rows.sort((a, b) => a.index - b.index); }
  }
  return rows;
});
function pinnedDragStyle(index: number) {
  if (dragFrom.value !== index) return undefined;
  const position = visible.value.findIndex(item => item.index === index);
  if (position >= windowRange.value.start && position < windowRange.value.end) return undefined;
  return { position: 'absolute' as const, top: `${offsets.value[position]}px`, left: '0', right: '0' };
}
const spacerHeights = computed(() => ({
  before: Math.max(0, offsets.value[windowRange.value.start] - GAP),
  after: Math.max(0, offsets.value.at(-1)! - GAP - offsets.value[windowRange.value.end]),
}));
function onListScroll() {
  const el = rowsElement.value;
  if (el) { scrollTop.value = el.scrollTop; viewportHeight.value = el.clientHeight || 600; }
}
function revealPosition(position: number) {
  const el = rowsElement.value;
  if (!el || position < 0) return;
  const top = offsets.value[position], bottom = offsets.value[position + 1];
  if (top < el.scrollTop) el.scrollTop = top;
  else if (bottom > el.scrollTop + viewportHeight.value) el.scrollTop = bottom - viewportHeight.value;
  onListScroll();
}
async function revealSelected() {
  await nextTick();
  revealPosition(visible.value.findIndex(item => item.index === selected.value));
}
let observer: ResizeObserver | undefined;
function observeRows() {
  const el = rowsElement.value;
  if (!el) return;
  observer?.disconnect();
  observer?.observe(el);
  for (const child of el.children) observer?.observe(child);
}
onMounted(() => {
  onListScroll();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(records => {
      let changed = false;
      for (const record of records) {
        if (record.target === rowsElement.value) { onListScroll(); continue; }
        const index = Number((record.target as HTMLElement).dataset.rowIndex);
        const row = props.modelValue[index];
        const height = record.target.getBoundingClientRect().height;
        if (row && height > 0 && measuredHeights.get(row) !== height) { measuredHeights.set(row, height); changed = true; }
      }
      if (changed) measurements.value++;
    });
    observeRows();
  }
});
onBeforeUnmount(() => observer?.disconnect());
watch(windowRows, () => { observeRows(); }, { flush: 'post' });
watch([query, packFilter], () => {
  if (rowsElement.value) rowsElement.value.scrollTop = 0;
  scrollTop.value = 0;
});
/** Native Tab handles mounted rows. At a window edge, mount the adjacent row before
 * handing focus over so a keyboard user can still reach every control in book order. */
async function onListKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const target = event.target as HTMLElement;
  const row = target.closest<HTMLElement>('.wbd__row');
  if (!row) return;
  const controls = [...row.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
  const forward = !event.shiftKey;
  if (target !== (forward ? controls.at(-1) : controls[0])) return;
  const position = visible.value.findIndex(item => item.index === Number(row.dataset.rowIndex));
  const next = position + (forward ? 1 : -1);
  if (next < 0 || next >= visible.value.length) return;
  // Let the browser move between rows already in the DOM.
  if (next >= windowRange.value.start && next < windowRange.value.end) return;
  event.preventDefault();
  await focusPosition(next, forward);
}
async function focusPosition(position: number, first: boolean) {
  revealPosition(position);
  await nextTick();
  const mounted = rowsElement.value?.querySelector<HTMLElement>(`[data-row-index="${visible.value[position].index}"]`);
  const controls = mounted?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
  (first ? controls?.[0] : controls?.[controls.length - 1])?.focus();
}

function patch(changes: Partial<WorldbookEntryDraft>) {
  if (selected.value < 0) return;
  const next = props.modelValue.slice();
  next[selected.value] = { ...next[selected.value], ...changes };
  commit(next);
}

function patchMatch(changes: Partial<WorldbookMatchOptions>) {
  const current = entry.value?.matchOptions;
  if (!current) return;
  patch({ matchOptions: { ...current, ...changes } });
}

/** 清單上的勾選：改的是那一條，不一定是右邊正在編的那條。 */
function setEnabled(index: number, isEnabled: boolean) {
  const next = props.modelValue.slice();
  next[index] = { ...next[index], isEnabled };
  commit(next);
}

function add() {
  commit([
    ...props.modelValue,
    { name: "", content: "", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: false, semanticRecall: true, category: "custom",
      ...(packFilter.value && availablePack.value.has(packFilter.value) ? { packId: packFilter.value } : {}) },
  ]);
  selected.value = props.modelValue.length;
  query.value = "";
  void revealSelected();
}

async function remove(index: number) {
  const row = props.modelValue[index];
  // 已經在上游存在的條目，刪掉是真的會消失；還沒存過的只是移出這份草稿，不必問。
  if (row.entryId && !(await confirmDialog({ message: t("wb.entry.deleteConfirm"), confirmText: t("wb.entry.delete"), danger: true }))) return;
  const wasSelected = selected.value === index;
  commit(props.modelValue.filter((_, i) => i !== index));
  if (selected.value === index) selected.value = Math.min(index, props.modelValue.length - 2);
  else if (selected.value > index) selected.value -= 1;
  if (wasSelected) void revealSelected();
}

/**
 * 換順序。這不只是整理：常駐條目每輪有上限，擠不下時上游留的是排在前面的幾條。
 * 過濾中不給拖——畫面上只有一部分條目，放下去要落在哪一格沒有一個誠實的答案。
 */
const canOrder = computed(() => !batch.value && !packFilter.value && !query.value.trim() && props.modelValue.length > 1);

function onDrop(to: number) {
  const from = dragFrom.value;
  dragFrom.value = null;
  dragOver.value = null;
  if (from === null || from === to) return;
  const wasSelected = selected.value === from;
  const next = props.modelValue.slice();
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  commit(next);
  if (selected.value === from) selected.value = to;
  else if (from < selected.value && to >= selected.value) selected.value -= 1;
  else if (from > selected.value && to <= selected.value) selected.value += 1;
  if (wasSelected) void revealSelected();
}

/** 鍵盤也要能換：只有拖放的話，用鍵盤的人等於沒有這個功能。 */
function move(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= props.modelValue.length) return;
  const wasSelected = selected.value === index;
  const next = props.modelValue.slice();
  [next[index], next[target]] = [next[target], next[index]];
  commit(next);
  if (selected.value === index) selected.value = target;
  else if (selected.value === target) selected.value = index;
  if (wasSelected) void revealSelected();
}

const splitKeywords = (raw: string) => raw.split(/[、,，]+/).map((k) => k.trim()).filter(Boolean);
const summary = (row: WorldbookEntryDraft) => {
  const parts = [row.keywords.join("、")];
  if (row.secondaryKeywords?.length) parts.push(`+ ${row.secondaryKeywords.join("、")}`);
  return parts.filter(Boolean).join("  ");
};

// 條目全刪光之後右邊沒東西可編；補回一條時自動選上，作者不必再點一次
watch(
  () => props.modelValue.length,
  (n) => {
    if (n === 0) selected.value = -1;
    else if (selected.value < 0 || selected.value >= n) selected.value = Math.min(Math.max(selected.value, 0), n - 1);
  },
);

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    if (batch.value) cancelBatch();
    else emit("close");
  }
  if (event.key !== 'Tab' || event.defaultPrevented || !visible.value.length) return;
  const target = event.target as HTMLElement;
  // Preserve the full DOM tab order even when the list is scrolled: Add → first
  // entry, and Shift+Tab from the edit form → last entry, rather than window edges.
  if (!event.shiftKey && target.matches('[data-worldbook-add]')) {
    event.preventDefault(); void focusPosition(0, true);
  } else if (event.shiftKey && target.id === 'wbd-name') {
    event.preventDefault(); void focusPosition(visible.value.length - 1, false);
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="wbd" role="dialog" aria-modal="true" :aria-label="$t('wb.entries.title')" @keydown="onKeydown">
      <div class="wbd__scrim" @click="emit('close')" />
      <div class="wbd__panel panel">
        <header class="wbd__head">
          <h2>{{ $t("wb.entries.title") }}</h2>
          <span class="subtle wbd__head-meta">
            <span>{{ $t("wb.count", { n: modelValue.length }) }}</span>
            <template v-if="totalChars !== null && totalChars !== undefined">
              <span aria-hidden="true"> · </span>
              <span data-worldbook-dialog-total>{{ $t("wb.totalChars", { n: totalChars }) }}</span>
            </template>
          </span>
          <div class="wbd__head-acts">
            <button type="button" class="btn btn--sm btn--primary" @click="emit('close')">{{ $t("wb.entries.done") }}</button>
          </div>
        </header>

        <div class="wbd__body">
          <!-- 左：清單 -->
          <aside class="wbd__list" :class="{ 'wbd__list--packages': !!lorePacks }">
            <input v-model="query" class="input" type="search" :placeholder="$t('wb.search.placeholder')"
                   :aria-label="$t('wb.search.placeholder')" />
            <button v-if="largePackList" type="button" class="btn wbd__pack-filter-button" @click="openPackPicker('filter')">
              {{ packFilter === 'unpacked' ? $t("wb.filter.unpacked") : availablePack.get(packFilter) ?? $t("wb.packs.filter") }} <span aria-hidden="true">⌄</span>
            </button>
            <div v-else-if="lorePacks?.length" class="seg wbd__pack-filter">
              <button type="button" class="seg__item" :class="{ 'seg__item--on': !packFilter }" :aria-pressed="!packFilter"
                      @click="packFilter = ''">{{ $t("wb.filter.all") }}</button>
              <button v-for="pack in lorePacks" :key="pack.id" type="button" class="seg__item"
                      :class="{ 'seg__item--on': packFilter === pack.id }" :aria-pressed="packFilter === pack.id" @click="packFilter = pack.id">{{ pack.name }}</button>
              <button type="button" class="seg__item" :class="{ 'seg__item--on': packFilter === 'unpacked' }"
                      :aria-pressed="packFilter === 'unpacked'" @click="packFilter = 'unpacked'">{{ $t("wb.filter.unpacked") }}</button>
            </div>
            <button v-if="!batch" type="button" class="btn btn--sm" data-worldbook-add @click="add">{{ $t("wb.entry.add") }}</button>
            <button v-if="lorePacks && modelValue.length && !batch" type="button" class="btn btn--sm" @click="batch = true">{{ $t("wb.batch.select") }}</button>
            <p v-if="canOrder" class="subtle wbd__order-hint">{{ $t("wb.order.hint") }}</p>
            <ul ref="rowsElement" class="wbd__rows" @scroll="onListScroll" @keydown="onListKeydown">
              <li v-if="windowRange.start" aria-hidden="true" :style="{ height: `${spacerHeights.before}px` }" />
              <li v-for="{ row, index } in windowRows" :key="row.entryId ?? row.id ?? `new-${index}`" class="wbd__row" :data-row-index="index" :style="pinnedDragStyle(index)"
                  :aria-posinset="index + 1" :aria-setsize="modelValue.length"
                  :class="{ 'wbd__row--on': index === selected, 'wbd__row--off': !row.isEnabled, 'wbd__row--over': dragOver === index, 'wbd__row--package': !!lorePacks }"
                  :draggable="canOrder" @dragstart="dragFrom = index" @dragover.prevent="dragOver = index"
                  @drop="onDrop(index)" @dragend="dragFrom = null; dragOver = null">
                <input v-if="batch" class="wbd__batch-check" type="checkbox" :checked="selection.includes(index)" :aria-label="row.name || $t('wb.entry.untitled')"
                       @click.stop @change="setSelection(index, ($event.target as HTMLInputElement).checked)" />
                <input v-else-if="!lorePacks" type="checkbox" :checked="row.isEnabled" :aria-label="$t('wb.entry.enabled')"
                       @click.stop @change="setEnabled(index, ($event.target as HTMLInputElement).checked)" />
                <button type="button" class="wbd__row-name" @click="batch ? setSelection(index, !selection.includes(index)) : selected = index">
                  <span class="wbd__row-title">
                    {{ row.name || $t("wb.entry.untitled") }}
                    <span v-if="row.isConstant" class="chip">{{ $t("wb.entry.constantShort") }}</span>
                    <span v-if="row.packId && availablePack.has(row.packId)" class="chip">{{ availablePack.get(row.packId) }}</span>
                  </span>
                  <span v-if="!row.isConstant || row.keywords.length || row.secondaryKeywords?.length" class="subtle wbd__row-keys">
                    {{ summary(row) || $t("wb.entry.keywords.placeholder") }}
                  </span>
                  <span v-if="lorePacks && !batch" class="wbd__row-chevron" aria-hidden="true">›</span>
                </button>
                <span v-if="!batch" class="wbd__row-tools">
                  <button v-if="canOrder" type="button" class="btn btn--icon btn--sm btn--ghost" :disabled="index === 0"
                          :aria-label="$t('list.up')" :title="$t('list.up')" @click="move(index, -1)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
                  </button>
                  <button v-if="canOrder" type="button" class="btn btn--icon btn--sm btn--ghost"
                          :disabled="index === modelValue.length - 1"
                          :aria-label="$t('list.down')" :title="$t('list.down')" @click="move(index, 1)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M18 13l-6 6-6-6" /></svg>
                  </button>
                  <button type="button" class="btn btn--icon btn--sm btn--ghost btn--danger" :aria-label="$t('wb.entry.delete')"
                          :title="$t('wb.entry.delete')" @click="remove(index)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg>
                  </button>
                </span>
              </li>
              <li v-if="windowRange.end < visible.length" aria-hidden="true" :style="{ height: `${spacerHeights.after}px` }" />
            </ul>
            <p v-if="query.trim() && !visible.length" class="subtle wbd__empty">{{ $t("wb.search.none") }}</p>
            <p v-else-if="!modelValue.length" class="subtle wbd__empty">{{ $t("wb.entries.empty") }}</p>
            <div v-if="batch" class="wbd__batch">
              <span>{{ $t("wb.batch.selectedCount", { n: selection.length }) }}</span>
              <button type="button" class="btn" @click="cancelBatch">{{ $t("dialog.cancel") }}</button>
              <button type="button" class="btn btn--primary" :disabled="!selection.length" @click="openMoveDialog">{{ $t("wb.batch.movePack") }}</button>
            </div>
          </aside>

          <!-- 右：編一條 -->
          <section v-if="entry" class="wbd__edit">
            <div class="field">
              <label for="wbd-name">{{ $t("wb.entry.name") }}</label>
              <input id="wbd-name" class="input" :value="entry.name" :maxlength="NAME_MAX"
                     :placeholder="$t('wb.entry.name.placeholder')"
                     @input="patch({ name: ($event.target as HTMLInputElement).value })" />
              <!-- Harbor uses 0 as a placeholder when activation statistics are unavailable. -->
              <span v-if="typeof entry.activationCount === 'number' && entry.activationCount > 0" class="subtle">
                {{ $t("wb.entry.activations", { n: entry.activationCount }) }}
              </span>
            </div>

            <div v-if="lorePacks" class="field">
              <label for="wbd-pack">{{ $t("wb.entry.pack.label") }}</label>
              <button v-if="largePackList" id="wbd-pack" type="button" class="btn wbd__pack-filter-button" @click="openPackPicker('assign')">
                {{ availablePack.get(entry.packId ?? "") ?? $t("wb.filter.unpacked") }} <span aria-hidden="true">⌄</span>
              </button>
              <select v-else id="wbd-pack" class="input" :value="entry.packId ?? ''"
                      @change="patch({ packId: ($event.target as HTMLSelectElement).value || undefined })">
                <option value="">{{ $t("wb.entry.pack.none") }}</option>
                <option v-for="pack in lorePacks" :key="pack.id" :value="pack.id">{{ pack.name }}</option>
              </select>
              <span class="subtle">{{ $t("wb.entry.pack.hint") }}</span>
            </div>
            <label v-if="lorePacks" class="wbd__flag">
              <input type="checkbox" :checked="entry.isEnabled" @change="patch({ isEnabled: ($event.target as HTMLInputElement).checked })" />
              {{ $t("wb.entry.enabled") }}
            </label>

            <div class="field">
              <label for="wbd-kw">{{ $t("wb.entry.keywords") }}</label>
              <input id="wbd-kw" class="input" :value="entry.keywords.join('、')" :disabled="entry.isConstant"
                     :placeholder="$t('wb.entry.keywords.placeholder')"
                     :aria-describedby="primaryRegexHint ? 'wbd-kw-hint' : undefined"
                     @input="patch({ keywords: splitKeywords(($event.target as HTMLInputElement).value) })" />
              <span v-if="primaryRegexHint" id="wbd-kw-hint" class="wbd__regex-hint subtle" role="status">{{ $t("wb.entry.regexHint") }}</span>
              <span class="subtle">{{ entry.isConstant ? $t("wb.entry.keywords.constantHint") : $t("wb.entry.keywords.hint") }}</span>
            </div>

            <div v-if="!entry.isConstant" class="field">
              <label for="wbd-sk">{{ $t("wb.entry.secondary") }}</label>
              <input id="wbd-sk" class="input" :value="(entry.secondaryKeywords ?? []).join('、')"
                     :placeholder="$t('wb.entry.secondary.placeholder')"
                     :aria-describedby="secondaryRegexHint ? 'wbd-sk-hint' : undefined"
                     @input="patch({ secondaryKeywords: splitKeywords(($event.target as HTMLInputElement).value) })" />
              <span v-if="secondaryRegexHint" id="wbd-sk-hint" class="wbd__regex-hint subtle" role="status">{{ $t("wb.entry.regexHint") }}</span>
              <span class="subtle">{{ $t("wb.entry.secondary.hint") }}</span>
            </div>

            <div class="field">
              <label for="wbd-cat">{{ $t("wb.entry.category") }}</label>
              <select id="wbd-cat" class="input" :value="entry.category ?? ''"
                      @change="patch({ category: ($event.target as HTMLSelectElement).value })">
                <option v-if="!entry.category" value="">{{ $t("wb.entry.category.none") }}</option>
                <option v-for="value in CATEGORIES" :key="value" :value="value">{{ $t(`wb.category.${value}`) }}</option>
              </select>
              <span class="subtle">{{ $t("wb.entry.category.hint") }}</span>
            </div>

            <div class="field wbd__content">
              <label for="wbd-content">{{ $t("wb.entry.content") }}</label>
              <textarea autocomplete="off" id="wbd-content" class="input" :value="entry.content"
                        :placeholder="$t('wb.entry.content.placeholder')"
                        @input="patch({ content: ($event.target as HTMLTextAreaElement).value })" />
              <span class="field__foot">
                <span class="subtle">{{ [...entry.content].length > contentMax ? $t("wb.entry.content.over", { max: contentMax }) : "" }}</span>
                <span class="subtle count" :class="{ over: [...entry.content].length > contentMax }">{{ [...entry.content].length }} / {{ contentMax }}</span>
              </span>
            </div>

            <div v-if="!entry.isConstant" class="field">
              <label for="wbd-tr">{{ $t("wb.entry.trigger") }}</label>
              <select id="wbd-tr" class="input" :value="entry.triggerRegion || 'both'"
                      @change="patch({ triggerRegion: ($event.target as HTMLSelectElement).value })">
                <option v-for="value in TRIGGER_REGIONS" :key="value" :value="value">{{ $t(`wb.trigger.${value}`) }}</option>
              </select>
              <span class="subtle">{{ $t("wb.entry.trigger.hint") }}</span>
            </div>

            <div class="field">
              <div class="wbd__toggles wbd__recall">
                <label class="toggle">
                  <input type="checkbox" :checked="entry.isConstant"
                         @change="patch({ isConstant: ($event.target as HTMLInputElement).checked })" />
                  <span>{{ $t("wb.entry.constant") }}</span>
                </label>
                <label class="toggle">
                  <input type="checkbox" :checked="entry.semanticRecall !== false" aria-describedby="wbd-semantic-hint"
                         @change="patch({ semanticRecall: ($event.target as HTMLInputElement).checked })" />
                  <span>{{ $t("wb.entry.semantic") }}</span>
                </label>
              </div>
              <span id="wbd-semantic-hint" class="subtle">{{ $t(entry.isConstant ? "wb.entry.semantic.constant" : entry.semanticRecall === false ? "wb.entry.semantic.off" : "wb.entry.semantic.on") }}</span>
            </div>

            <!-- 酒館格式的條目才有：上游照這幾個值做字面比對 -->
            <div v-if="entry.matchOptions" class="field">
              <label>{{ $t("wb.entry.match") }}</label>
              <div class="wbd__toggles">
                <label class="toggle">
                  <input type="checkbox" :checked="entry.matchOptions.caseSensitive"
                         @change="patchMatch({ caseSensitive: ($event.target as HTMLInputElement).checked })" />
                  <span>{{ $t("wb.entry.match.case") }}</span>
                </label>
                <label class="toggle">
                  <input type="checkbox" :checked="entry.matchOptions.matchWholeWords"
                         @change="patchMatch({ matchWholeWords: ($event.target as HTMLInputElement).checked })" />
                  <span>{{ $t("wb.entry.match.whole") }}</span>
                </label>
              </div>
              <span class="subtle">{{ $t("wb.entry.match.hint") }}</span>
            </div>

            <div v-if="entry.matchOptions && !entry.isConstant && (entry.secondaryKeywords ?? []).length" class="field">
              <label for="wbd-sl">{{ $t("wb.entry.match.logic") }}</label>
              <select id="wbd-sl" class="input" :value="entry.matchOptions.selectiveLogic"
                      @change="patchMatch({ selectiveLogic: Number(($event.target as HTMLSelectElement).value) })">
                <option v-for="value in SELECTIVE_LOGIC" :key="value" :value="value">{{ $t(`wb.entry.match.logic.${value}`) }}</option>
              </select>
            </div>
          </section>
          <section v-else class="wbd__edit wbd__edit--empty">
            <p class="muted">{{ $t("wb.entries.pick") }}</p>
          </section>
        </div>
      </div>
    </div>
    <dialog v-if="lorePacks" ref="moveDialog" class="mod-window wbd__move-packs" aria-labelledby="wbd-move-title" @click.self="moveDialog?.close()" @close="moveOpen = false">
      <form class="mod-window__section" @submit.prevent="saveMove">
        <header class="mod-window__head">
          <h2 id="wbd-move-title">{{ $t("wb.batch.moveModal.title", { n: selection.length }) }}</h2>
        </header>
        <div class="mod-window__scroll mod-window__form">
          <p class="subtle">{{ $t("wb.batch.moveModal.hint", { n: selection.length }) }}</p>
          <WorkshopPackOptions v-if="largePackList && moveOpen" :packs="lorePacks" :selected="targetPack" @select="targetPack = $event" />
          <template v-else-if="!largePackList">
            <label v-for="pack in lorePacks" :key="pack.id">
              <span><input v-model="targetPack" type="radio" name="wbd-move-pack" :value="pack.id" /> {{ pack.name }}</span>
            </label>
          </template>
          <label><span><input v-model="targetPack" type="radio" name="wbd-move-pack" value="" /> {{ $t("wb.batch.moveModal.unpacked") }}</span></label>
          <label v-if="lorePacks.length < WORKSHOP_PACK_LIMIT"><span><input v-model="targetPack" type="radio" name="wbd-move-pack" :value="NEW_PACK" /> {{ $t("wb.batch.moveModal.newPack") }}</span></label>
          <label v-if="targetPack === NEW_PACK">
            {{ $t("wb.packs.form.nameLabel") }}
            <input v-model="newPack" class="input" required :placeholder="$t('wb.packs.form.namePlaceholder')" />
          </label>
          <p v-if="targetPack === NEW_PACK && newPackError" role="alert" class="mod-window__row-error">{{ newPackError }}</p>
        </div>
        <footer class="mod-window__foot">
          <button type="button" class="btn" @click="moveDialog?.close()">{{ $t("dialog.cancel") }}</button>
          <button type="submit" class="btn btn--primary" :disabled="targetPack === null || (targetPack === NEW_PACK && (!!newPackError || !newPack.trim()))">{{ $t("wb.batch.moveModal.confirm", { n: selection.length }) }}</button>
        </footer>
      </form>
    </dialog>

    <dialog v-if="lorePacks" ref="packPicker" class="mod-window wbd__move-packs" aria-labelledby="wbd-pack-picker-title"
            @click.self="packPicker?.close()" @close="pickerOpen = false">
      <section class="mod-window__section">
        <header class="mod-window__head">
          <h2 id="wbd-pack-picker-title">{{ $t(packPickerMode === "filter" ? "wb.packs.filter" : "wb.packs.title") }}</h2>
        </header>
        <div class="mod-window__scroll mod-window__form">
          <button v-if="packPickerMode === 'filter'" class="btn" type="button" @click="selectPack('')">{{ $t("wb.filter.all") }}</button>
          <button class="btn" type="button" @click="selectPack(packPickerMode === 'filter' ? 'unpacked' : '')">{{ $t("wb.filter.unpacked") }}</button>
          <WorkshopPackOptions v-if="pickerOpen" :packs="lorePacks"
                               :selected="packPickerMode === 'filter' ? packFilter : entry?.packId" @select="selectPack" />
        </div>
        <footer class="mod-window__foot">
          <button type="button" class="btn" @click="packPicker?.close()">{{ $t("dialog.cancel") }}</button>
        </footer>
      </section>
    </dialog>

  </Teleport>
</template>

<style scoped>
.wbd { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: var(--s-4); }
.wbd__scrim { position: absolute; inset: 0; background: rgba(10, 10, 14, 0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.wbd__panel {
  position: relative; width: min(1240px, 100%); height: min(92vh, 900px);
  display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden;
  box-shadow: var(--shadow-md), 0 0 0 1px var(--line);
}
.wbd__head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2) var(--s-3); padding: var(--s-3) var(--s-4); box-shadow: 0 1px 0 var(--line); }
.wbd__head h2 { font-size: 16px; }
.wbd__head-meta { font-variant-numeric: tabular-nums; }
.wbd__head-acts { margin-left: auto; display: flex; gap: var(--s-2); }
.wbd__body { display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: 0; }
.wbd__list {
  display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); gap: var(--s-2);
  padding: var(--s-3); box-shadow: 1px 0 0 var(--line); min-height: 0;
}
.wbd__list--packages { display: flex; flex-direction: column; }
.wbd__list--packages > :not(.wbd__rows) { flex: 0 0 auto; }
.wbd__list--packages > .wbd__rows { flex: 1 1 auto; min-height: 0; }
.wbd__order-hint { margin: 0; }
.wbd__rows { position: relative; list-style: none; margin: 0; padding: 0; overflow-y: auto; display: grid; gap: 2px; align-content: start; }
.wbd__row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: var(--r-sm); }
.wbd__row:hover { background: var(--surface-2); }
.wbd__row--on { background: var(--accent-tint); box-shadow: inset 2px 0 0 var(--accent); }
.wbd__row--off .wbd__row-title { color: var(--text-3); text-decoration: line-through; }
.wbd__row--over { box-shadow: inset 0 2px 0 var(--accent); }
.wbd__row-name { flex: 1; min-width: 0; display: grid; text-align: left; background: none; border: 0; padding: 2px 0; cursor: pointer; }
.wbd__row-title { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wbd__row-title .chip { height: 18px; padding: 0 6px; font-size: 11px; }
.wbd__row-keys { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wbd__row-tools { display: flex; gap: 2px; }
.wbd__empty { margin: 0; }
.wbd__edit { padding: var(--s-4); overflow-y: auto; display: grid; gap: var(--s-3); align-content: start; }
.wbd__edit--empty { place-items: center; align-content: center; }
.wbd__edit .field { margin-bottom: 0; gap: 6px; }
.wbd__regex-hint { overflow-wrap: anywhere; }
.wbd__content textarea { min-height: 220px; resize: vertical; }
.wbd__toggles { display: flex; gap: var(--s-4); flex-wrap: wrap; }
.toggle { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: var(--text-2); }
.wbd__recall .toggle { min-height: var(--h-md); }
.count { font-variant-numeric: tabular-nums; }
.over { color: var(--danger); }

/* 窄螢幕：左右兩欄疊成上下，清單壓成一小段可捲的高度 */
@media (max-width: 860px) {
  .wbd__recall .toggle { min-height: var(--h-lg); }
  .wbd { padding: 0; }
  .wbd__panel { width: 100%; height: 100%; border-radius: 0; }
  .wbd__body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 40%) minmax(0, 1fr); }
  .wbd__list { box-shadow: 0 1px 0 var(--line); }
}

.wbd__row--package { min-height: 44px; }
.wbd__row--package .wbd__row-name { position: relative; min-height: 44px; padding-inline-end: 20px; }
.wbd__row-chevron { position: absolute; inset-inline-end: 4px; inset-block-start: 50%; transform: translateY(-50%); }
.wbd__pack-filter { display: flex; flex-shrink: 0; overflow-x: auto; max-width: 100%; }
.wbd input[type="checkbox"], .wbd__move-packs input[type="radio"] { accent-color: var(--accent); }
.wbd__pack-filter-button { min-width: 0; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.wbd__pack-filter button { flex-shrink: 0; }
.wbd__batch { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; padding: 6px 0 max(6px, env(safe-area-inset-bottom)); }
.wbd__batch button { min-height: 44px; }
.wbd__move-packs { max-width: min(420px, 100vw); }
@media (max-width: 640px) { .wbd__move-packs { max-width: none; } }
</style>
