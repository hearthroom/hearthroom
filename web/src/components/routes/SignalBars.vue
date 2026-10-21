<script setup lang="ts">
/**
 * 線路的訊號圖示：三根由低到高的直條，狀態看亮幾格，不靠顏色（快 3、普通 2、慢 1、連不上 0 加一條斜線）。
 * 亮格是目前文字色，未亮格同色降透明（淺色 .3、深色 .4，深色再淡就看不出是訊號）；斜線同色，不用錯誤紅。
 * 檢查中三格輪流亮；減少動態時改成靜態 0 格，旁邊的文字說「檢查中」。純裝飾，文字另外寫（ui.md §3.3）。
 */
defineProps<{ level: 0 | 1 | 2 | 3; checking?: boolean; down?: boolean }>();
const BARS = [
  { x: 5, top: 12.5 },
  { x: 10, top: 8.5 },
  { x: 15, top: 4.5 },
] as const;
</script>

<template>
  <svg class="bars" :class="{ 'bars--checking': checking }" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
    <path v-for="(b, i) in BARS" :key="i" :d="`M${b.x} 16V${b.top}`" :class="{ on: !checking && !down && i < level }" />
    <path v-if="down" class="on" d="M3 3l14 14" />
  </svg>
</template>

<style scoped>
.bars { width: 18px; height: 18px; flex: none; }
.bars path { opacity: 0.3; }
:global([data-mode="dark"]) .bars path { opacity: 0.4; }
.bars path.on, :global([data-mode="dark"]) .bars path.on { opacity: 1; }
.bars--checking path { animation: bar 1.2s var(--ease) infinite; }
.bars--checking path:nth-child(2) { animation-delay: 0.2s; }
.bars--checking path:nth-child(3) { animation-delay: 0.4s; }
@keyframes bar { 0%, 100% { opacity: 0.3; } 40% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .bars--checking path { animation: none; } }
</style>
