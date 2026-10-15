<script setup lang="ts">
/**
 * 純 CSS 長條：每一條的寬度是這一組最大值的百分比，數字寫在旁邊，整條帶文字標籤（讀屏與不靠顏色辨識都用得上）。
 * 全是 0 的組寬度都是 0，不會出 NaN。
 */
import { computed } from 'vue';

const props = defineProps<{ group: string; items: { key: string; label: string; value: number; text: string }[] }>();
const max = computed(() => Math.max(0, ...props.items.map((i) => i.value)));
const width = (v: number) => (max.value > 0 ? `${Math.round((v / max.value) * 1000) / 10}%` : '0%');
</script>

<template>
  <ul class="bars">
    <li v-for="item in items" :key="item.key" class="bars__row">
      <span class="bars__label">{{ item.label }}</span>
      <div class="bars__track" role="img" :data-bar="`${group}.${item.key}`" :aria-label="`${item.label}: ${item.text}`"><i :style="{ width: width(item.value) }" /></div>
      <span class="bars__num" aria-hidden="true">{{ item.text }}</span>
    </li>
  </ul>
</template>

<style scoped>
.bars { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.bars__row { display: grid; grid-template-columns: minmax(96px, 30%) minmax(0, 1fr) minmax(48px, auto); gap: var(--s-3); align-items: center; font-size: 13.5px; }
.bars__label { color: var(--text-2); min-width: 0; overflow-wrap: anywhere; }
.bars__track { height: 10px; background: var(--surface-2); border-radius: var(--r-pill); overflow: hidden; }
.bars__track i { display: block; height: 100%; min-width: 0; background: var(--accent); border-radius: var(--r-pill); }
.bars__num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
@media (max-width: 760px) {
  .bars__row { grid-template-columns: minmax(0, 1fr) auto; }
  .bars__track { grid-column: 1 / -1; grid-row: 2; }
}
</style>
