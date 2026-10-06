<script setup lang="ts">
/**
 * 寫卡指南：開頭讓作者挑一種寫法（GuideStart：AI Agent 或網頁編輯器），下面的內容跟著那種寫法換。
 *
 * - AI Agent：怎麼指揮它（docs/guide/agent-authoring.<語系>.md）。逐欄的參考 Agent 自己會讀：
 *   /guide.md 孿生檔、llms.txt、寫卡技能都有，作者不必看（owner 2026-10-05）。
 * - 網頁編輯器：自己手寫要用的參考（docs/guide/card-authoring.<語系>.md）。
 *
 * 選了哪一種寫在網址的 ?way=web 上（預設 AI Agent），連結分享出去看到同一種；編輯器裡的
 * 「寫卡指南」連結直接帶 ?way=web。切換時只改網址不走路由：路由換 query 會捲回頁首。
 * 五種語系各一份；沒有對應檔的語系退回英文。
 *
 * 參考 Markdown 的標題與第一段只留在給 AI 讀的孿生檔（/guide.md）：頁面上的標題與導言由這裡出，
 * 參考從第一個 ## 開始，否則同一頁會有兩個 h1。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import zhHant from "../../../docs/guide/card-authoring.zh-Hant.md?raw";
import zhHans from "../../../docs/guide/card-authoring.zh-Hans.md?raw";
import en from "../../../docs/guide/card-authoring.en.md?raw";
import ja from "../../../docs/guide/card-authoring.ja.md?raw";
import ko from "../../../docs/guide/card-authoring.ko.md?raw";
import agentZhHant from "../../../docs/guide/agent-authoring.zh-Hant.md?raw";
import agentZhHans from "../../../docs/guide/agent-authoring.zh-Hans.md?raw";
import agentEn from "../../../docs/guide/agent-authoring.en.md?raw";
import agentJa from "../../../docs/guide/agent-authoring.ja.md?raw";
import agentKo from "../../../docs/guide/agent-authoring.ko.md?raw";
import { useRoute } from "vue-router";
import { guideWayOf, type GuideWay } from "@/lib/agent-setup";
import { SOURCE_LOCALE, pageTitle } from "@/lib/i18n";
import GuideStart from "@/components/GuideStart.vue";
import { renderDoc, type TocItem } from "@/lib/markdown-toc";

const SOURCES: Record<string, string> = { "zh-Hant": zhHant, "zh-Hans": zhHans, en, ja, ko };
const AGENT_SOURCES: Record<string, string> = { "zh-Hant": agentZhHant, "zh-Hans": agentZhHans, en: agentEn, ja: agentJa, ko: agentKo };

const { t, locale } = useI18n();
const source = computed(() => SOURCES[String(locale.value)] ?? en);
const body = computed(() => {
  const at = source.value.search(/^## /m);
  return at < 0 ? source.value : source.value.slice(at);
});
const way = ref<GuideWay>(guideWayOf(useRoute().query.way));
watch(way, (next) => {
  const url = new URL(location.href);
  if (next === "web") url.searchParams.set("way", "web");
  else url.searchParams.delete("way");
  url.hash = "";
  const path = url.pathname + url.search;
  // 只改網址列；路由狀態的 current 一起改，返回上一頁時才對得上
  history.replaceState({ ...(history.state ?? {}), current: path }, "", path);
});
const rendered = computed(() => renderDoc(way.value === "agent" ? AGENT_SOURCES[String(locale.value)] ?? agentEn : body.value));
const toc = computed<TocItem[]>(() => [{ level: 2, id: "start", text: t("guide.start.title") }, ...rendered.value.toc]);
const fieldsAnchor = computed(() => rendered.value.toc[0]?.id ?? "start");
const markdownHref = computed(() => `${locale.value === SOURCE_LOCALE ? "" : `/${locale.value}`}/guide.md`);

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
        <header class="doc doc-head">
          <h1>{{ $t("guide.title") }}</h1>
          <p class="doc-head__lead">{{ $t("guide.lead") }}</p>
        </header>
        <GuideStart v-model:way="way" :fields-anchor="fieldsAnchor" :markdown-href="markdownHref" />
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
.doc-head h1 { font-size: clamp(24px, 3vw, 32px); line-height: 1.25; margin: 0 0 var(--s-2); letter-spacing: -0.01em; }
.doc-head__lead { margin: 0 0 var(--s-6); font-size: 16px; line-height: 1.7; color: var(--text-2); }
/* 參考緊接在「開始寫卡」後面：第一節的分隔線與上方留白交給 GuideStart 的下緣 */
.doc--md :deep(h2:first-child) { margin-top: 0; }
.doc :deep(p) { margin: 0 0 var(--s-3); line-height: 1.8; }
.doc :deep(ul), .doc :deep(ol) { margin: 0 0 var(--s-3); padding-left: 1.4em; }
.doc :deep(li) { line-height: 1.8; margin: 2px 0; }
.doc :deep(a) { color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.doc :deep(strong) { font-weight: 600; }
.doc :deep(code) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; padding: 1px 6px; border-radius: 5px; background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); }
.doc :deep(pre) { margin: 0 0 var(--s-4); padding: var(--s-3) var(--s-4); overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; border-radius: var(--r-md); background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); font-size: 13px; line-height: 1.6; }
.doc :deep(pre code) { padding: 0; background: none; box-shadow: none; font-size: inherit; }
.doc :deep(blockquote) { margin: 0 0 var(--s-3); padding: var(--s-2) var(--s-4); border-left: 3px solid var(--accent); background: var(--accent-tint); border-radius: 0 var(--r-sm) var(--r-sm) 0; color: var(--text-2); }
.doc :deep(blockquote p:last-child) { margin-bottom: 0; }
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
