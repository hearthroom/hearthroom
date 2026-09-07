<script setup lang="ts">
/**
 * 開場白是 HTML 卡時，用對話頁同一套元件庫（hc-*）把它畫出來。
 *
 * 畫在沙盒 iframe 裡，不畫在本頁的 DOM：作者的卡可以帶 script（這是這個功能的設計，
 * 不是漏洞），但本頁的 localStorage 放著登入憑證。sandbox 只給 allow-scripts、不給
 * allow-same-origin——iframe 是不透明的來源，讀不到本頁的任何東西，卡片仍然照常跑。
 *
 * iframe 的內容（元件庫、樣式、量高度的腳本）在 lib/html-card-frame.ts。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { SIZE_MESSAGE, buildSrcdoc } from "@/lib/html-card-frame";

const props = defineProps<{ html: string; title?: string; extra?: string }>();

const frame = ref<HTMLIFrameElement | null>(null);
const height = ref(120);

/** 本頁當下的文字色與字體，讓沒帶自己配色的卡跟頁面同一個底。 */
function pageTokens(): { color: string; font: string } {
  if (typeof getComputedStyle === "undefined") return { color: "#f2f2f5", font: "system-ui, sans-serif" };
  const cs = getComputedStyle(document.documentElement);
  return { color: cs.getPropertyValue("--text").trim() || "#f2f2f5", font: cs.getPropertyValue("--font").trim() || "system-ui, sans-serif" };
}

const srcdoc = computed(() => buildSrcdoc(props.html, pageTokens(), props.extra ?? ""));

function onMessage(event: MessageEvent) {
  // 只認自己這個 iframe 送來的尺寸；其他來源的訊息一律不理。
  if (!frame.value || event.source !== frame.value.contentWindow) return;
  const data = event.data as { type?: unknown; height?: unknown } | null;
  if (!data || data.type !== SIZE_MESSAGE || typeof data.height !== "number") return;
  height.value = Math.max(48, Math.min(4000, Math.ceil(data.height)));
}

onMounted(() => window.addEventListener("message", onMessage));
onBeforeUnmount(() => window.removeEventListener("message", onMessage));
</script>

<template>
  <iframe
    ref="frame"
    class="hc-frame"
    :srcdoc="srcdoc"
    :title="title"
    sandbox="allow-scripts"
    referrerpolicy="no-referrer"
    loading="lazy"
    :style="{ height: `${height}px` }"
  />
</template>

<style scoped>
.hc-frame { display: block; width: 100%; border: 0; background: transparent; color-scheme: normal; }
</style>
