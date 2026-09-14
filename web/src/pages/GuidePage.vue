<script setup lang="ts">
/**
 * 寫卡指南：給作者的說明書（docs/guide/card-authoring.<語系>.md），跟開發者文件同一套目錄與排版。
 * 五種語系各一份；沒有對應檔的語系退回英文。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import zhHant from "../../../docs/guide/card-authoring.zh-Hant.md?raw";
import zhHans from "../../../docs/guide/card-authoring.zh-Hans.md?raw";
import en from "../../../docs/guide/card-authoring.en.md?raw";
import ja from "../../../docs/guide/card-authoring.ja.md?raw";
import ko from "../../../docs/guide/card-authoring.ko.md?raw";
import { pageTitle } from "@/lib/i18n";
import { renderDoc, type TocItem } from "@/lib/markdown-toc";

const SOURCES: Record<string, string> = { "zh-Hant": zhHant, "zh-Hans": zhHans, en, ja, ko };

const { t, locale } = useI18n();
const source = computed(() => SOURCES[String(locale.value)] ?? en);
const rendered = computed(() => renderDoc(source.value));
const toc = computed<TocItem[]>(() => rendered.value.toc);

const article = ref<HTMLElement | null>(null);
const tocOpen = ref(true);
const activeId = ref("");
let observer: IntersectionObserver | undefined;

function observe() {
  observer?.disconnect();
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
}

onMounted(async () => {
  document.title = pageTitle(t("guide.title"));
  if (window.matchMedia?.("(max-width: 900px)").matches) tocOpen.value = false;
  await nextTick();
  observe();
});
watch(rendered, async () => { await nextTick(); observe(); });
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="page page--doc">
    <div class="doc-layout">
      <aside class="toc">
        <details class="toc__fold" :open="tocOpen">
          <summary class="toc__title eyebrow">{{ $t("developers.toc") }}</summary>
          <nav :aria-label="$t('developers.toc')">
            <ul class="toc__list">
              <li v-for="item in toc" :key="item.id" :class="[`toc__item--h${item.level}`, { 'toc__item--on': activeId === item.id }]">
                <a :href="`#${item.id}`" class="toc__link">{{ item.text }}</a>
              </li>
            </ul>
          </nav>
        </details>
      </aside>
      <div ref="article" class="doc-body">
        <article class="doc doc--md" v-html="rendered.html" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page--doc { max-width: 1180px; }
.doc-layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: var(--s-7); align-items: start; }
.toc { position: sticky; top: calc(var(--header-h) + var(--s-4)); max-height: calc(100vh - var(--header-h) - var(--s-6)); overflow-y: auto; }
.toc__fold > summary { list-style: none; cursor: default; }
.toc__fold > summary::-webkit-details-marker { display: none; }
.toc__title { margin: 0 0 var(--s-2); padding-left: 12px; }
.toc__list { list-style: none; margin: 0; padding: 0; border-left: 1px solid var(--line); }
.toc__link {
  display: block; padding: 4px 12px; margin-left: -1px; border-left: 2px solid transparent;
  font-size: 13px; line-height: 1.4; color: var(--text-2);
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
  overflow-wrap: anywhere;
}
.toc__item--h3 .toc__link { padding-left: 24px; font-size: 12px; color: var(--text-3); }
.toc__link:hover { color: var(--text); }
.toc__item--on > .toc__link { color: var(--accent-text); border-left-color: var(--accent); font-weight: 600; }
.doc-body { min-width: 0; }
.doc { max-width: 80ch; font-size: 15px; }
.doc :deep(h1) { font-size: clamp(24px, 3vw, 32px); line-height: 1.25; margin: 0 0 var(--s-4); letter-spacing: -0.01em; }
.doc :deep(h2) { font-size: 20px; line-height: 1.3; margin: var(--s-7) 0 var(--s-3); padding-top: var(--s-4); border-top: 1px solid var(--line); scroll-margin-top: calc(var(--header-h) + var(--s-4)); }
.doc :deep(h3) { font-size: 16px; margin: var(--s-5) 0 var(--s-2); scroll-margin-top: calc(var(--header-h) + var(--s-4)); }
.doc :deep(h1:first-child) { margin-top: 0; }
.doc :deep(p) { margin: 0 0 var(--s-3); line-height: 1.8; }
.doc :deep(ul), .doc :deep(ol) { margin: 0 0 var(--s-3); padding-left: 1.4em; }
.doc :deep(li) { line-height: 1.8; margin: 2px 0; }
.doc :deep(a) { color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.doc :deep(strong) { font-weight: 600; }
.doc :deep(code) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; padding: 1px 6px; border-radius: 5px; background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); }
.doc :deep(pre) { margin: 0 0 var(--s-4); padding: var(--s-3) var(--s-4); overflow-x: auto; border-radius: var(--r-md); background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); font-size: 13px; line-height: 1.6; }
.doc :deep(pre code) { padding: 0; background: none; box-shadow: none; font-size: inherit; }
.doc :deep(blockquote) { margin: 0 0 var(--s-3); padding: var(--s-2) var(--s-4); border-left: 3px solid var(--accent); background: var(--accent-tint); border-radius: 0 var(--r-sm) var(--r-sm) 0; color: var(--text-2); }
.doc--md :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; width: 100%; font-size: 13.5px; margin: var(--s-2) 0 var(--s-4); }
.doc--md :deep(th), .doc--md :deep(td) { padding: 8px 12px; border: 1px solid var(--line); text-align: left; vertical-align: top; line-height: 1.6; }
.doc--md :deep(th) { background: var(--surface-2); font-weight: 600; }
.doc--md :deep(td:first-child code) { white-space: normal; overflow-wrap: anywhere; }
.doc--md :deep(tr:nth-child(even) td) { background: color-mix(in srgb, var(--surface-2) 45%, transparent); }
@media (max-width: 900px) {
  .doc-layout { grid-template-columns: minmax(0, 1fr); gap: var(--s-4); }
  .toc { position: static; max-height: none; }
  .toc__fold { padding: var(--s-3) var(--s-4); background: var(--surface); border-radius: var(--r-lg); box-shadow: 0 0 0 1px var(--line); }
  .toc__fold > summary { cursor: pointer; padding-left: 0; display: flex; align-items: center; justify-content: space-between; }
}
</style>
