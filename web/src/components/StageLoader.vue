<script setup lang="ts">
/**
 * 舞台載入中的小人：一條四格的精靈圖（public/stage-loader.webp，784×320，每格 196×320），
 * CSS steps() 逐格切換，就是傳統的幀動畫。舞台套件動態載入要等好幾秒（見 lib/stage-host.ts），
 * 一行灰字會讓人以為頁面卡住了；一個提著燈籠踏步的女孩比轉圈更像「有人在為你開場」。
 * 圖是 gpt-image-2 生成的走路循環，再用腳本切格去底（四格：左腳前、併腳彈起、右腳前、併腳彈起）。
 */
</script>

<template>
  <div class="loader" aria-hidden="true">
    <div class="loader__strip" />
  </div>
</template>

<style scoped>
.loader { --fw: 120px; --fh: 196px; width: var(--fw); height: var(--fh); overflow: hidden; margin: 0 auto; }
.loader__strip {
  width: calc(var(--fw) * 4); height: var(--fh);
  background: url("/stage-loader.webp") 0 0 / 100% 100% no-repeat;
  animation: hr-walk 0.64s steps(4) infinite;
}
@keyframes hr-walk { to { transform: translateX(calc(var(--fw) * -4)); } }
/* base.css 把所有動畫縮成 1ms 跑一次，精靈條會停在最後一格外面變成空白：這裡直接不動，停在第一格 */
@media (prefers-reduced-motion: reduce) { .loader__strip { animation: none !important; } }
</style>
