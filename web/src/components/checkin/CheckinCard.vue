<script setup lang="ts">
/**
 * 「我的」頁最上面的簽到入口（ui.md §3.1）：連續天數、今天的狀態、一顆按鈕去簽到頁。
 * 不在這裡開箱：舞台只從簽到頁開，焦點與返回都單純。
 */
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { useCheckin } from "@/lib/checkin-store";
import { newcomerView } from "@/lib/checkin";
import { whole } from "@/lib/format";
import { useLocalePath } from "@/lib/use-locale";

const store = useCheckin();
const { t } = useI18n();
const { lp } = useLocalePath();
onMounted(() => { if (!store.panel && !store.disabled) void store.load(); });

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
const tasks = computed(() => (store.claimableTasks ? t("me.checkin.tasks", { n: store.claimableTasks }, store.claimableTasks) : ""));
</script>

<template>
  <RouterLink v-if="!store.disabled" :to="lp('/checkin')" class="ck panel">
    <img class="ck__suki" src="/mascot/home/pose-wave.webp" alt="" width="56" height="56" decoding="async" />
    <span class="ck__text">
      <strong>{{ firstLine }}</strong>
      <span class="ck__status">{{ status }}<template v-if="tasks"> {{ tasks }}</template></span>
    </span>
    <span class="btn" :class="store.canCheckIn ? 'btn--primary' : ''">{{ store.canCheckIn ? t("me.checkin.cta.open") : t("me.checkin.cta.view") }}</span>
  </RouterLink>
</template>

<style scoped>
.ck { width:100%; min-height:72px; display:grid; grid-template-columns:56px minmax(0,1fr) auto; align-items:center; gap:var(--s-3); padding:var(--s-2) var(--s-4) var(--s-2) var(--s-2); color:inherit; text-decoration:none; transition:background var(--dur) var(--ease); }
.ck:hover { background:var(--surface-2); }
.ck__suki { width:56px; height:56px; border-radius:var(--r-md); object-fit:cover; object-position:50% 12%; background:var(--accent-tint); }
.ck__text { display:grid; gap:2px; min-width:0; }
.ck__text strong { font-size:15px; font-weight:600; }
.ck__status { font-size:13px; color:var(--text-2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ck .btn { pointer-events:none; }
</style>
