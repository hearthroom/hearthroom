<script setup lang="ts">
/**
 * 開發者頁：把 docs/provider-protocol.md 原樣畫出來。
 *
 * 文件住在倉庫裡、跟程式碼同一次提交改（test/protocol-doc.test.ts 守著），這頁只是它的視窗——
 * 不另外維護一份站上的版本。文件是純 Markdown，不允許內嵌 HTML（html: false）。
 */
import MarkdownIt from "markdown-it";
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import doc from "../../../docs/provider-protocol.md?raw";
import { pageTitle } from "@/lib/i18n";
import { SITE } from "@/lib/site";

const { t } = useI18n();
const md = new MarkdownIt({ html: false, linkify: true });
const html = computed(() => md.render(doc));
const sourceUrl = `${SITE.repoUrl}/blob/main/docs/provider-protocol.md`;

onMounted(() => {
  document.title = pageTitle(t("developers.title"));
});
</script>

<template>
  <div class="page page--doc">
    <p class="subtle doc__source">
      <a :href="sourceUrl" target="_blank" rel="noopener">{{ $t("developers.source") }}</a>
    </p>
    <article class="doc" v-html="html" />
  </div>
</template>

<style scoped>
.page--doc { max-width: 860px; }
.doc__source { margin: 0 0 var(--s-3); }
.doc :deep(h1) { font-size: clamp(22px, 2.8vw, 28px); margin: 0 0 var(--s-3); }
.doc :deep(h2) { font-size: 18px; margin: var(--s-6) 0 var(--s-2); padding-top: var(--s-3); border-top: 1px solid var(--line); }
.doc :deep(h3) { font-size: 15px; margin: var(--s-4) 0 var(--s-2); }
.doc :deep(p), .doc :deep(li) { line-height: 1.7; }
.doc :deep(code) { font-size: 0.9em; padding: 1px 5px; border-radius: 4px; background: var(--surface-2); }
.doc :deep(table) { border-collapse: collapse; width: 100%; font-size: 13.5px; margin: var(--s-2) 0 var(--s-3); }
.doc :deep(th), .doc :deep(td) { padding: 6px 10px; border: 1px solid var(--line); text-align: left; vertical-align: top; }
.doc :deep(th) { background: var(--surface-2); font-weight: 600; }
/* 寬表格自己捲，不讓整頁橫捲：markdown-it 沒有 wrapper，靠 table 本身的 display 處理 */
.doc :deep(table) { display: block; overflow-x: auto; }
</style>
