<script setup lang="ts">
/**
 * 簽到頁最上面那一塊（ui.md §3.3–§3.6）：今天的箱子、主按鈕、保底、七日軌道、里程碑。
 * 斷簽時在選擇之前只講「現在幾天、補或不補會變幾天」，數字與軌道照還沒斷的樣子畫（美術總監 r1 擋 1）。
 * 今天簽過之後主按鈕的位置換成今天的結果列，重新整理、換裝置都在（持久落點）。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import CheckinTrack from "./CheckinTrack.vue";
import CreditIcon from "./CreditIcon.vue";
import { chestTitle, countdown, heroState, isMilestoneChest, milestoneView, pityView, streakChip, trackNodes } from "@/lib/checkin";
import { boxKindOf, poseUrl } from "@/lib/checkin-art";
import SukiCarry from "./SukiCarry.vue";
import { isNight } from "@/lib/mascot-home";
import { monthDayOf, monthDayTime, whole } from "@/lib/format";
import type { ClaimResult, RewardPlan, RewardsPanel } from "@/lib/rewards";

const props = defineProps<{ panel: RewardsPanel; plan: RewardPlan | null; fetchedAt: number; now: number; busy: boolean }>();
const emit = defineEmits<{ open: []; makeup: []; signAnyway: [] }>();
const { t } = useI18n();

const state = computed(() => heroState(props.panel));
const chip = computed(() => streakChip(props.panel));
const nodes = computed(() => trackNodes(props.panel));
const milestone = computed(() => milestoneView(props.panel, props.plan));
const pity = computed(() => pityView(props.panel.pityRemaining));
/** 保底講的是金額門檻（獎表的 pity.threshold），不是級名：大獎、頭獎在不同寶箱裡的金額不一樣 */
const pityAmount = computed(() => whole(props.plan?.pity?.threshold ?? 0));
const pityRatio = computed(() => {
  const every = props.plan?.pity?.every;
  return every && pity.value ? Math.min(1, Math.max(0, (every - pity.value.n) / every)) : 0;
});
const night = computed(() => isNight(new Date(props.now)));
const broken = computed(() => state.value === "brokenCard" || state.value === "brokenNoCard");
const fallback = computed(() => props.panel.checkin.fallback);
const firstChest = computed(() => props.panel.checkin.todayChests[0] ?? "daily");
const titleOf = (chest: string) => { const c = chestTitle(chest, props.plan); return t(c.key, c.params ?? {}); };

const title = computed(() => {
  switch (state.value) {
    case "first": return t("checkin.hero.first.title");
    case "two": return t("checkin.hero.two.title");
    case "done": return t("checkin.hero.done.title");
    default: return titleOf(firstChest.value);
  }
});
const maxOf = (chest: string) => Math.max(0, ...(props.plan?.chests[chest]?.prizes ?? []).map((p) => p.credits ?? 0));
const desc = computed(() => {
  switch (state.value) {
    case "first": return t("checkin.hero.first.desc");
    case "normal": return t("checkin.box.desc.normal");
    case "day3": return t("checkin.box.desc.day3");
    case "day7": { const max = maxOf("day7"); return max ? t("checkin.box.desc.day7", { max: whole(max) }) : t("checkin.box.desc.day3"); }
    case "two": { const [a, b] = props.panel.checkin.todayChests; return t("checkin.hero.two.desc", { box1: titleOf(a), box2: titleOf(b) }); }
    default: return "";
  }
});
const brokenText = computed(() => {
  const f = fallback.value;
  if (!f) return "";
  const zero = f.checkpoint === 0 ? ".zero" : "";
  return state.value === "brokenCard"
    ? t(`checkin.broken.withCard${zero}`, { from: f.from, checkpoint: f.checkpoint })
    : t(`checkin.broken.noCard${zero}`, { checkpoint: f.checkpoint });
});
const sukiLine = computed(() => {
  switch (state.value) {
    case "first": return t("checkin.suki.first");
    case "normal": return t(night.value ? "checkin.suki.normal.night" : "checkin.suki.normal");
    case "day3": return t("checkin.suki.day3");
    case "day7": return t("checkin.suki.day7");
    case "two": return t("checkin.suki.two");
    case "done": return t(night.value ? "checkin.suki.done.night" : "checkin.suki.done");
    default: return t("checkin.suki.broken");
  }
});
const pose = computed(() => poseUrl("wave", new Date(props.now)));

/** 今天開到的簽到寶箱（任務寶箱不算），里程碑日兩份都列；沒發放的不列。 */
const isCheckinChest = (c: ClaimResult) => !!c.chest && (props.plan?.checkin?.cycle.includes(c.chest) || isMilestoneChest(c.chest, props.plan) || c.rewardKey.startsWith("checkin"));
const todayResults = computed(() => props.panel.today.claims.filter((c) => c.status !== "not_granted" && (isCheckinChest(c) || c.rewardKey.startsWith("checkin") || c.rewardKey.startsWith("milestone"))));
const resultLine = (c: ClaimResult) => {
  if (c.status === "pending") return c.releaseAt ? t("checkin.done.pending", { date: monthDayOf(c.releaseAt) }) : t("wallet.record.pending");
  return c.expiresAt ? t("checkin.done.expires", { datetime: monthDayTime(c.expiresAt) }) : "";
};
const next = computed(() => countdown(props.panel.serverNow, props.panel.nextResetAt, props.fetchedAt, props.now));
const nextLine = computed(() => (next.value.h > 0 ? t("checkin.done.next", { h: next.value.h, m: next.value.m }) : t("checkin.done.next.min", { m: Math.max(1, next.value.m) })));
const ctaLabel = computed(() => (state.value === "two" ? t("checkin.cta.openTwo") : t("checkin.cta.open")));
</script>

<template>
  <section class="hero panel" :class="`hero--${state}`" aria-labelledby="checkin-hero-title">
    <div class="hero__head">
      <span class="hero__streak">
      <span class="hero__chip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21c-3.9 0-7-2.8-7-6.6 0-3.2 2.4-5.4 3.8-7.9.4 1.6 1.2 2.7 2.4 3.4C11 6.6 12.5 4.3 15 3c-.4 2.6.6 4.4 2 6 1.3 1.5 2 3.2 2 5.4 0 3.8-3.1 6.6-7 6.6Z" /></svg>
        {{ chip.first ? t("checkin.streak.first") : t("checkin.streak", { n: chip.n }) }}
      </span>
      <span v-if="chip.was != null" class="hero__was">{{ t("checkin.broken.was", { from: chip.was }) }}</span>
      </span>
      <p class="hero__bubble" aria-live="polite">{{ sukiLine }}</p>
    </div>

    <div class="hero__text">
      <h2 id="checkin-hero-title" class="hero__title display">{{ title }}</h2>
      <p v-if="desc" class="hero__desc">{{ desc }}</p>
      <div v-if="broken" class="hero__broken">
        <p>{{ brokenText }}</p>
        <span v-if="state === 'brokenCard'" class="hero__cards">{{ t("checkin.makeup.cards", { n: panel.checkin.makeup.left }, panel.checkin.makeup.left) }}</span>
      </div>
    </div>

    <SukiCarry v-if="state !== 'done'" class="hero__suki" :kind="boxKindOf(firstChest)" :now="now" />
    <img v-else class="hero__suki" :src="pose" alt="" width="381" height="560" decoding="async" />

    <div class="hero__cta">
      <template v-if="state === 'done'">
        <ul class="hero__results">
          <li v-for="c in todayResults" :key="c.rewardKey" class="hero__result">
            <CreditIcon class="hero__coin" />
            <span v-if="c.credits != null && c.status === 'granted'" class="hero__amount">{{ t("checkin.done.amount", { amount: whole(c.credits) }) }}</span>
            <span v-else-if="c.item && c.status === 'granted'" class="hero__amount">{{ titleOf(c.chest ?? "daily") }}</span>
            <span class="hero__exp">{{ resultLine(c) }}</span>
          </li>
        </ul>
        <p class="hero__next">{{ nextLine }}</p>
      </template>
      <template v-else-if="state === 'brokenCard'">
        <button type="button" class="btn btn--primary btn--lg hero__main" :disabled="busy" :aria-busy="busy" @click="emit('makeup')">
          <span v-if="busy" class="spin" aria-hidden="true" /><span :class="{ 'hero__label--hold': busy }">{{ t("checkin.cta.makeup") }}</span>
        </button>
        <button type="button" class="btn btn--lg hero__alt" :disabled="busy" @click="emit('signAnyway')">{{ t("checkin.cta.signAnyway") }}</button>
      </template>
      <button v-else type="button" class="btn btn--primary btn--lg hero__main" :disabled="busy" :aria-busy="busy" @click="emit('open')">
        <span v-if="busy" class="spin" aria-hidden="true" /><span :class="{ 'hero__label--hold': busy }">{{ ctaLabel }}</span>
      </button>
    </div>

    <div v-if="pity && plan?.pity && state !== 'first'" class="hero__pity">
      <span class="meter" role="progressbar" :aria-valuenow="Math.round(pityRatio * 100)" aria-valuemin="0" aria-valuemax="100" :aria-label="t(pity.key, { n: pity.n, amount: pityAmount })"><i :style="{ '--v': pityRatio }" /></span>
      <span :class="{ 'hero__pity--next': pity.n === 1 }">{{ t(pity.key, { n: pity.n, amount: pityAmount }) }}</span>
    </div>

    <hr class="hero__rule" />
    <CheckinTrack class="hero__track" :nodes="nodes" />

    <div v-if="milestone" class="hero__milestone">
      <span class="meter meter--done" role="progressbar" :aria-valuenow="milestone.cur" aria-valuemin="0" :aria-valuemax="milestone.max" :aria-label="t('checkin.milestone.progress', { cur: milestone.cur, max: milestone.max })"><i :style="{ '--v': milestone.ratio }" /></span>
      <svg class="hero__flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" role="img" :aria-label="t('checkin.milestone.flag', { day: milestone.max })"><title>{{ t("checkin.milestone.flag", { day: milestone.max }) }}</title><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>
      <span class="hero__ms-num">{{ t("checkin.milestone.progress", { cur: milestone.cur, max: milestone.max }) }}</span>
      <span class="hero__ms-left">{{ milestone.today ? t("checkin.milestone.today") : t("checkin.milestone.left", { left: milestone.left }, milestone.left) }}</span>
    </div>
  </section>
</template>

<style scoped>
.hero {
  display:grid; grid-template-columns:minmax(0,1fr) 120px; column-gap:var(--s-3); row-gap:var(--s-3);
  grid-template-areas:"head head" "text suki" "cta cta" "pity pity" "rule rule" "track track" "ms ms";
  padding:var(--s-4); overflow:hidden;
}
.hero__head { grid-area:head; display:flex; align-items:flex-end; gap:var(--s-2); min-height:26px; min-width:0; }
.hero__streak { flex:none; display:flex; align-items:center; gap:var(--s-2); align-self:flex-end; }
.hero__chip { flex:none; display:inline-flex; align-items:center; gap:4px; height:26px; padding:0 10px; border-radius:var(--r-pill); background:var(--accent-tint); color:var(--accent-text); font-size:13px; font-weight:600; white-space:nowrap; }
.hero__chip svg { width:14px; height:14px; }
.hero__was { flex:none; font-size:12px; color:var(--text-2); white-space:nowrap; }
.hero__bubble {
  position:relative; margin:0 0 6px auto; max-width:60%; padding:8px 12px; border-radius:16px;
  background:#fff; color:#2a1d24; font-size:13.5px; line-height:1.45; word-break:keep-all; overflow-wrap:anywhere; box-shadow:0 4px 14px rgba(42,29,36,.14);
  text-wrap:balance;
  animation:bubble-in var(--dur) var(--ease) both;
}
.hero__bubble::after { content:""; position:absolute; right:44px; bottom:-6px; width:12px; height:12px; background:#fff; transform:rotate(45deg); border-radius:2px; }
.hero__text { grid-area:text; min-width:0; align-self:center; }
.hero__title { margin:0; font-size:22px; letter-spacing:-.02em; text-wrap:balance; overflow-wrap:anywhere; }
.hero__desc { margin:var(--s-1) 0 0; color:var(--text-2); font-size:13px; line-height:1.6; text-wrap:pretty; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.hero__broken { margin-top:var(--s-2); padding:var(--s-3); border-radius:var(--r-md); background:var(--surface-2); font-size:13px; line-height:1.6; color:var(--text); }
.hero__broken p { margin:0; text-wrap:pretty; }
.hero__cards { display:inline-flex; margin-top:var(--s-2); height:24px; align-items:center; padding:0 10px; border-radius:var(--r-pill); background:var(--surface); color:var(--text-2); font-size:12px; white-space:nowrap; }
.hero__suki { grid-area:suki; width:120px; height:168px; object-fit:contain; object-position:50% 100%; align-self:end; justify-self:center; pointer-events:none; user-select:none; }
span.hero__suki { width:auto; }
.hero__cta { grid-area:cta; display:grid; gap:var(--s-2); }
.hero__main, .hero__alt { width:100%; }
.hero__main { position:relative; }
.hero__label--hold { visibility:hidden; }
.spin { position:absolute; width:18px; height:18px; border-radius:50%; border:2px solid currentColor; border-right-color:transparent; animation:spin .8s linear infinite; }
.hero__results { list-style:none; margin:0; padding:0; display:grid; gap:var(--s-2); }
.hero__result { display:flex; align-items:center; flex-wrap:wrap; gap:4px var(--s-2); padding:var(--s-2) var(--s-3); border-radius:var(--r-md); background:var(--surface-2); }
.hero__coin { width:18px; height:18px; color:var(--gold); }
.hero__amount { font-size:16px; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
.hero__exp { font-size:12.5px; color:var(--text-2); white-space:nowrap; }
.hero__next { margin:0; font-size:12.5px; color:var(--text-3); }
.hero__pity { grid-area:pity; display:flex; flex-wrap:wrap; align-items:center; gap:var(--s-1) var(--s-3); font-size:13px; color:var(--text-2); }
.hero__pity .meter { flex:1 1 120px; max-width:180px; }
.hero__pity--next { color:var(--accent-text); font-weight:600; }
.hero__rule { grid-area:rule; width:100%; margin:0; border:0; border-top:1px solid var(--line); }
.hero__track { grid-area:track; }
.hero__milestone { grid-area:ms; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:var(--s-1) var(--s-2); font-size:12.5px; color:var(--text-2); }
.hero__milestone .meter { grid-column:1; }
.hero__flag { grid-column:2; grid-row:1; width:18px; height:18px; color:var(--accent-text); }
.hero__ms-num { font-variant-numeric:tabular-nums; font-weight:600; color:var(--text); }
.hero__ms-left { grid-column:1 / -1; text-wrap:pretty; }
@keyframes spin { to { transform:rotate(360deg); } }
@keyframes bubble-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
:lang(ko) .hero__title, :lang(ko) .hero__desc, :lang(ko) .hero__bubble { word-break:keep-all; }
:lang(zh) .hero__bubble, :lang(ja) .hero__bubble { word-break:auto-phrase; }

/*
 * 桌機：泡泡疊在蘇綺頭上、同一欄，抬頭列只有連簽，標題緊接在下（ui.md §6.13，1280×800 第一屏要看到任務前兩項）。
 * 側欄高＝泡泡預留 + 蘇綺，和左欄文字一起決定上半部高度；軌道與里程碑通欄在下。
 */
@media (min-width: 761px) {
  .hero {
    grid-template-columns:minmax(0,1fr) 200px; column-gap:var(--s-5); padding:var(--s-5) var(--s-6);
    grid-template-areas:"head side" "text side" "cta side" "pity side" "rule rule" "track track" "ms ms";
  }
  .hero__head { display:contents; }
  .hero__streak { grid-area:head; align-self:start; }
  .hero__bubble { grid-area:side; align-self:start; max-width:200px; margin:0; justify-self:center; }
  .hero__bubble::after { left:50%; right:auto; margin-left:-6px; }
  .hero__text { align-self:start; }
  .hero__pity { margin-top:var(--s-1); align-self:start; }
  .hero__title { font-size:28px; }
  .hero__desc { font-size:15px; }
  .hero__suki { grid-area:side; width:200px; height:164px; margin-top:64px; align-self:end; }
  .hero__milestone { grid-template-columns:minmax(120px,1fr) auto auto auto; }
  .hero__milestone .meter { grid-row:1; }
  .hero__ms-num { grid-column:2; grid-row:1; }
  .hero__flag { grid-column:3; }
  .hero__ms-left { grid-column:4; grid-row:1; }
  .hero__cta { justify-self:start; grid-auto-flow:column; }
  .hero__main, .hero__alt { width:auto; min-width:220px; }
  .hero__cta:has(.hero__results) { grid-auto-flow:row; justify-self:stretch; }
}
@media (max-width: 760px) and (max-height: 700px) {
  .hero { grid-template-columns:minmax(0,1fr) 96px; }
  .hero__suki { width:96px; height:134px; }
}
@media (max-width: 359px) {
  .hero__title { font-size:20px; }
}

@media (min-width: 761px) and (max-height: 700px) {
  .hero { grid-template-columns:minmax(0,1fr) 250px; }
  /* 橫放：泡泡整句完整顯示，不截斷（美術總監最終 r1 M5） */
  .hero__bubble { max-width:240px; }
  .hero__suki { width:250px; height:136px; }
}
</style>
