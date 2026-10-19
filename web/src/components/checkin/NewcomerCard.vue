<script setup lang="ts">
/**
 * 新手七日（ui.md §5）：七個圓點是「完成的第幾個日子」，不是月曆；14 天內做滿 7 天就好。
 * 今天的目標由蘇綺帶著講，按「帶我去」開當天的引導；第 7 天換成開新住民寶箱。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { newcomerView } from "@/lib/checkin";
import { glueUnits, whole } from "@/lib/format";
import { NEWCOMER_BADGE } from "@/lib/checkin-art";
import type { RewardsPanel } from "@/lib/rewards";

const props = defineProps<{ panel: RewardsPanel; busy: boolean }>();
const emit = defineEmits<{ guide: [day: number]; grand: [] }>();
const { t } = useI18n();
const view = computed(() => newcomerView(props.panel));
const n = computed(() => props.panel.newcomer!);
const goalOf = (day: number) => glueUnits(t(`newcomer.goal.${day}`, { n: n.value.today.target }, n.value.today.target));
const todayRatio = computed(() => (n.value.today.target ? Math.min(1, n.value.today.progress / n.value.today.target) : 0));
</script>

<template>
  <section v-if="view && view.finished" id="newcomer" class="nc nc--done panel">
    <img :src="NEWCOMER_BADGE" alt="" width="48" height="48" />
    <strong>{{ t("newcomer.finished") }}</strong>
  </section>
  <section v-else-if="view" id="newcomer" class="nc panel" aria-labelledby="nc-title">
    <header class="nc__head">
      <h2 id="nc-title">{{ t("newcomer.title") }}</h2>
      <span class="nc__left">{{ t("newcomer.left", { n: view.left }, view.left) }}</span>
      <p class="nc__rule">{{ t("newcomer.rule") }}</p>
    </header>
    <ol class="nc__dots">
      <li v-for="s in n.stages" :key="s.stage" class="nc__dot" :class="{ 'nc__dot--done': s.done, 'nc__dot--today': !s.done && s.stage === view.day && !view.todayDone }">
        <span class="nc__bead" aria-hidden="true">
          <svg v-if="s.done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6" /></svg>
          <span v-else>{{ s.stage }}</span>
        </span>
        <span class="nc__reward">{{ s.chest ? t("newcomer.reward.grand") : s.credits ? t("newcomer.reward", { amount: whole(s.credits) }) : "" }}</span>
      </li>
    </ol>
    <p class="nc__progress">{{ t("newcomer.progress", { n: view.done }) }}</p>
    <div class="nc__today">
      <img class="nc__suki" src="/mascot/suki-avatar.webp" alt="" width="56" height="56" decoding="async" />
      <div class="nc__goal">
        <span class="nc__eyebrow">{{ view.todayDone ? t("newcomer.today.done") : t("newcomer.today") }}</span>
        <template v-if="!view.todayDone">
          <strong class="nc__text">{{ goalOf(view.day) }}</strong>
          <span v-if="!view.grand && n.today.target > 1" class="meter" role="progressbar" :aria-valuenow="n.today.progress" aria-valuemin="0" :aria-valuemax="n.today.target"><i :style="{ '--v': todayRatio }" /></span>
          <button v-if="view.grand" type="button" class="btn btn--primary nc__cta" :disabled="busy" @click="emit('grand')">{{ t("newcomer.cta.grand") }}</button>
          <button v-else type="button" class="btn nc__cta" @click="emit('guide', view.day)">{{ t("newcomer.cta.go") }}</button>
        </template>
        <span v-else-if="view.day < n.stages.length" class="nc__tomorrow">{{ t("newcomer.tomorrow", { goal: goalOf(view.day + 1) }) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.nc { padding:var(--s-4); display:grid; gap:var(--s-3); scroll-margin-top:calc(var(--header-h) + var(--s-4)); }
.nc--done { display:flex; align-items:center; gap:var(--s-3); }
.nc--done img { width:48px; height:48px; }
.nc__head { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:baseline; gap:2px var(--s-3); }
.nc__head h2 { margin:0; font-size:16px; font-weight:700; }
.nc__left { font-size:12px; color:var(--text-3); white-space:nowrap; }
.nc__rule { grid-column:1 / -1; margin:0; font-size:12.5px; color:var(--text-2); }
.nc__dots { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(7, minmax(0,1fr)); gap:4px; }
.nc__dot { display:grid; justify-items:center; gap:4px; min-width:0; }
.nc__bead { display:flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:var(--r-pill); background:var(--surface-2); color:var(--text-3); font-size:13px; font-weight:600; }
.nc__bead svg { width:14px; height:14px; }
.nc__dot--done .nc__bead { background:var(--accent-tint); color:var(--accent-text); }
.nc__dot--today .nc__bead { background:var(--accent-btn); color:var(--on-accent); box-shadow:0 0 0 3px var(--accent-soft); }
.nc__reward { font-size:11.5px; color:var(--text-3); text-align:center; line-height:1.3; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
.nc__progress { margin:0; font-size:12.5px; color:var(--text-2); }
.nc__today { display:grid; grid-template-columns:64px minmax(0,1fr); gap:var(--s-3); align-items:end; padding:var(--s-3); border-radius:var(--r-md); background:var(--accent-tint); }
.nc__suki { width:56px; height:56px; border-radius:var(--r-pill); object-fit:cover; background:var(--accent-tint); }
.nc__goal { display:grid; gap:6px; min-width:0; align-self:center; }
.nc__eyebrow { font-size:12px; color:var(--text-2); }
.nc__text { font-size:14px; line-height:1.45; text-wrap:pretty; }
/* 長字（en、ja、ko）時按鈕字換兩行，不超出卡片、不縮字（ui.md §6.14） */
.nc__cta { justify-self:start; min-height:44px; max-width:100%; height:auto; padding-block:8px; white-space:normal; text-wrap:balance; }
.nc__tomorrow { font-size:13px; color:var(--text-3); }
:lang(ko) .nc__text, :lang(ko) .nc__rule { word-break:keep-all; }
</style>
