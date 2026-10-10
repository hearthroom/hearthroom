<script setup lang="ts">
/**
 * 作者寫的介紹（Markdown → HTML，見 lib/card-readme.ts）。卡片頁與編輯器的預覽共用，兩邊看到的一樣。
 * 傳 html（已經算好的）或 source（原文），擇一。
 */
import { computed } from "vue";
import { renderReadme } from "@/lib/card-readme";

const props = defineProps<{ html?: string; source?: string }>();
const out = computed(() => props.html ?? (props.source?.trim() ? renderReadme(props.source) : ""));
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- 介紹只收 Markdown，不收內嵌 HTML（見 lib/card-readme.ts） -->
  <div class="readme" v-html="out" />
</template>

<style scoped>
/* 標題已經降兩級（h3 起），顏色全走設計變數，日夜模式一起換 */
.readme { max-width: 72ch; font-size: 15px; line-height: 1.8; overflow-wrap: anywhere; }
.readme :deep(> :first-child) { margin-top: 0; }
.readme :deep(> :last-child) { margin-bottom: 0; }
.readme :deep(p) { margin: 0.6em 0; }
.readme :deep(h3) { margin: 1.4em 0 0.5em; padding-bottom: 0.3em; font-size: 20px; box-shadow: 0 1px 0 var(--line); }
.readme :deep(h4) { margin: 1.2em 0 0.4em; font-size: 17px; }
.readme :deep(h5), .readme :deep(h6) { margin: 1em 0 0.3em; font-size: 15px; }
.readme :deep(ul), .readme :deep(ol) { margin: 0.5em 0; padding-left: 1.4em; }
.readme :deep(a) { color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; }
.readme :deep(img) { max-width: 100%; height: auto; border-radius: var(--r-md); }
.readme :deep(blockquote) { margin: 1em 0; padding: 0.2em 1em; border-left: 3px solid var(--accent); border-radius: 0 var(--r-sm) var(--r-sm) 0; background: var(--surface-2); color: var(--text-2); }
.readme :deep(code) { padding: 1px 6px; border-radius: 4px; background: var(--surface-2); font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.88em; }
.readme :deep(pre) { overflow-x: auto; padding: var(--s-3) var(--s-4); border-radius: var(--r-md); background: var(--surface-2); }
.readme :deep(pre code) { padding: 0; background: none; }
.readme :deep(hr) { height: 1px; margin: 1.5em 0; border: 0; background: var(--line); }
.readme :deep(.readme__table) { margin: 1em 0; overflow-x: auto; }
.readme :deep(table) { width: 100%; border-collapse: collapse; font-size: 14px; }
.readme :deep(th), .readme :deep(td) { padding: 8px 12px; text-align: left; box-shadow: inset 0 -1px 0 var(--line); }
.readme :deep(th) { color: var(--text-2); font-weight: 600; }
</style>
