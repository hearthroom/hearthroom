<template>
  <span class="route-spin" aria-hidden="true" />
</template>

<style scoped>
/* 換線路的等待：跳數與耗時都不固定，不給進度條，只轉一個圈 */
.route-spin {
  display: inline-block; flex: none; width: 16px; height: 16px; border-radius: var(--r-pill);
  border: 2px solid var(--line-strong); border-top-color: currentColor;
  animation: route-spin 0.8s linear infinite;
}
@keyframes route-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .route-spin { animation: none; border-color: currentColor; border-right-color: transparent; } }
</style>
