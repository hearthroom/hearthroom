<script setup lang="ts">
/**
 * 首頁「成就」分頁：三張榜共用一個入口，用分段控制切換。
 *   年度積分（年冠，AnnualBoard）；作者成就（創作與榜單榮譽）；綜合成就（全部，不含消費與邀請，只列公開徽章的成員）。
 * 作者／綜合兩張可看本月或總榜。榜別與期間記在網址（?board=、?period=），分享出去看到的是同一張。
 */
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { fetchAchievementBoard } from "@/lib/api";
import { useLocalePath } from "@/lib/use-locale";
import { hueFrom } from "@/lib/format";
import type { AchievementBoard } from "../../../shared/achievements";
const AnnualBoard = defineAsyncComponent(() => import("./AnnualBoard.vue"));

const { t, locale } = useI18n();
const { lp } = useLocalePath();
const route = useRoute(), router = useRouter();
const KINDS = ["annual", "author", "all"] as const;
type Kind = typeof KINDS[number];
const kind = computed<Kind>(() => (KINDS as readonly string[]).includes(String(route.query.board)) ? route.query.board as Kind : "annual");
const period = computed<"month" | "all">(() => route.query.period === "all" ? "all" : "month");
function go(patch: Record<string, string | undefined>) {
  const query = { ...route.query } as Record<string, string>;
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete query[k]; else query[k] = v; }
  void router.replace({ query });
}
const month = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
const board = ref<AchievementBoard | null>(null), loading = ref(false), failed = ref(false);
let sequence = 0;
async function load() {
  if (kind.value === "annual") return;
  const seq = ++sequence;
  board.value = null; loading.value = true; failed.value = false;
  try { const result = await fetchAchievementBoard(kind.value, period.value === "all" ? "all" : month()); if (seq === sequence) board.value = result; }
  catch { if (seq === sequence) failed.value = true; }
  finally { if (seq === sequence) loading.value = false; }
}
watch([kind, period], load, { immediate: true });
const points = (n: number) => t("achievements.points", { n: new Intl.NumberFormat(locale.value).format(n) });
</script>

<template>
  <section class="achievements">
    <div class="seg achievements__kinds" role="group" :aria-label="t('achievements.kindLabel')">
      <button v-for="k in KINDS" :key="k" type="button" class="seg__item" :class="{ 'seg__item--on': kind === k }" :aria-pressed="kind === k" @click="go({ board: k === 'annual' ? undefined : k, period: undefined })">{{ t(`achievements.kind.${k}`) }}</button>
    </div>

    <AnnualBoard v-if="kind === 'annual'" />
    <template v-else>
      <header class="achievements__head">
        <p class="achievements__intro">{{ t(`achievements.${kind}.intro`) }}</p>
        <div class="seg" role="group" :aria-label="t('achievements.periodLabel')">
          <button v-for="p in (['month', 'all'] as const)" :key="p" type="button" class="seg__item" :class="{ 'seg__item--on': period === p }" :aria-pressed="period === p" @click="go({ period: p === 'month' ? undefined : p })">{{ t(`achievements.period.${p}`) }}</button>
        </div>
      </header>
      <div v-if="failed" class="notice notice--error" role="alert">
        <p>{{ t("achievements.loadFailed") }}</p>
        <button type="button" class="btn" @click="load">{{ t("home.retry") }}</button>
      </div>
      <ol v-else-if="loading && !board" class="achievements__list" aria-hidden="true"><li v-for="i in 5" :key="i" class="ghost achievements__ghost" /></ol>
      <p v-else-if="board && !board.items.length" class="achievements__intro">{{ t(period === 'all' ? 'achievements.empty.all' : 'achievements.empty.month') }}</p>
      <ol v-else-if="board" class="achievements__list">
        <li v-for="item in board.items" :key="item.author.handle" class="achievements__row">
          <span class="achievements__rank" :class="item.rank <= 3 ? `achievements__rank--${item.rank}` : ''">{{ item.rank }}</span>
          <RouterLink :to="lp(`/authors/${item.author.handle}/badges`)" class="achievements__who">
            <img v-if="item.author.avatar" :src="item.author.avatar" alt="" class="achievements__face" />
            <span v-else class="achievements__face mono" :style="{ '--h': hueFrom(item.author.name) }" aria-hidden="true">{{ [...(item.author.name || "?")][0] }}</span>
            <span class="achievements__name">{{ item.author.name }}</span>
          </RouterLink>
          <span class="achievements__level">{{ t("achievements.level", { n: item.level }) }}</span>
          <strong class="achievements__points">{{ points(item.ap) }}</strong>
        </li>
      </ol>
    </template>
  </section>
</template>

<style scoped>
.achievements { display: grid; gap: var(--s-4); max-width: 48rem; }
.achievements__kinds { justify-self: start; max-width: 100%; overflow-x: auto; }
.achievements__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; }
.achievements__intro { margin: 0; line-height: 1.6; color: var(--text-2); max-width: 36rem; }
.achievements__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.achievements__ghost { height: 56px; border-radius: var(--r-md); }
.achievements__row { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto auto; align-items: center; gap: var(--s-3); min-height: 56px; padding: var(--s-2) var(--s-4); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); }
.achievements__rank { font-weight: 800; font-size: 16px; text-align: center; color: var(--text-2); font-variant-numeric: tabular-nums; }
.achievements__rank--1, .achievements__rank--2, .achievements__rank--3 { width: 2rem; height: 2rem; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--r-pill); color: var(--text); }
.achievements__rank--1 { background: color-mix(in srgb, var(--gold) 30%, transparent); }
.achievements__rank--2 { background: color-mix(in srgb, var(--silver) 35%, transparent); }
.achievements__rank--3 { background: color-mix(in srgb, var(--bronze) 30%, transparent); }
.achievements__who { display: flex; align-items: center; gap: var(--s-3); min-width: 0; min-height: 44px; color: inherit; text-decoration: none; }
.achievements__face { width: 36px; height: 36px; flex: none; border-radius: var(--r-pill); object-fit: cover; font-size: 15px; }
.achievements__name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.achievements__level { font-size: 12px; font-weight: 700; color: var(--accent-text); background: var(--accent-tint); padding: 2px 8px; border-radius: var(--r-pill); white-space: nowrap; }
.achievements__points { font-size: 15px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.achievements__intro:lang(ko) { word-break: keep-all; }
.achievements__intro:lang(ja) { word-break: auto-phrase; }
@media (max-width: 480px) { .achievements__row { grid-template-columns: 1.75rem minmax(0, 1fr) auto; } .achievements__level { display: none; } }
</style>
