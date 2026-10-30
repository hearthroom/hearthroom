<script setup lang="ts">
/**
 * 「測試過的模型」選單（owner 2026-10-30）：只到系列與模型兩層，線路不列。存 `series:<系列>` 或 `model:<模型>`。
 * 編輯器（多選）與公開列表的篩選（單選，`multiple=false`）共用這一份，兩邊長得一樣。
 *
 * 一點進框就列出全部，打字同時比對系列名與模型名：模型命中時連它的系列一起留著，給人「選整個系列」的選項。
 * 多選時已選的不再列；選了整個系列，它底下的模型也不列（已經涵蓋）。目錄裡找不到的舊值照原字顯示成標籤，可以拿掉。
 * 鍵盤：上下走清單、Enter 選、Esc 關；輸入法組字中不動作。
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ModelCatalogGroup } from "@/lib/presets";

const props = withDefaults(defineProps<{ groups: ModelCatalogGroup[]; modelValue: string[]; multiple?: boolean; inputId?: string; label?: string; placeholder?: string; disabled?: boolean }>(), {
  multiple: true, inputId: undefined, label: "", placeholder: "", disabled: false,
});
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();
const { t } = useI18n();

const input = ref<HTMLInputElement | null>(null);
const query = ref("");
const open = ref(false);
const active = ref(0);
const id = `model-pick-${Math.random().toString(36).slice(2, 8)}`;
let composing = false;

type Row = { kind: "series" | "model"; value: string; name: string };
const rows = computed<Row[]>(() => {
  const q = query.value.trim().toLocaleLowerCase();
  const chosen = new Set(props.multiple ? props.modelValue : []);
  const out: Row[] = [];
  for (const g of props.groups) {
    const series = `series:${g.group}`;
    if (chosen.has(series)) continue;
    const groupHit = !q || g.group.toLocaleLowerCase().includes(q);
    const families = g.families.filter((f) => !chosen.has(`model:${f}`) && (groupHit || f.toLocaleLowerCase().includes(q)));
    if (!groupHit && !families.length) continue;
    out.push({ kind: "series", value: series, name: g.group });
    for (const f of families) out.push({ kind: "model", value: `model:${f}`, name: f });
  }
  return out;
});
watch(rows, (r) => { if (active.value >= r.length) active.value = Math.max(0, r.length - 1); });
watch(() => props.disabled, (v) => { if (v) open.value = false; });

function chipLabel(value: string) {
  if (value.startsWith("series:")) return t("preset.models.series", { name: value.slice(7) });
  if (value.startsWith("model:")) return value.slice(6);
  return value;
}

function choose(i: number) {
  const row = rows.value[i];
  if (!row) return;
  query.value = "";
  if (props.multiple) {
    emit("update:modelValue", [...props.modelValue, row.value]);
    return;
  }
  open.value = false;
  emit("update:modelValue", [row.value]);
}
function remove(value: string) {
  emit("update:modelValue", props.modelValue.filter((v) => v !== value));
  input.value?.focus();
}

function show() { if (!props.disabled) open.value = true; }
function typed(value: string) {
  query.value = value;
  active.value = 0;
  if (!composing) show();
}
function key(e: KeyboardEvent) {
  if (e.isComposing || composing) return;
  if (e.key === "Escape") { if (open.value) { e.preventDefault(); open.value = false; } return; }
  if (e.key === "Enter") { e.preventDefault(); if (open.value && rows.value.length) choose(active.value); return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  if (!open.value) { show(); return; }
  const n = rows.value.length;
  if (!n) return;
  if (e.key === "Home") active.value = 0;
  else if (e.key === "End") active.value = n - 1;
  else active.value = (active.value + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
  void nextTick(() => document.getElementById(`${id}-${active.value}`)?.scrollIntoView?.({ block: "nearest" }));
}
function compositionEnd(e: Event) { composing = false; typed((e.target as HTMLInputElement).value); }
function blur(e: FocusEvent) { if (!(e.relatedTarget instanceof Node) || !(e.currentTarget as HTMLElement).contains(e.relatedTarget)) open.value = false; }
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="model-pick" @focusout="blur">
    <ul v-if="modelValue.length" class="model-pick__chips" :aria-label="label || undefined">
      <li v-for="v in modelValue" :key="v" class="chip chip--on model-pick__chip" data-testid="model-chip">
        <span>{{ chipLabel(v) }}</span>
        <button type="button" class="model-pick__remove" :disabled="disabled" :aria-label="t('preset.models.remove', { name: chipLabel(v) })" @click="remove(v)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        </button>
      </li>
    </ul>
    <div class="model-pick__box">
      <input
        :id="inputId"
        ref="input"
        :value="query"
        class="input"
        type="search"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="id"
        :aria-activedescendant="open && rows.length ? `${id}-${active}` : undefined"
        :aria-label="label || undefined"
        :placeholder="placeholder || t('preset.models.placeholder')"
        :disabled="disabled"
        @input="typed(($event.target as HTMLInputElement).value)"
        @compositionstart="composing = true"
        @compositionend="compositionEnd"
        @keydown="key"
        @focus="show"
        @click="show"
      />
      <div v-if="open" class="model-pick__pop panel">
        <ul v-if="rows.length" :id="id" class="model-pick__list" role="listbox" :aria-label="label || undefined" :aria-multiselectable="multiple || undefined">
          <li
            v-for="(row, i) in rows" :id="`${id}-${i}`" :key="row.value" role="option"
            class="model-pick__item" :class="[`model-pick__item--${row.kind}`, { 'is-active': i === active }]"
            :aria-selected="!multiple && modelValue.includes(row.value)"
            @pointermove="active = i" @mousedown.prevent @click="choose(i)"
          >
            <span class="model-pick__name">{{ row.name }}</span>
            <span v-if="row.kind === 'series'" class="model-pick__all">{{ " " + t("preset.models.seriesAll") }}</span>
          </li>
        </ul>
        <p v-else-if="query.trim()" class="model-pick__empty subtle" data-testid="model-pick-empty">{{ t("preset.models.empty") }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.model-pick { display: grid; gap: var(--s-2); min-width: 0; }
.model-pick__chips { display: flex; flex-wrap: wrap; gap: var(--s-1); margin: 0; padding: 0; list-style: none; min-width: 0; }
.model-pick__chip { max-width: 100%; height: auto; min-height: 26px; padding-block: 2px; padding-inline-end: 2px; gap: 2px; line-height: 1.35; white-space: normal; overflow-wrap: anywhere; cursor: default; }
.model-pick__remove { display: inline-grid; place-items: center; flex: none; width: 24px; height: 24px; margin: 0; padding: 0; border: 0; border-radius: 999px; background: none; color: inherit; cursor: pointer; position: relative; }
/* 圓鈕畫 24，可點範圍放到 44（手指也點得準），不把標籤撐高 */
.model-pick__remove::after { content: ""; position: absolute; inset: -10px; }
.model-pick__remove:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
.model-pick__remove svg { width: 14px; height: 14px; }
.model-pick__box { position: relative; min-width: 0; }
.model-pick__pop { position: absolute; z-index: 120; top: calc(100% + 6px); left: 0; right: 0; max-height: min(40vh, 320px); overflow-y: auto; padding: var(--s-1) 0; }
.model-pick__list { margin: 0; padding: 0; list-style: none; }
.model-pick__item { display: flex; align-items: baseline; gap: var(--s-1); min-height: 40px; padding: var(--s-2) var(--s-4); font-size: 14px; color: var(--text); cursor: pointer; }
.model-pick__item--series { font-weight: 600; }
.model-pick__item--model { padding-inline-start: calc(var(--s-4) + var(--s-4)); }
.model-pick__item.is-active { background: var(--surface-2); }
.model-pick__item[aria-selected="true"] { color: var(--accent-text, var(--accent)); }
.model-pick__name { min-width: 0; overflow-wrap: anywhere; }
.model-pick__all { flex: none; font-size: 12px; font-weight: 400; color: var(--text-3); }
.model-pick__empty { margin: 0; padding: var(--s-2) var(--s-4); }
</style>
