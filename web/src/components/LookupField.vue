<script setup lang="ts">
/**
 * 「打字找候選」的一格：打作品名就去查（Wikidata），列出候選給人點；點了就對上一個編號，
 * 沒點、照打的字留著就是自由文字（待歸類）。選填的欄位用，空著也沒事。
 * 鍵盤：上下走清單、Enter 選、Esc 關；輸入法組字中不查。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

export interface LookupCandidate { id: string; label: string; description?: string }
export interface LookupValue { id?: string; label: string }

const props = withDefaults(defineProps<{ modelValue: LookupValue; lookup: (q: string) => Promise<LookupCandidate[]>; placeholder?: string; maxlength?: number; label?: string; inputId?: string; disabled?: boolean }>(), { placeholder: "", maxlength: 60, label: "", inputId: undefined, disabled: false });
const emit = defineEmits<{ "update:modelValue": [value: LookupValue] }>();
const { t } = useI18n();

const input = ref<HTMLInputElement | null>(null);
const open = ref(false);
const active = ref(0);
const candidates = ref<LookupCandidate[]>([]);
const busy = ref(false);
const id = `lookup-${Math.random().toString(36).slice(2, 8)}`;
type Row = { kind: "candidate"; id: string; label: string; description: string } | { kind: "free"; label: string };
const rows = computed<Row[]>(() => {
  const q = props.modelValue.label.trim();
  if (!q) return [];
  return [...candidates.value.map((c) => ({ kind: "candidate" as const, id: c.id, label: c.label, description: c.description ?? "" })), { kind: "free" as const, label: q }];
});

let timer: ReturnType<typeof setTimeout> | undefined;
let loadId = 0;
let composing = false;
async function load() {
  const q = props.modelValue.label.trim();
  const my = ++loadId;
  if (!q) { candidates.value = []; return; }
  busy.value = true;
  try {
    const found = await props.lookup(q);
    if (my === loadId) candidates.value = found;
  } catch { if (my === loadId) candidates.value = []; }
  finally { if (my === loadId) busy.value = false; }
}
function typed(value: string) {
  // 人改了字：之前對上的編號不再算數，重新找
  emit("update:modelValue", { label: value });
  clearTimeout(timer);
  active.value = 0;
  if (composing) return;
  if (!value.trim()) { candidates.value = []; open.value = false; return; }
  open.value = true;
  timer = setTimeout(() => void load(), 250);
}
onBeforeUnmount(() => clearTimeout(timer));
watch(() => props.disabled, (v) => { if (v) open.value = false; });

function choose(i: number) {
  const row = rows.value[i];
  if (!row) return;
  open.value = false;
  emit("update:modelValue", row.kind === "candidate" ? { id: row.id, label: row.label } : { label: row.label });
}
function key(e: KeyboardEvent) {
  if (e.isComposing || composing) return;
  if (e.key === "Escape") { if (open.value) { e.preventDefault(); open.value = false; } return; }
  if (e.key === "Enter") { e.preventDefault(); if (open.value && rows.value.length) choose(active.value); return; }
  if (!open.value || !rows.value.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const n = rows.value.length;
  if (e.key === "Home") active.value = 0;
  else if (e.key === "End") active.value = n - 1;
  else active.value = (active.value + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
  void nextTick(() => document.getElementById(`${id}-${active.value}`)?.scrollIntoView?.({ block: "nearest" }));
}
function compositionStart() { composing = true; }
function compositionEnd(e: Event) { composing = false; typed((e.target as HTMLInputElement).value); }
function blur(e: FocusEvent) { if (!(e.relatedTarget instanceof Node) || !input.value?.parentElement?.contains(e.relatedTarget)) open.value = false; }
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="lookup" :class="{ 'lookup--linked': !!modelValue.id }" @focusout="blur">
    <input
      ref="input"
      :id="inputId"
      :value="modelValue.label"
      class="input lookup__input"
      type="text"
      role="combobox"
      autocomplete="off"
      aria-autocomplete="list"
      :aria-expanded="open && rows.length > 0"
      :aria-controls="id"
      :aria-activedescendant="open && rows.length ? `${id}-${active}` : undefined"
      :aria-label="label || undefined"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :disabled="disabled"
      :aria-busy="busy"
      data-lookup
      @input="typed(($event.target as HTMLInputElement).value)"
      @compositionstart="compositionStart"
      @compositionend="compositionEnd"
      @keydown="key"
      @focus="if (modelValue.label.trim() && rows.length) open = true;"
    />
    <!-- 對上編號的在框右邊畫一個勾：人一眼看得出這是「對到作品」還是「照打的字」 -->
    <svg v-if="modelValue.id" class="lookup__linked" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
    <ul v-if="open && rows.length" :id="id" class="lookup__list panel" role="listbox" :aria-label="label || undefined">
      <li v-for="(row, i) in rows" :id="`${id}-${i}`" :key="row.kind === 'candidate' ? row.id : 'free'" class="lookup__item" :class="{ 'is-active': i === active, 'lookup__item--free': row.kind === 'free' }" role="option" :aria-selected="i === active" @pointermove="active = i" @mousedown.prevent @click="choose(i)">
        <template v-if="row.kind === 'candidate'">
          <span class="lookup__label">{{ row.label }}</span>
          <span v-if="row.description" class="lookup__desc">{{ row.description }}</span>
        </template>
        <template v-else>{{ t("lookup.free", { q: row.label }) }}</template>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.lookup { position: relative; width: 100%; min-width: 0; }
.lookup--linked .lookup__input { padding-right: 36px; }
.lookup__linked { position: absolute; right: 12px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); color: var(--accent-text, var(--accent)); pointer-events: none; }
.lookup__list { position: absolute; z-index: 120; top: calc(100% + 6px); left: 0; right: 0; margin: 0; padding: var(--s-1) 0; list-style: none; max-height: 40vh; overflow-y: auto; text-align: left; }
.lookup__item { display: flex; flex-direction: column; gap: 2px; padding: var(--s-2) var(--s-4); font-size: 14px; color: var(--text); cursor: pointer; }
.lookup__item.is-active { background: var(--surface-2); }
.lookup__item--free { color: var(--text-2); }
.lookup__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lookup__desc { font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
