<script setup lang="ts">
/**
 * 空狀態與錯誤頁上的看板娘插圖（裝飾，alt=""）。標題、說明與她的那句話由呼叫端寫。
 * 不要用在玩卡畫面、編輯器、審核後台（docs/design/hearthroom-mascot/README.md）。
 */
defineProps<{ src: string; size?: number }>();
</script>

<template>
  <img class="mascot-art" :src="src" alt="" :style="{ width: `${size ?? 168}px` }" decoding="async" />
</template>

<style scoped>
.mascot-art { display: block; margin-inline: auto; height: auto; user-select: none; -webkit-user-drag: none; }
@media (max-width: 640px) { .mascot-art { max-width: 40vw; } }
</style>
