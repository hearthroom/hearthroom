<script setup lang="ts">
/**
 * 開發者文件：把 docs/provider-protocol.md 畫成一頁可讀的文件（照 GitBook 那種讀法）。
 *
 * 文件住在倉庫裡、跟程式碼同一次提交改（test/protocol-doc.test.ts 守著），這頁只是它的視窗——
 * 不另外維護一份站上的版本。左邊是從 h2／h3 抽出來的目錄，捲到哪一節就亮哪一條；
 * 窄螢幕時目錄收成頂端一個可展開的區塊。標題有 id，目錄與外部連結都跳得到。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import doc from "../../../docs/provider-protocol.md?raw";
import { pageTitle } from "@/lib/i18n";
import { renderDoc } from "@/lib/markdown-toc";
import { SITE } from "@/lib/site";

const { t } = useI18n();
const rendered = computed(() => renderDoc(doc));
const sourceUrl = `${SITE.repoUrl}/blob/main/docs/provider-protocol.md`;

const article = ref<HTMLElement | null>(null);
const activeId = ref("");
let observer: IntersectionObserver | undefined;

onMounted(() => {
  document.title = pageTitle(t("developers.title"));
  // 進到視窗上緣附近的那個標題就是「現在在讀的」：rootMargin 把觀察帶壓到上面一小段，
  // 不然一屏裡有三個標題時三條都亮
  const headings = [...(article.value?.querySelectorAll<HTMLElement>("h2[id], h3[id]") ?? [])];
  if (!headings.length || typeof IntersectionObserver === "undefined") return;
  observer = new IntersectionObserver(
    (entries) => {
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) activeId.value = (hit.target as HTMLElement).id;
    },
    { rootMargin: "-72px 0px -70% 0px", threshold: 0 },
  );
  for (const h of headings) observer.observe(h);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="page page--doc">
    <div class="doc-layout">
      <!-- 目錄：寬螢幕黏在左邊；窄螢幕收成頂端一個可展開的區塊 -->
      <aside class="toc">
        <details class="toc__fold" open>
          <summary class="toc__title eyebrow">{{ $t("developers.toc") }}</summary>
          <nav :aria-label="$t('developers.toc')">
            <ul class="toc__list">
              <li v-for="item in rendered.toc" :key="item.id" :class="[`toc__item--h${item.level}`, { 'toc__item--on': activeId === item.id }]">
                <a :href="`#${item.id}`" class="toc__link">{{ item.text }}</a>
              </li>
            </ul>
          </nav>
          <a :href="sourceUrl" target="_blank" rel="noopener" class="toc__source subtle">{{ $t("developers.source") }}</a>
        </details>
      </aside>

      <article ref="article" class="doc" v-html="rendered.html" />
    </div>
  </div>
</template>

<style scoped>
.page--doc { max-width: 1120px; }
.doc-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: var(--s-7); align-items: start; }

/* ---- 目錄 ---- */
.toc { position: sticky; top: calc(var(--header-h) + var(--s-4)); max-height: calc(100vh - var(--header-h) - var(--s-6)); overflow-y: auto; }
.toc__fold > summary { list-style: none; cursor: default; }
.toc__fold > summary::-webkit-details-marker { display: none; }
.toc__title { margin: 0 0 var(--s-2); padding-left: 12px; }
.toc__list { list-style: none; margin: 0; padding: 0; border-left: 1px solid var(--line); }
.toc__link {
  display: block; padding: 5px 12px; margin-left: -1px; border-left: 2px solid transparent;
  font-size: 13px; line-height: 1.4; color: var(--text-2);
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.toc__item--h3 .toc__link { padding-left: 24px; font-size: 12.5px; color: var(--text-3); }
.toc__link:hover { color: var(--text); }
.toc__item--on > .toc__link { color: var(--accent-text); border-left-color: var(--accent); font-weight: 600; }
.toc__source { display: block; margin-top: var(--s-4); padding-left: 12px; }

/* ---- 正文：一欄、字距鬆一點、標題有節奏，像 GitBook ---- */
.doc { max-width: 76ch; font-size: 15px; }
.doc :deep(h1) { font-size: clamp(24px, 3vw, 32px); line-height: 1.25; margin: 0 0 var(--s-4); letter-spacing: -0.01em; }
.doc :deep(h2) { font-size: 20px; line-height: 1.3; margin: var(--s-7) 0 var(--s-3); padding-top: var(--s-4); border-top: 1px solid var(--line); scroll-margin-top: calc(var(--header-h) + var(--s-4)); }
.doc :deep(h3) { font-size: 16px; margin: var(--s-5) 0 var(--s-2); scroll-margin-top: calc(var(--header-h) + var(--s-4)); }
.doc :deep(h1:first-child) { margin-top: 0; }
.doc :deep(p) { margin: 0 0 var(--s-3); line-height: 1.8; }
.doc :deep(ul), .doc :deep(ol) { margin: 0 0 var(--s-3); padding-left: 1.4em; }
.doc :deep(li) { line-height: 1.8; margin: 2px 0; }
.doc :deep(a) { color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.doc :deep(a:hover) { text-decoration-color: currentColor; }
.doc :deep(strong) { font-weight: 600; }
.doc :deep(code) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; padding: 1px 6px; border-radius: 5px; background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); }
.doc :deep(pre) { margin: 0 0 var(--s-4); padding: var(--s-3) var(--s-4); overflow-x: auto; border-radius: var(--r-md); background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); font-size: 13px; line-height: 1.6; }
.doc :deep(pre code) { padding: 0; background: none; box-shadow: none; font-size: inherit; }
.doc :deep(blockquote) { margin: 0 0 var(--s-3); padding: var(--s-2) var(--s-4); border-left: 3px solid var(--accent); background: var(--accent-tint); border-radius: 0 var(--r-sm) var(--r-sm) 0; color: var(--text-2); }
.doc :deep(blockquote p:last-child) { margin-bottom: 0; }
.doc :deep(hr) { border: 0; border-top: 1px solid var(--line); margin: var(--s-6) 0; }
.doc :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; width: 100%; font-size: 13.5px; margin: var(--s-2) 0 var(--s-4); }
.doc :deep(th), .doc :deep(td) { padding: 8px 12px; border: 1px solid var(--line); text-align: left; vertical-align: top; line-height: 1.6; }
.doc :deep(th) { background: var(--surface-2); font-weight: 600; }
/*
 * 欄寬：短欄（項目／憑證／誰呼叫）不能被長的說明欄擠成一個字一行，所以每格給個最小寬度；
 * 第一欄的文字標籤不換行，但裡面的路徑 code 要允許在任意處折行，不然四欄表的第一欄會撐到把別欄擠扁。
 */
.doc :deep(td), .doc :deep(th) { min-width: 5.5em; }
.doc :deep(td:first-child), .doc :deep(th:first-child) { white-space: nowrap; }
.doc :deep(td:first-child code) { white-space: normal; overflow-wrap: anywhere; }
.doc :deep(tr:nth-child(even) td) { background: color-mix(in srgb, var(--surface-2) 45%, transparent); }

@media (max-width: 900px) {
  .doc-layout { grid-template-columns: minmax(0, 1fr); gap: var(--s-4); }
  .toc { position: static; max-height: none; }
  .toc__fold { padding: var(--s-3) var(--s-4); background: var(--surface); border-radius: var(--r-lg); box-shadow: 0 0 0 1px var(--line); }
  .toc__fold > summary { cursor: pointer; padding-left: 0; }
  .toc__fold:not([open]) .toc__title { margin-bottom: 0; }
  .toc__source { padding-left: 0; }
}
</style>
