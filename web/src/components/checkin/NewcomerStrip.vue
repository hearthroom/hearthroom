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
import { firstTourPending } from "@/lib/onboarding";
import { tourState } from "@/lib/coach-tour";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { glueUnits } from "@/lib/format";

const store = useCheckin();
const session = useSession();
const router = useRouter();
const { t, locale } = useI18n();
const { lp } = useLocalePath();

// 首次導覽在走或還會出現時先等它（導覽優先）；不會出現的語言或裝置不等
const view = computed(() => (session.me && store.panel && !tourState.step && !firstTourPending(String(locale.value), session.profile?.memberSince) ? newcomerView(store.panel) : null));
const target = computed(() => store.panel?.newcomer?.today.target ?? 1);
const goal = computed(() => (view.value ? glueUnits(t(`newcomer.goal.${view.value.day}`, { n: target.value }, target.value)) : ""));
const tomorrow = computed(() => (view.value && view.value.day < 7 ? t(`newcomer.goal.${view.value.day + 1}`, { n: target.value }, target.value) : ""));
function go() { if (view.value) startNewcomerTour(view.value.day, router, lp); }
</script>

<template>
  <div v-if="view && !view.finished && !newcomerPrompt.showing" class="ns panel">
    <RouterLink :to="lp('/checkin#newcomer')" class="ns__link" :aria-label="t('newcomer.home.aria', { n: view.day, done: view.done })" />
    <img class="ns__face" src="/mascot/suki-avatar.webp" alt="" width="44" height="44" decoding="async" />
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
/*
 * 文字欄至少 160 寬；放不下時按鈕換到下一列、滿寬（ui.md §6.14）。用 flex 換行做：
 * 文字欄的伸展權重遠大於按鈕，同一列時多出來的寬都給文字；按鈕獨自一列時才撐滿。
 */
.ns { position:relative; container-type:inline-size; display:flex; flex-wrap:wrap; align-items:center; gap:var(--s-2) var(--s-3); padding:var(--s-3) var(--s-3) var(--s-2) var(--s-4); margin-bottom:var(--s-4); transition:background var(--dur) var(--ease); }
.ns:hover { background:var(--surface-2); }
.ns__link { position:absolute; inset:0; z-index:1; border-radius:inherit; }
.ns__face { flex:none; width:44px; height:44px; border-radius:var(--r-pill); object-fit:cover; background:var(--accent-tint); }
.ns__text { flex:9999 1 160px; min-width:160px; display:grid; gap:2px; }
.ns__eyebrow { font-size:12px; color:var(--text-2); }
.ns__goal { font-size:14px; font-weight:600; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; text-wrap:pretty; }
.ns__next { font-weight:400; color:var(--text-3); }
.ns__go { flex:1 0 auto; position:relative; z-index:2; height:var(--h-lg); min-height:44px; }
.ns__chev { flex:none; width:20px; font-size:20px; color:var(--text-3); text-align:center; }
.ns__bar { flex:1 1 100%; display:grid; grid-template-columns:repeat(7, 1fr); gap:3px; }
.ns__bar i { height:4px; border-radius:var(--r-pill); background:var(--line-strong); }
.ns__bar i.on { background:color-mix(in srgb, var(--text-3) 60%, transparent); }
.ns__bar i.today { background:var(--accent-btn); }
:lang(ko) .ns__goal { word-break:keep-all; }
/* 窄卡：箭頭收起（整張卡仍是連結），按鈕一定換列 */
@container (max-width: 340px) { .ns__chev { display:none; } .ns__go { flex-basis:100%; } }
:lang(zh) .ns__goal, :lang(ja) .ns__goal { word-break:auto-phrase; }
</style>
