<script setup lang="ts">
/**
 * 更新紀錄：每次上線了什麼、修好了什麼，依上線日分組。每一則都附「去試試」。
 *
 * 頁首一行講速度（過去 30 天上線幾項、修了幾個），回答「你們到底有沒有在做事」。
 * 打開這頁就算看過全部：首頁提示列與未讀點都收起來。分享出去的連結帶 #說明 id，載入後捲到那一則。
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import type { UpdateItem, UpdatesResponse } from "../../../shared/updates";
import { pageTitle } from "@/lib/i18n";
import { track } from "@/lib/track";
import { fetchUpdates, useUpdates } from "@/lib/updates";
import { useLocalePath } from "@/lib/use-locale";

const { t } = useI18n();
const { lp, locale } = useLocalePath();
const route = useRoute();
const store = useUpdates();
const data = ref<UpdatesResponse | null>(null);
const failed = ref(false);
const loading = ref(true);
const seenBefore = ref(0);
const openFixes = ref<Set<string>>(new Set());
const SOURCES = ["strip", "footer", "menu", "discord", "notification"];

interface Day { key: string; label: string; items: UpdateItem[]; fixes: UpdateItem[] }
const days = computed<Day[]>(() => {
  const groups = new Map<string, Day>();
  const fmt = new Intl.DateTimeFormat(locale.value, { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  for (const item of data.value?.items ?? []) {
    const d = new Date(item.announcedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!groups.has(key)) groups.set(key, { key, label: fmt.format(d), items: [], fixes: [] });
    const g = groups.get(key)!;
    (item.tier === "fix" ? g.fixes : g.items).push(item);
  }
  for (const g of groups.values()) g.items.sort((a, b) => Number(b.tier === "highlight") - Number(a.tier === "highlight"));
  return [...groups.values()];
});
const unseen = (item: UpdateItem) => item.announcedAt > seenBefore.value;

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    data.value = await fetchUpdates(locale.value, "full");
    await nextTick();
    revealHash();
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}
/** 分享連結的 #id：那一則若藏在收合的修正裡，先打開再捲過去。 */
function revealHash() {
  const id = decodeURIComponent(route.hash.replace(/^#/, ""));
  if (!id) return;
  const day = days.value.find((d) => d.fixes.some((f) => f.id === id));
  if (day) openFixes.value = new Set([...openFixes.value, day.key]);
  void nextTick(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
}
function toggleFixes(key: string) {
  const next = new Set(openFixes.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  openFixes.value = next;
}
function tried(item: UpdateItem) {
  track("update_try", { detail: "page", subject: item.id });
}
const feed = computed(() => (locale.value === "zh-Hant" ? "/updates.atom" : `/${locale.value}/updates.atom`));

onMounted(() => {
  document.title = pageTitle(t("updates.title"));
  const from = typeof route.query.from === "string" && SOURCES.includes(route.query.from) ? route.query.from : "direct";
  track("updates_page", { detail: from });
  seenBefore.value = store.ensureState().seenThrough;
  store.acknowledgeAll(false);
  void load();
});
watch(locale, () => { document.title = pageTitle(t("updates.title")); void load(); });
</script>

<template>
  <div class="page page--narrow updates" :aria-busy="loading">
    <header class="updates__head">
      <h1>{{ t("updates.title") }}</h1>
      <p v-if="data" class="updates__lead">{{ t("updates.stats", { days: data.stats.days, features: data.stats.features, fixes: data.stats.fixes }) }}</p>
    </header>

    <p v-if="failed" class="notice notice--error" role="alert">
      {{ t("updates.error") }}
      <button type="button" class="btn btn--sm" @click="load">{{ t("updates.retry") }}</button>
    </p>
    <div v-else-if="loading && !data" class="updates__skeleton" aria-hidden="true"><span /><span /><span /></div>
    <p v-else-if="data && !data.items.length" class="subtle">{{ t("updates.empty") }}</p>

    <section v-for="day in days" :key="day.key" class="updates__day" :aria-label="day.label">
      <h2 class="updates__date">{{ day.label }}</h2>
      <ul v-if="day.items.length" class="updates__list">
        <li v-for="item in day.items" :id="item.id" :key="item.id" class="updates__item" :class="{ 'updates__item--highlight': item.tier === 'highlight' }">
          <span v-if="unseen(item)" class="updates__dot" :title="t('updates.unseen')" />
          <div class="updates__body">
            <p class="updates__tags">
              <span v-if="item.tier === 'highlight'" class="updates__tag updates__tag--highlight">{{ t("updates.highlight") }}</span>
              <span v-if="item.audience === 'authors'" class="updates__tag">{{ t("updates.authors") }}</span>
            </p>
            <h3 class="updates__title">{{ item.title }}</h3>
            <p v-if="item.body" class="updates__desc">{{ item.body }}</p>
            <RouterLink v-if="item.try" class="updates__try" :to="lp(item.try)" @click="tried(item)">{{ t("updates.try") }} →</RouterLink>
          </div>
        </li>
      </ul>
      <div v-if="day.fixes.length" class="updates__fixes">
        <button type="button" class="updates__fixes-toggle" :aria-expanded="openFixes.has(day.key)" @click="toggleFixes(day.key)">
          {{ t("updates.fixes", { n: day.fixes.length }, day.fixes.length) }}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 5 5-5 5" /></svg>
        </button>
        <ul v-if="openFixes.has(day.key)" class="updates__fix-list">
          <li v-for="fix in day.fixes" :id="fix.id" :key="fix.id">
            <span v-if="unseen(fix)" class="updates__dot" :title="t('updates.unseen')" />
            <span>{{ fix.title }}<template v-if="fix.body"> {{ fix.body }}</template></span>
          </li>
        </ul>
      </div>
    </section>

    <p v-if="data && data.items.length" class="updates__feed"><a :href="feed">{{ t("updates.feed") }}</a></p>
  </div>
</template>

<style scoped>
.updates { display: grid; gap: var(--s-5); }
.updates__head { display: grid; gap: var(--s-2); }
.updates__head h1 { margin: 0; font-size: 24px; }
.updates__lead { margin: 0; color: var(--text-2); }
.updates__day { display: grid; gap: var(--s-3); }
.updates__date { margin: 0; font-size: 13px; font-weight: 700; color: var(--text-3); }
.updates__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
.updates__item { position: relative; padding: var(--s-4) var(--s-5); border: 1px solid var(--line-strong); border-radius: var(--r-md); background: var(--surface); scroll-margin-top: 96px; }
.updates__item--highlight { border-color: color-mix(in srgb, var(--accent) 40%, var(--line-strong)); }
.updates__body { display: grid; gap: var(--s-1); min-width: 0; }
.updates__tags { display: flex; gap: var(--s-2); margin: 0; }
.updates__tags:empty { display: none; }
.updates__tag { font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: var(--r-pill); background: var(--surface-2); color: var(--text-2); }
.updates__tag--highlight { background: var(--gold-soft); color: var(--text); }
.updates__title { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.5; }
.updates__desc { margin: 0; color: var(--text-2); font-size: 14px; }
.updates__try { justify-self: start; margin-top: var(--s-1); font-size: 14px; font-weight: 600; color: var(--accent-text); }
.updates__dot { position: absolute; top: var(--s-4); left: var(--s-2); width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.updates__fixes { border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); }
.updates__fixes-toggle { display: flex; align-items: center; gap: var(--s-2); width: 100%; min-height: 44px; padding: 0 var(--s-5); border: 0; background: transparent; color: var(--text-2); font: inherit; font-size: 14px; text-align: start; cursor: pointer; }
.updates__fixes-toggle svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; transition: transform var(--dur) var(--ease); }
.updates__fixes-toggle[aria-expanded="true"] svg { transform: rotate(90deg); }
.updates__fix-list { list-style: none; margin: 0; padding: 0 var(--s-5) var(--s-4); display: grid; gap: var(--s-2); }
.updates__fix-list li { position: relative; padding-left: var(--s-3); color: var(--text); font-size: 14px; scroll-margin-top: 96px; }
.updates__fix-list .updates__dot { top: 8px; left: -2px; }
.updates__feed { margin: 0; font-size: 13px; }
.updates__feed a { color: var(--text-3); }
.updates__skeleton { display: grid; gap: var(--s-3); }
.updates__skeleton span { display: block; height: 88px; border-radius: var(--r-md); background: var(--surface-2); }
</style>
