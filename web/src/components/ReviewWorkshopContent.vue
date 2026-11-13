<script setup lang="ts">
/**
 * 擴充的完整內容（介紹＋常駐、世界書、正規表示式、開場白）：每類一行摘要，展開看原文。
 * 審核詳情（ReviewWorkshopDetail）與站方的擴充申訴頁共用這一段，兩邊讀到的是同一份畫法，
 * 站方判申訴時看到的內容就是審核員當初看到的樣子。
 *
 * 只 import vue-i18n 與 lib/workshop 的常數、型別用 import type：審核頁的測試把 lib/api 整個換成假物件，
 * 這裡多讀一個 api 的值，那些測試在載入時就會壞。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { CONSTANT_CHAR_LIMIT } from "@/lib/workshop";
import type { WorkshopReviewDetail } from "@/lib/workshop-review";

const props = defineProps<{ workshop: WorkshopReviewDetail["workshop"] }>();
const { t, locale } = useI18n();
const numbers = computed(() => new Intl.NumberFormat(String(locale.value)));

/** 內容四類＋介紹：每類一行摘要，展開看原文。沒有內容的類別不給展開，只寫數量 */
const sections = computed(() => {
  const ws = props.workshop;
  const constant = ws.entries.filter((e) => e.isConstant);
  const n = (x: number) => numbers.value.format(x);
  return [
    {
      id: "about", title: t("workshop.detail.tab.about"), meta: "", preview: ws.description,
      items: ws.description.trim() ? [{ key: "about", head: "", chips: [] as string[], body: ws.description, body2: "", off: false }] : [],
    },
    {
      id: "resident", title: t("workshop.editor.resident.title"),
      meta: t("workshop.review.resident.size", { chars: n(ws.residentChars), max: n(ws.residentMax || CONSTANT_CHAR_LIMIT) }),
      preview: constant[0]?.content ?? t("workshop.detail.resident.none"),
      items: constant.map((e) => ({ key: e.entryId, head: e.name || t("wb.entry.untitled"), chips: e.isEnabled ? [] : [t("review.entry.disabled")], body: e.content, body2: "", off: !e.isEnabled })),
    },
    {
      id: "lore", title: t("workshop.detail.includes.lore", { n: n(ws.entries.length) }, ws.entries.length), meta: "",
      preview: ws.entries.map((e) => e.name || t("wb.entry.untitled")).join(" · "),
      items: ws.entries.map((e) => ({
        key: e.entryId, head: e.name || t("wb.entry.untitled"),
        chips: [...(e.isConstant ? [t("review.entry.constant")] : []), ...(e.isEnabled ? [] : [t("review.entry.disabled")]), ...e.keywords, ...e.secondaryKeywords],
        body: e.content, body2: "", off: !e.isEnabled,
      })),
    },
    {
      id: "regex", title: t("workshop.detail.includes.regex", { n: n(ws.rules.length) }, ws.rules.length), meta: "",
      preview: ws.rules.map((r) => r.name || r.id).join(" · "),
      items: ws.rules.map((r) => ({ key: r.id, head: r.name || r.id, chips: r.enabled ? [] : [t("review.entry.disabled")], body: r.find, body2: r.replace, off: !r.enabled })),
    },
    {
      id: "opening", title: t("workshop.detail.includes.opening", { n: n(ws.openings.length) }, ws.openings.length), meta: "",
      preview: ws.openings[0]?.content ?? "",
      items: ws.openings.map((o) => ({ key: o.id, head: o.title, chips: [] as string[], body: o.content, body2: "", off: false })),
    },
  ];
});
</script>

<template>
  <section class="panel wsr__pane">
    <h2 class="wsr__lab">{{ $t("workshop.review.content") }}</h2>
    <template v-for="s in sections" :key="s.id">
      <details v-if="s.items.length" class="wsr__item" :data-content="s.id">
        <summary class="wsr__sum">
          <span class="wsr__sumtop"><strong>{{ s.title }}</strong><span v-if="s.meta" class="subtle">{{ s.meta }}</span></span>
          <span v-if="s.preview" class="wsr__preview">{{ s.preview }}</span>
        </summary>
        <div class="wsr__full">
          <div v-for="it in s.items" :key="it.key" class="wsr__entry" :class="{ 'wsr__entry--off': it.off }">
            <p v-if="it.head || it.chips.length" class="wsr__entryhead"><strong v-if="it.head">{{ it.head }}</strong><span v-for="(c, i) in it.chips" :key="i" class="chip">{{ c }}</span></p>
            <pre class="wsr__text">{{ it.body }}</pre>
            <pre v-if="it.body2" class="wsr__text wsr__text--mono">{{ it.body2 }}</pre>
          </div>
        </div>
      </details>
      <div v-else-if="s.id !== 'about'" class="wsr__item wsr__item--empty" :data-content="s.id">
        <span class="wsr__sumtop"><strong>{{ s.title }}</strong><span v-if="s.meta" class="subtle">{{ s.meta }}</span></span>
        <span v-if="s.id === 'resident'" class="wsr__preview">{{ s.preview }}</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* .wsr__pane／.wsr__lab 與審核詳情的其他面板同一組數字；申訴頁沒有那份樣式可繼承，所以這裡自帶一份 */
.wsr__pane { padding: var(--s-4); display: grid; gap: var(--s-3); min-width: 0; }
.wsr__lab { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-2); }
.wsr__item { border-top: 1px solid var(--line); padding-top: var(--s-3); min-width: 0; }
.wsr__lab + .wsr__item { border-top: 0; padding-top: 0; }
.wsr__item--empty { display: grid; gap: 2px; }
.wsr__sum { display: grid; gap: 2px; cursor: pointer; min-height: var(--h-md); align-content: center; }
.wsr__sumtop { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-2); }
.wsr__preview { font-size: 13px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsr__item[open] .wsr__preview { display: none; }
.wsr__full { display: grid; gap: var(--s-3); margin-top: var(--s-3); }
.wsr__entry { display: grid; gap: var(--s-2); min-width: 0; }
.wsr__entry--off { opacity: 0.6; }
.wsr__entryhead { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); font-size: 14px; }
.wsr__text { margin: 0; padding: var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 360px; overflow: auto; }
.wsr__text--mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
</style>
