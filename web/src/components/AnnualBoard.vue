<script setup lang="ts">
/**
 * 首頁「年度」分頁：年度榜單積分（年冠）。當年發布的卡片拿到的日／週／月榜名次換成積分，作者全年累加；
 * 清水、綜合分開計。結算前是暫定排名，規則表就放在榜的下方，不另開頁面。
 */
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { fetchAnnualBoard } from "@/lib/api";
import { useLocalePath } from "@/lib/use-locale";
import { hueFrom } from "@/lib/format";
import { ANNUAL_CROWN_REWARD, ANNUAL_FIRST_YEAR, ANNUAL_POINTS, annualYearOf, type AnnualBoard } from "../../../shared/annual-honors";

const { t, locale } = useI18n();
const { lp } = useLocalePath();
const zone = ref<"all" | "clean">("all");
const year = Math.max(ANNUAL_FIRST_YEAR, annualYearOf(Date.now()));
const board = ref<AnnualBoard | null>(null), loading = ref(false), failed = ref(false);
let sequence = 0;
async function load() {
  const seq = ++sequence;
  loading.value = true; failed.value = false;
  try { const result = await fetchAnnualBoard(zone.value, year); if (seq === sequence) board.value = result; }
  catch { if (seq === sequence) failed.value = true; }
  finally { if (seq === sequence) loading.value = false; }
}
watch(zone, () => { board.value = null; void load(); }, { immediate: true });

/** 2026 是第一屆，叫開元年冠；之後照年份叫。 */
const crown = computed(() => year === ANNUAL_FIRST_YEAR ? t("annual.crown.first") : t("annual.crown", { year }));
const settleDate = computed(() => board.value ? new Intl.DateTimeFormat(locale.value, { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Taipei" }).format(board.value.settlesAt) : "");
const reward = computed(() => new Intl.NumberFormat(locale.value).format(ANNUAL_CROWN_REWARD));
const windows = ["day", "week", "month"] as const;
const bands = [1, 3, 10] as const;
</script>

<template>
  <section class="annual" aria-labelledby="annual-title">
    <header class="annual__head">
      <div>
        <h2 id="annual-title" class="annual__title">{{ t("annual.title", { year }) }}</h2>
        <p class="annual__intro">{{ t("annual.intro", { year, crown }) }}</p>
      </div>
      <div class="seg" role="group" :aria-label="t('annual.zoneLabel')">
        <button v-for="z in (['all', 'clean'] as const)" :key="z" type="button" class="seg__item" :class="{ 'seg__item--on': zone === z }" :aria-pressed="zone === z" @click="zone = z">{{ t(`honor.zone.${z}`) }}</button>
      </div>
    </header>

    <p v-if="board" class="annual__status" role="status">{{ board.settled ? t("annual.settled", { year }) : t("annual.provisional", { year, date: settleDate }) }}</p>

    <div v-if="failed" class="notice notice--error" role="alert">
      <p>{{ t("annual.loadFailed") }}</p>
      <button type="button" class="btn" @click="load">{{ t("home.retry") }}</button>
    </div>
    <ol v-else-if="loading && !board" class="annual__list" aria-hidden="true"><li v-for="i in 5" :key="i" class="ghost annual__ghost" /></ol>
    <p v-else-if="board && !board.items.length" class="annual__empty">{{ t("annual.empty", { year }) }}</p>
    <ol v-else-if="board" class="annual__list">
      <li v-for="item in board.items" :key="item.rank" class="annual__row" :class="{ 'annual__row--crown': item.rank === 1 }">
        <span class="annual__rank" :class="item.rank <= 3 ? `annual__rank--${item.rank}` : ''">{{ item.rank }}</span>
        <component :is="item.author.handle ? RouterLink : 'span'" :to="item.author.handle ? lp(`/authors/${item.author.handle}`) : undefined" class="annual__who">
          <img v-if="item.author.avatar" :src="item.author.avatar" alt="" class="annual__face" />
          <span v-else class="annual__face mono" :style="{ '--h': hueFrom(item.author.name) }" aria-hidden="true">{{ [...(item.author.name || "?")][0] }}</span>
          <span class="annual__name">{{ item.author.name }}</span>
        </component>
        <span class="annual__detail">{{ t("annual.detail", { firsts: item.firsts, top3: item.top3 }) }}</span>
        <strong class="annual__points">{{ t("annual.points", { n: item.points }) }}</strong>
      </li>
    </ol>

    <details class="annual__rules">
      <summary>{{ t("annual.rules.title") }}</summary>
      <p>{{ t("annual.rules.body", { year }) }}</p>
      <table class="annual__table">
        <thead><tr><th scope="col"><span class="sr-only">{{ t("annual.rules.board") }}</span></th><th v-for="b in bands" :key="b" scope="col">{{ t(`honor.band.${b}`) }}</th></tr></thead>
        <tbody><tr v-for="w in windows" :key="w"><th scope="row">{{ t(`honor.window.${w}`) }}</th><td v-for="b in bands" :key="b">{{ ANNUAL_POINTS[w][b] }}</td></tr></tbody>
      </table>
      <p>{{ t("annual.rules.reward", { crown, reward, year }) }}</p>
    </details>
  </section>
</template>

<style scoped>
.annual { display: grid; gap: var(--s-4); max-width: 48rem; }
.annual__head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--s-4); flex-wrap: wrap; }
.annual__title { margin: 0; font-size: 20px; font-weight: 700; }
.annual__intro, .annual__status, .annual__empty, .annual__rules p { margin: var(--s-2) 0 0; line-height: 1.6; color: var(--text-2); max-width: 40rem; }
.annual__status { margin: 0; font-size: 13px; color: var(--text-3); }
.annual__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.annual__ghost { height: 56px; border-radius: var(--r-md); }
.annual__row { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto auto; align-items: center; gap: var(--s-3); min-height: 56px; padding: var(--s-2) var(--s-4); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); }
.annual__row--crown { border-color: var(--gold); }
.annual__rank { font-weight: 800; font-size: 16px; text-align: center; color: var(--text-2); font-variant-numeric: tabular-nums; }
/* 前三名用名次色當淡底、字維持正文色：金色字在淺色底上過不了 4.5:1 */
.annual__rank--1, .annual__rank--2, .annual__rank--3 { width: 2rem; height: 2rem; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--r-pill); color: var(--text); }
.annual__rank--1 { background: color-mix(in srgb, var(--gold) 30%, transparent); }
.annual__rank--2 { background: color-mix(in srgb, var(--silver) 35%, transparent); }
.annual__rank--3 { background: color-mix(in srgb, var(--bronze) 30%, transparent); }
.annual__who { display: flex; align-items: center; gap: var(--s-3); min-width: 0; min-height: 44px; color: inherit; text-decoration: none; }
.annual__face { width: 36px; height: 36px; flex: none; border-radius: var(--r-pill); object-fit: cover; font-size: 15px; }
.annual__name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.annual__detail { font-size: 13px; color: var(--text-3); white-space: nowrap; }
.annual__points { font-size: 15px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.annual__rules summary { display: flex; align-items: center; min-height: 44px; cursor: pointer; font-weight: 600; color: var(--text-2); }
.annual__table { margin-top: var(--s-3); border-collapse: collapse; font-variant-numeric: tabular-nums; }
.annual__table th, .annual__table td { padding: var(--s-2) var(--s-4); text-align: center; border-bottom: 1px solid var(--line); }
.annual__table tbody th { text-align: start; font-weight: 600; }
@media (max-width: 640px) {
  .annual__row { grid-template-columns: 1.5rem minmax(0, 1fr) auto; }
  .annual__detail { grid-column: 2 / -1; grid-row: 2; white-space: normal; }
}
.annual__intro:lang(ko), .annual__rules p:lang(ko), .annual__empty:lang(ko) { word-break: keep-all; }
.annual__intro:lang(ja), .annual__rules p:lang(ja), .annual__empty:lang(ja) { word-break: auto-phrase; }
</style>
