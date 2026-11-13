<script setup lang="ts" generic="K extends string">
/**
 * 底線式分頁（卡片頁「介紹｜工坊」、擴充詳情「介紹｜更新紀錄｜評論」、我的卡片「卡片｜擴充」）。
 * 跟 .seg 不同：.seg 是幾個互斥的篩選，這個是同一頁的幾個分區，與頁面同寬、選中那格底下一條 accent 線。
 * 左右鍵在分頁間移動（tablist 慣例）；分頁的狀態由呼叫端記在網址上。
 */
import { nextTick, ref } from "vue";

const props = defineProps<{ tabs: { key: K; label: string; count?: number | null }[]; modelValue: K; label: string; idPrefix: string }>();
const emit = defineEmits<{ "update:modelValue": [K] }>();
const bar = ref<HTMLElement | null>(null);

async function onKey(e: KeyboardEvent, index: number) {
  const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  if (!delta) return;
  e.preventDefault();
  const next = props.tabs[(index + delta + props.tabs.length) % props.tabs.length]!;
  emit("update:modelValue", next.key);
  await nextTick();
  bar.value?.querySelector<HTMLElement>(`#${props.idPrefix}-tab-${next.key}`)?.focus();
}
</script>

<template>
  <div ref="bar" class="line-tabs" role="tablist" :aria-label="label">
    <button
      v-for="(tab, i) in tabs" :id="`${idPrefix}-tab-${tab.key}`" :key="tab.key" type="button" role="tab" class="line-tabs__tab"
      :aria-selected="tab.key === modelValue" :aria-controls="`${idPrefix}-panel`" :tabindex="tab.key === modelValue ? 0 : -1"
      @click="emit('update:modelValue', tab.key)" @keydown="onKey($event, i)"
    >
      {{ tab.label }}<small v-if="tab.count" class="line-tabs__n">{{ tab.count }}</small>
    </button>
  </div>
</template>

<style scoped>
.line-tabs { display: flex; gap: var(--s-1); box-shadow: inset 0 -1px 0 var(--line); overflow-x: auto; scrollbar-width: none; }
.line-tabs::-webkit-scrollbar { display: none; }
.line-tabs__tab {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  height: var(--h-lg); padding: 0 var(--s-4); border: 0; background: none;
  font: inherit; font-size: 15px; font-weight: 600; color: var(--text-2); white-space: nowrap; cursor: pointer;
  box-shadow: inset 0 -2px 0 transparent;
  transition: color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.line-tabs__tab:hover { color: var(--text); }
.line-tabs__tab[aria-selected="true"] { color: var(--accent-text); box-shadow: inset 0 -2px 0 var(--accent); }
.line-tabs__n { font-size: 12px; font-weight: 500; color: var(--text-3); font-variant-numeric: tabular-nums; }
</style>
