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
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import type { WorldbookEntryDraft, WorldbookMatchOptions } from "@/lib/role-draft";
import { ENTRY_CONTENT_MAX } from "@/lib/tavern";

const props = defineProps<{ modelValue: WorldbookEntryDraft[] }>();
const emit = defineEmits<{
  "update:modelValue": [WorldbookEntryDraft[]];
  close: [];
}>();

const { t } = useI18n();

const NAME_MAX = 20;
const CATEGORIES = ["character", "location", "item", "event", "rule", "custom"];
const TRIGGER_REGIONS = ["both", "user_only", "ai_only"];
const SELECTIVE_LOGIC = [0, 1, 2, 3];

const commit = (next: WorldbookEntryDraft[]) => emit("update:modelValue", next);

/** 選中的是第幾條。條目沒有穩定的本地 id（新加的還沒有 entryId），所以每次改動順序或刪除都要跟著調。 */
const selected = ref(props.modelValue.length ? 0 : -1);
const entry = computed(() => props.modelValue[selected.value] ?? null);

const query = ref("");
const visible = computed(() => {
  const q = query.value.trim().toLowerCase();
  const rows = props.modelValue.map((row, index) => ({ row, index }));
  if (!q) return rows;
  return rows.filter(({ row }) =>
    [row.name, row.content, row.keywords.join(" "), (row.secondaryKeywords ?? []).join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
});

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
    { name: "", content: "", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: false, category: "custom" },
  ]);
  selected.value = props.modelValue.length;
  query.value = "";
}

async function remove(index: number) {
  const row = props.modelValue[index];
  // 已經在上游存在的條目，刪掉是真的會消失；還沒存過的只是移出這份草稿，不必問。
  if (row.entryId && !(await confirmDialog({ message: t("wb.entry.deleteConfirm"), confirmText: t("wb.entry.delete"), danger: true }))) return;
  commit(props.modelValue.filter((_, i) => i !== index));
  if (selected.value === index) selected.value = Math.min(index, props.modelValue.length - 2);
  else if (selected.value > index) selected.value -= 1;
}

/**
 * 換順序。這不只是整理：常駐條目每輪有上限，擠不下時上游留的是排在前面的幾條。
 * 過濾中不給拖——畫面上只有一部分條目，放下去要落在哪一格沒有一個誠實的答案。
 */
const canOrder = computed(() => !query.value.trim() && props.modelValue.length > 1);
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);

function onDrop(to: number) {
  const from = dragFrom.value;
  dragFrom.value = null;
  dragOver.value = null;
  if (from === null || from === to) return;
  const next = props.modelValue.slice();
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  commit(next);
  if (selected.value === from) selected.value = to;
  else if (from < selected.value && to >= selected.value) selected.value -= 1;
  else if (from > selected.value && to <= selected.value) selected.value += 1;
}

/** 鍵盤也要能換：只有拖放的話，用鍵盤的人等於沒有這個功能。 */
function move(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= props.modelValue.length) return;
  const next = props.modelValue.slice();
  [next[index], next[target]] = [next[target], next[index]];
  commit(next);
  if (selected.value === index) selected.value = target;
  else if (selected.value === target) selected.value = index;
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
  if (event.key === "Escape") emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div class="wbd" role="dialog" aria-modal="true" :aria-label="$t('wb.entries.title')" @keydown="onKeydown">
      <div class="wbd__scrim" @click="emit('close')" />
      <div class="wbd__panel panel">
        <header class="wbd__head">
          <h2>{{ $t("wb.entries.title") }}</h2>
          <span class="subtle">{{ $t("wb.count", { n: modelValue.length }) }}</span>
          <div class="wbd__head-acts">
            <button type="button" class="btn btn--sm btn--primary" @click="emit('close')">{{ $t("wb.entries.done") }}</button>
          </div>
        </header>

        <div class="wbd__body">
          <!-- 左：清單 -->
          <aside class="wbd__list">
            <input v-model="query" class="input" type="search" :placeholder="$t('wb.search.placeholder')"
                   :aria-label="$t('wb.search.placeholder')" />
            <button type="button" class="btn btn--sm" @click="add">{{ $t("wb.entry.add") }}</button>
            <p v-if="canOrder" class="subtle wbd__order-hint">{{ $t("wb.order.hint") }}</p>
            <ul class="wbd__rows">
              <li v-for="{ row, index } in visible" :key="row.entryId ?? `new-${index}`" class="wbd__row"
                  :class="{ 'wbd__row--on': index === selected, 'wbd__row--off': !row.isEnabled, 'wbd__row--over': dragOver === index }"
                  :draggable="canOrder" @dragstart="dragFrom = index" @dragover.prevent="dragOver = index"
                  @drop="onDrop(index)" @dragend="dragFrom = null; dragOver = null">
                <input type="checkbox" :checked="row.isEnabled" :aria-label="$t('wb.entry.enabled')"
                       @click.stop @change="setEnabled(index, ($event.target as HTMLInputElement).checked)" />
                <button type="button" class="wbd__row-name" @click="selected = index">
                  <span class="wbd__row-title">
                    {{ row.name || $t("wb.entry.untitled") }}
                    <span v-if="row.isConstant" class="chip">{{ $t("wb.entry.constantShort") }}</span>
                  </span>
                  <span class="subtle wbd__row-keys">{{ summary(row) || $t("wb.entry.keywords.placeholder") }}</span>
                </button>
                <span class="wbd__row-tools">
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
            </ul>
            <p v-if="query.trim() && !visible.length" class="subtle wbd__empty">{{ $t("wb.search.none") }}</p>
            <p v-else-if="!modelValue.length" class="subtle wbd__empty">{{ $t("wb.entries.empty") }}</p>
          </aside>

          <!-- 右：編一條 -->
          <section v-if="entry" class="wbd__edit">
            <div class="field">
              <label for="wbd-name">{{ $t("wb.entry.name") }}</label>
              <input id="wbd-name" class="input" :value="entry.name" :maxlength="NAME_MAX"
                     :placeholder="$t('wb.entry.name.placeholder')"
                     @input="patch({ name: ($event.target as HTMLInputElement).value })" />
              <span v-if="typeof entry.activationCount === 'number'" class="subtle">
                {{ $t("wb.entry.activations", { n: entry.activationCount }) }}
              </span>
            </div>

            <div class="field">
              <label for="wbd-kw">{{ $t("wb.entry.keywords") }}</label>
              <input id="wbd-kw" class="input" :value="entry.keywords.join('、')" :disabled="entry.isConstant"
                     :placeholder="$t('wb.entry.keywords.placeholder')"
                     @input="patch({ keywords: splitKeywords(($event.target as HTMLInputElement).value) })" />
              <span class="subtle">{{ entry.isConstant ? $t("wb.entry.keywords.constantHint") : $t("wb.entry.keywords.hint") }}</span>
            </div>

            <div v-if="!entry.isConstant" class="field">
              <label for="wbd-sk">{{ $t("wb.entry.secondary") }}</label>
              <input id="wbd-sk" class="input" :value="(entry.secondaryKeywords ?? []).join('、')"
                     :placeholder="$t('wb.entry.secondary.placeholder')"
                     @input="patch({ secondaryKeywords: splitKeywords(($event.target as HTMLInputElement).value) })" />
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
              <textarea id="wbd-content" class="input" :value="entry.content"
                        :placeholder="$t('wb.entry.content.placeholder')"
                        @input="patch({ content: ($event.target as HTMLTextAreaElement).value })" />
              <span class="field__foot">
                <span class="subtle">{{ [...entry.content].length > ENTRY_CONTENT_MAX ? $t("wb.entry.content.over", { max: ENTRY_CONTENT_MAX }) : "" }}</span>
                <span class="subtle count" :class="{ over: [...entry.content].length > ENTRY_CONTENT_MAX }">{{ [...entry.content].length }} / {{ ENTRY_CONTENT_MAX }}</span>
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

            <label class="toggle">
              <input type="checkbox" :checked="entry.isConstant"
                     @change="patch({ isConstant: ($event.target as HTMLInputElement).checked })" />
              <span>{{ $t("wb.entry.constant") }}</span>
            </label>

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
.wbd__head { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) var(--s-4); box-shadow: 0 1px 0 var(--line); }
.wbd__head h2 { font-size: 16px; }
.wbd__head-acts { margin-left: auto; display: flex; gap: var(--s-2); }
.wbd__body { display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: 0; }
.wbd__list {
  display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); gap: var(--s-2);
  padding: var(--s-3); box-shadow: 1px 0 0 var(--line); min-height: 0;
}
.wbd__order-hint { margin: 0; }
.wbd__rows { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: grid; gap: 2px; align-content: start; }
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
.wbd__content textarea { min-height: 220px; resize: vertical; }
.wbd__toggles { display: flex; gap: var(--s-4); flex-wrap: wrap; }
.toggle { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: var(--text-2); }
.count { font-variant-numeric: tabular-nums; }
.over { color: var(--danger); }

/* 窄螢幕：左右兩欄疊成上下，清單壓成一小段可捲的高度 */
@media (max-width: 860px) {
  .wbd { padding: 0; }
  .wbd__panel { width: 100%; height: 100%; border-radius: 0; }
  .wbd__body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 40%) minmax(0, 1fr); }
  .wbd__list { box-shadow: 0 1px 0 var(--line); }
}
</style>
