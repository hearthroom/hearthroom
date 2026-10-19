<script setup lang="ts">
/**
 * 「我的」頁最上面的簽到入口（ui.md §3.1）：連續天數、今天的狀態、一顆按鈕去簽到頁。
 * 不在這裡開箱：舞台只從簽到頁開，焦點與返回都單純。
 */
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { useCheckin } from "@/lib/checkin-store";
import { usePeriodPlans } from "@/lib/period-plan-store";
import { newcomerView } from "@/lib/checkin";
import { whole } from "@/lib/format";
import { useLocalePath } from "@/lib/use-locale";

const store = useCheckin();
const { t } = useI18n();
const { lp } = useLocalePath();
const plans = usePeriodPlans();
onMounted(() => { if (!store.panel && !store.disabled) void store.load(); if (!plans.loaded) void plans.load(); });

const p = computed(() => store.panel);
const firstLine = computed(() => (p.value && p.value.checkin.streak > 0 ? t("me.checkin.streak", { n: p.value.checkin.streak }) : t("me.checkin.streak.none")));
const status = computed(() => {
  const panel = p.value;
  if (!panel) return "";
  const nc = newcomerView(panel);
  // 新手七日期間，第二行換成今天的目標
  if (nc && !nc.todayDone) return t(`newcomer.goal.${nc.day}`, { n: panel.newcomer!.today.target }, panel.newcomer!.today.target);
  if (!panel.checkin.todayClaimed) return t("me.checkin.todo");
  const credits = panel.today.claims.filter((c) => c.status === "granted").reduce((s, c) => s + (c.item && !c.duplicate ? 0 : c.credits ?? 0), 0);
  return credits ? t("me.checkin.done", { amount: whole(credits) }) : t("me.checkin.todo");
});
/** 持卡時狀態行後面的半句（任務 2026-10-19-month-card-surfaces ui.md §5.1）：今天已領寫已領，否則寫剩幾天；放不下整段省略 */
const plan = computed(() => {
  const line = plans.line(p.value ? p.value.checkin.todayClaimed : null);
  if (line.kind === "hidden" || !plans.mine) return "";
  return line.kind === "claimed" ? t("plan.meCard.claimed", { daily: whole(line.credits) }) : t("plan.meCard.days", { n: whole(plans.mine.remainingDays) }, plans.mine.remainingDays);
});
const tasks = computed(() => (store.claimableTasks ? t("me.checkin.tasks", { n: store.claimableTasks }, store.claimableTasks) : ""));
</script>

<template>
  <RouterLink v-if="!store.disabled" :to="lp('/checkin')" class="ck panel">
    <img class="ck__suki" src="/mascot/suki-avatar.webp" alt="" width="56" height="56" decoding="async" />
    <span class="ck__text">
      <strong>{{ firstLine }}</strong>
      <span class="ck__status"><span>{{ status }}</span><span v-if="tasks" class="ck__tasks">&nbsp;{{ tasks }}</span><span v-if="plan" class="ck__plan">&nbsp;· {{ plan }}</span></span>
    </span>
    <span class="btn" :class="store.canCheckIn ? 'btn--primary' : ''">{{ store.canCheckIn ? t("me.checkin.cta.open") : t("me.checkin.cta.view") }}</span>
  </RouterLink>
</template>

<style scoped>
/* 文字欄至少 140；放不下時按鈕換到下一列、滿寬 44（ui.md §6.14）。flex 換行的道理同首頁新手卡 */
.ck { width:100%; min-height:72px; display:flex; flex-wrap:wrap; align-items:center; gap:var(--s-2) var(--s-3); padding:var(--s-2) var(--s-4) var(--s-2) var(--s-2); color:inherit; text-decoration:none; transition:background var(--dur) var(--ease); }
.ck:hover { background:var(--surface-2); }
.ck__suki { flex:none; width:56px; height:56px; border-radius:var(--r-md); object-fit:cover; background:var(--accent-tint); }
.ck__text { flex:9999 1 140px; min-width:140px; display:grid; gap:2px; container-type:inline-size; }
.ck__text strong { font-size:15px; font-weight:600; }
.ck__status { font-size:13px; color:var(--text-2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ck .btn { flex:1 0 auto; min-height:44px; pointer-events:none; }
/* 單行放不下時先拿掉「· N 項任務可領取」，不用省略號截斷（ui.md §6.13） */
@container (max-width: 260px) { .ck__tasks { display:none; } }
/* 月卡半句同理：窄的時候整段拿掉，不截半（月卡任務 ui.md §5.1） */
@container (max-width: 320px) { .ck__plan { display:none; } }
</style>
