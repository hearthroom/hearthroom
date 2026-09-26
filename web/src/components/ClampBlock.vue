<script setup lang="ts">
/**
 * 內容超過一定高度就收起來，底部淡出，按一下展開。
 *
 * 卡片頁的開場白用它：作者的開場白可以長到好幾千像素（整頁都被它佔掉），但玩家在這裡只是
 * 先看一眼氣氛，要的是開場白的開頭、評論和怎麼玩，不是把開場白讀完（owner 2026-09-26）。
 * 沒展開時一律套上限，內容還在載、還在長高時版面也不會一路往下推。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{ max: number; moreLabel: string; lessLabel: string }>();

const root = ref<HTMLElement | null>(null);
const inner = ref<HTMLElement | null>(null);
const tall = ref(false);
const open = ref(false);
// 只多出一點點就不收：為了幾行字多一個按鈕不划算
const SLACK = 48;

let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!inner.value || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(() => { tall.value = (inner.value?.offsetHeight ?? 0) > props.max + SLACK; });
  observer.observe(inner.value);
});
onBeforeUnmount(() => observer?.disconnect());

function toggle() {
  open.value = !open.value;
  // 收起時開頭可能已經捲出畫面：帶回來，不讓人停在一片空白裡
  if (!open.value && root.value && root.value.getBoundingClientRect().top < 0) root.value.scrollIntoView({ block: "start", behavior: "smooth" });
}
</script>

<template>
  <div ref="root" class="clamp">
    <div class="clamp__view" :class="{ 'clamp__view--cut': tall && !open }" :style="open ? undefined : { maxHeight: `${max + SLACK}px` }">
      <div ref="inner"><slot /></div>
    </div>
    <button v-if="tall" type="button" class="btn btn--sm clamp__toggle" :aria-expanded="open" @click="toggle">
      {{ open ? lessLabel : moreLabel }}
      <svg viewBox="0 0 16 16" aria-hidden="true" :class="{ 'clamp__chev--up': open }"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
  </div>
</template>

<style scoped>
.clamp { display: grid; gap: var(--s-2); justify-items: start; scroll-margin-top: 96px; }
.clamp__view { position: relative; width: 100%; overflow: hidden; }
.clamp__view--cut {
  -webkit-mask-image: linear-gradient(#000 calc(100% - 96px), transparent);
  mask-image: linear-gradient(#000 calc(100% - 96px), transparent);
}
.clamp__toggle { gap: 6px; }
.clamp__toggle svg { width: 14px; height: 14px; transition: transform var(--dur) var(--ease); }
.clamp__chev--up { transform: rotate(180deg); }
</style>
