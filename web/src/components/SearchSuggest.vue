<script setup lang="ts">
/**
 * 搜尋框的即時建議：打字時列出站上有的標籤、原作、卡名，點了直接到那裡；第一列永遠是「搜尋這個字」。
 * 人不必先按搜尋才知道站上有沒有，也不必記得確切寫法——這是別名表管不到的那一半。
 *   - 打字停 200ms 才問；輸入法組字中不問、Enter 也不算（isComposing，跟「/」快捷鍵同一條規則）；
 *   - 鍵盤：上下、Home／End 走清單，Enter 選中；沒選中任何一列時 Enter 照常交給外層的表單送出；Esc 關；
 *   - 清單是 listbox，輸入框是 combobox，螢幕閱讀器讀得到現在停在哪一列。
 * 只給一般內容（伺服器那邊決定），看的人藏起來的類型也不會出現。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { fetchSuggest, type Suggestions } from "@/lib/api";
import { contentLang, defaultZone } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { fandomLabel } from "@/lib/fandom";

const props = withDefaults(defineProps<{ modelValue: string; placeholder?: string; label?: string; inputClass?: string }>(), { placeholder: "", label: "", inputClass: "" });
const emit = defineEmits<{ "update:modelValue": [value: string]; submit: [] }>();
const router = useRouter();
const { locale, lp } = useLocalePath();

type Item = { kind: "search"; label: string } | { kind: "tag"; label: string; n: number } | { kind: "fandom"; label: string; key: string; n: number } | { kind: "card"; label: string; num: number; avatar: string | null };
const input = ref<HTMLInputElement | null>(null);
const open = ref(false);
const active = ref(0);
const found = ref<Suggestions | null>(null);
const id = `suggest-${Math.random().toString(36).slice(2, 8)}`;

const items = computed<Item[]>(() => {
  const q = props.modelValue.trim();
  if (!q) return [];
  const f = found.value;
  return [
    { kind: "search", label: q },
    ...(f?.tags ?? []).map((t) => ({ kind: "tag" as const, label: t.tag, n: t.n })),
    ...(f?.fandoms ?? []).map((t) => ({ kind: "fandom" as const, label: fandomLabel(t.labels, locale.value) || t.fandom, key: t.key, n: t.n })),
    ...(f?.cards ?? []).map((c) => ({ kind: "card" as const, label: c.name, num: c.num, avatar: c.avatarUrl })),
  ];
});
/** 分組標題只在那一組的第一列前面畫 */
const headerBefore = (i: number) => (i > 0 && items.value[i]!.kind !== items.value[i - 1]!.kind ? items.value[i]!.kind : null);

let timer: ReturnType<typeof setTimeout> | undefined;
let loadId = 0;
let composing = false;
/** 這次值的變化是不是人打的：網址換了、上一頁回來，值也會變，那時不該彈清單 */
let typed = false;
async function load() {
  const q = props.modelValue.trim();
  const my = ++loadId;
  if (!q) { found.value = null; return; }
  try {
    const result = await fetchSuggest(defaultZone(locale.value), q, contentLang(locale.value));
    if (my === loadId) found.value = result;
  } catch { if (my === loadId) found.value = null; }
}
watch(() => props.modelValue, () => {
  clearTimeout(timer);
  active.value = 0;
  const byUser = typed;
  typed = false;
  if (composing) return;
  if (!props.modelValue.trim()) { found.value = null; open.value = false; return; }
  if (!byUser) { open.value = false; return; }
  open.value = true;
  timer = setTimeout(() => void load(), 200);
});
onBeforeUnmount(() => clearTimeout(timer));

function choose(i: number) {
  const item = items.value[i];
  if (!item) return;
  open.value = false;
  if (item.kind === "search") { emit("submit"); return; }
  if (item.kind === "card") { void router.push(lp(`/cards/${item.num}`)); return; }
  void router.push({ path: lp("/search"), query: item.kind === "tag" ? { tag: item.label } : { fandom: item.key } });
}
function key(e: KeyboardEvent) {
  if (e.isComposing || composing) return;
  if (e.key === "Escape") { if (open.value) { e.preventDefault(); open.value = false; } return; }
  if (!open.value || !items.value.length) return;
  if (e.key === "Enter") {
    // 第一列就是「搜尋這個字」：停在那裡的 Enter 讓外層表單照常送出
    if (active.value > 0) { e.preventDefault(); choose(active.value); } else open.value = false;
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const n = items.value.length;
  if (e.key === "Home") active.value = 0;
  else if (e.key === "End") active.value = n - 1;
  else active.value = (active.value + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
  void nextTick(() => document.getElementById(`${id}-${active.value}`)?.scrollIntoView?.({ block: "nearest" }));
}
function onInput(e: Event) { typed = true; emit("update:modelValue", (e.target as HTMLInputElement).value); }
function onCompositionEnd(e: Event) { composing = false; typed = true; emit("update:modelValue", (e.target as HTMLInputElement).value); }
function blur(e: FocusEvent) { if (!(e.relatedTarget instanceof Node) || !input.value?.parentElement?.contains(e.relatedTarget)) open.value = false; }
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="suggest" @focusout="blur">
    <input
      ref="input"
      :value="modelValue"
      :class="inputClass"
      type="search"
      role="combobox"
      autocomplete="off"
      aria-autocomplete="list"
      :aria-expanded="open && items.length > 0"
      :aria-controls="id"
      :aria-activedescendant="open && items.length ? `${id}-${active}` : undefined"
      :aria-label="label"
      :placeholder="placeholder"
      enterkeyhint="search"
      @input="onInput"
      @compositionstart="composing = true"
      @compositionend="onCompositionEnd"
      @keydown="key"
      @focus="if (modelValue.trim() && items.length) open = true;"
    />
    <ul v-if="open && items.length" :id="id" class="suggest__list panel" role="listbox" :aria-label="label">
      <template v-for="(item, i) in items" :key="`${item.kind}:${item.label}`">
        <li v-if="headerBefore(i)" class="suggest__head" role="presentation">{{ $t(`search.suggest.${headerBefore(i)}`) }}</li>
        <li :id="`${id}-${i}`" class="suggest__item" :class="{ 'is-active': i === active, [`suggest__item--${item.kind}`]: true }" role="option" :aria-selected="i === active" @pointermove="active = i" @mousedown.prevent @click="choose(i)">
          <template v-if="item.kind === 'search'">{{ $t("search.suggest.search", { q: item.label }) }}</template>
          <template v-else-if="item.kind === 'card'">
            <img v-if="item.avatar" class="suggest__avatar" :src="item.avatar" alt="" loading="lazy" />
            <span class="suggest__avatar suggest__avatar--blank" v-else aria-hidden="true" />
            <span class="suggest__label">{{ item.label }}</span>
          </template>
          <template v-else><span class="suggest__label">{{ item.kind === "tag" ? "#" : "" }}{{ item.label }}</span><span class="suggest__n">{{ item.n }}</span></template>
        </li>
      </template>
    </ul>
  </div>
</template>

<style scoped>
.suggest { position: relative; width: 100%; min-width: 0; }
.suggest__list { position: absolute; z-index: 40; top: calc(100% + 6px); left: 0; right: 0; margin: 0; padding: var(--s-1) 0; list-style: none; max-height: 60vh; overflow-y: auto; text-align: left; }
.suggest__head { padding: var(--s-2) var(--s-4) var(--s-1); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: var(--text-3); }
.suggest__item { display: flex; align-items: center; gap: var(--s-2); min-height: var(--h-sm); padding: var(--s-1) var(--s-4); font-size: 14px; color: var(--text); cursor: pointer; }
.suggest__item.is-active { background: var(--surface-2); }
.suggest__item--search { color: var(--text-2); }
.suggest__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.suggest__n { font-size: 12px; color: var(--text-3); }
.suggest__avatar { flex: none; width: 24px; height: 24px; border-radius: 6px; object-fit: cover; background: var(--surface-2); }
</style>
