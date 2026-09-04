<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<template>
  <div class="page lost">
    <p class="eyebrow">404</p>
    <h1 class="display">找不到這個頁面</h1>
    <p class="muted">連結可能過期了，或是那張卡已經取消登記。</p>
    <RouterLink to="/" class="btn">← 回到榜單</RouterLink>
  </div>
</template>

<style scoped>
.lost { padding-top: var(--s-8); }
h1 { margin: var(--s-2) 0 var(--s-3); font-size: clamp(34px, 6vw, 52px); }
h1 + .muted { margin: 0 0 var(--s-6); }
</style>
