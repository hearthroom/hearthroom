<script setup lang="ts">
/**
 * 首頁頂端的新手七日卡（ui.md §15.2）：整張卡連到簽到頁的新手區塊，按鈕直接開今天的引導。
 * 一直在，直到七天做完或 14 天期滿；桌寵提示卡出現時先讓位。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRouter } from "vue-router";
import { useCheckin } from "@/lib/checkin-store";
import { newcomerView } from "@/lib/checkin";
import { newcomerPrompt } from "@/lib/newcomer-prompt";
import { startNewcomerTour } from "@/lib/newcomer-tour";
import { tourDone } from "@/lib/onboarding";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { glueUnits } from "@/lib/format";

const store = useCheckin();
const session = useSession();
const router = useRouter();
const { t } = useI18n();
const { lp } = useLocalePath();

const view = computed(() => (session.me && store.panel && tourDone() ? newcomerView(store.panel) : null));
const target = computed(() => store.panel?.newcomer?.today.target ?? 1);
const goal = computed(() => (view.value ? glueUnits(t(`newcomer.goal.${view.value.day}`, { n: target.value }, target.value)) : ""));
const tomorrow = computed(() => (view.value && view.value.day < 7 ? t(`newcomer.goal.${view.value.day + 1}`, { n: target.value }, target.value) : ""));
function go() { if (view.value) startNewcomerTour(view.value.day, router, lp); }
</script>

<template>
  <div v-if="view && !view.finished && !newcomerPrompt.showing" class="ns panel">
    <RouterLink :to="lp('/checkin#newcomer')" class="ns__link" :aria-label="t('newcomer.home.aria', { n: view.day, done: view.done })" />
    <img class="ns__face" src="/mascot/home/pose-wave.webp" alt="" width="44" height="44" decoding="async" />
    <span class="ns__text">
      <span class="ns__eyebrow">{{ t("newcomer.home.title", { n: view.day }) }} · {{ t("newcomer.home.progress", { done: view.done }) }}</span>
      <strong v-if="!view.todayDone" class="ns__goal">{{ goal }}</strong>
      <span v-else class="ns__goal"><strong>{{ t("newcomer.today.done") }}</strong><span v-if="tomorrow" class="ns__next"> {{ t("newcomer.tomorrow", { goal: tomorrow }) }}</span></span>
    </span>
    <button v-if="!view.todayDone" type="button" class="btn ns__go" @click="go">{{ t("newcomer.home.go") }}</button>
    <span class="ns__chev" aria-hidden="true">›</span>
    <span class="ns__bar" aria-hidden="true"><i v-for="i in 7" :key="i" :class="{ on: i <= view.done, today: i === view.day && !view.todayDone }" /></span>
  </div>
</template>

<style scoped>
.ns { position:relative; display:grid; grid-template-columns:44px minmax(0,1fr) auto 20px; grid-template-areas:"face text go chev" "bar bar bar bar"; align-items:center; gap:var(--s-2) var(--s-3); padding:var(--s-3) var(--s-3) var(--s-2) var(--s-4); margin-bottom:var(--s-4); transition:background var(--dur) var(--ease); }
.ns:hover { background:var(--surface-2); }
.ns__link { position:absolute; inset:0; z-index:1; border-radius:inherit; }
.ns__face { grid-area:face; width:44px; height:44px; border-radius:var(--r-pill); object-fit:cover; object-position:50% 12%; background:var(--accent-tint); }
.ns__text { grid-area:text; display:grid; gap:2px; min-width:0; }
.ns__eyebrow { font-size:12px; color:var(--text-2); }
.ns__goal { font-size:14px; font-weight:600; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; text-wrap:pretty; }
.ns__next { font-weight:400; color:var(--text-3); }
.ns__go { grid-area:go; position:relative; z-index:2; height:var(--h-lg); }
.ns__chev { grid-area:chev; font-size:20px; color:var(--text-3); text-align:center; }
.ns__bar { grid-area:bar; display:grid; grid-template-columns:repeat(7, 1fr); gap:3px; }
.ns__bar i { height:4px; border-radius:var(--r-pill); background:var(--line-strong); }
.ns__bar i.on { background:color-mix(in srgb, var(--text-3) 60%, transparent); }
.ns__bar i.today { background:var(--accent-btn); }
:lang(ko) .ns__goal { word-break:keep-all; }
</style>
