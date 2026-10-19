<script setup lang="ts">
/**
 * 開箱紀錄（ui.md §3.7）：持久落點之一。先列 5 筆，展開後分頁；保留天數來自獎表，不寫死。
 * 級名是舞台外唯一的分級依據，色點只分三組（美術總監 art.md §10）。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { chestTitle } from "@/lib/checkin";
import { monthDayOf, monthDayTime, whole } from "@/lib/format";
import type { DrawRecord, RewardPlan } from "@/lib/rewards";

const props = defineProps<{ list: DrawRecord[]; plan: RewardPlan | null; more: boolean; loading: boolean; error: string; now: number }>();
const emit = defineEmits<{ expand: []; more: []; retry: []; top: [] }>();
const { t } = useI18n();
const open = ref(false);
const shown = computed(() => (open.value ? props.list : props.list.slice(0, 5)));
const title = (d: DrawRecord) => { const c = chestTitle(d.chest, props.plan); return t(c.key, c.params ?? {}); };
const tierDot = (tier?: number) => (!tier ? "" : tier >= 5 ? "dot--gold" : tier >= 3 ? "dot--accent" : "dot--plain");
const right = (d: DrawRecord) => {
  if (d.status === "pending") return d.releaseAt ? t("checkin.done.pending", { date: monthDayOf(d.releaseAt) }) : t("checkin.history.pending");
  if (!d.expiresAt) return "";
  return Date.parse(d.expiresAt) <= props.now ? t("checkin.history.expired") : t("checkin.history.expires", { datetime: monthDayTime(d.expiresAt) });
};
const date = (at: string) => monthDayOf(at);
function expand() { open.value = true; emit("expand"); }
</script>

<template>
  <section class="hist panel" aria-labelledby="hist-title">
    <header class="hist__head">
      <h2 id="hist-title">{{ t("checkin.history.title") }}</h2>
      <button v-if="!open && list.length > 5" type="button" class="btn btn--ghost btn--sm" @click="expand">{{ t("checkin.history.all") }}</button>
    </header>
    <p v-if="error" class="notice notice--error">{{ error }} <button type="button" class="btn btn--sm" @click="emit('retry')">{{ t("task.error.reload") }}</button></p>
    <div v-else-if="!list.length && !loading" class="hist__empty">
      <strong>{{ t("checkin.history.empty.title") }}</strong>
      <p>{{ t("checkin.history.empty.body") }}</p>
      <a href="#" class="link" @click.prevent="emit('top')">{{ t("checkin.history.empty.cta") }}</a>
    </div>
    <ul v-else class="hist__list">
      <li v-for="d in shown" :key="`${d.at}-${d.chest}-${d.stripSeed ?? ''}`" class="hist__row" :class="{ 'hist__row--off': d.status !== 'pending' && !!d.expiresAt && Date.parse(d.expiresAt) <= now }">
        <span class="hist__date">{{ date(d.at) }}</span>
        <span class="hist__box">{{ title(d) }}</span>
        <span class="hist__prize">
          <template v-if="d.tier"><i class="dot" :class="tierDot(d.tier)" aria-hidden="true" />{{ t(`checkin.result.tier.${d.tier}`) }}</template>
          <strong v-if="d.credits != null && (!d.item || d.duplicate)">+{{ whole(d.credits) }}</strong>
          <strong v-else-if="d.item">{{ t("checkin.result.cosmetic.frame") }}</strong>
        </span>
        <span class="hist__exp">{{ right(d) }}</span>
      </li>
    </ul>
    <template v-if="open">
      <button v-if="more" type="button" class="btn btn--sm hist__more" :disabled="loading" @click="emit('more')">{{ t("checkin.history.more") }}</button>
      <p v-if="plan" class="subtle hist__keep">{{ t("checkin.history.retention", { days: plan.drawRetentionDays }) }}</p>
    </template>
  </section>
</template>

<style scoped>
.hist { padding:var(--s-4); display:grid; gap:var(--s-2); }
.hist__head { display:flex; align-items:center; justify-content:space-between; gap:var(--s-3); }
.hist__head h2 { margin:0; font-size:16px; font-weight:700; }
.hist__list { list-style:none; margin:0; padding:0; display:grid; }
.hist__row { display:grid; grid-template-columns:auto minmax(0,1fr) auto; grid-template-areas:"date box prize" "date exp exp"; gap:2px var(--s-3); align-items:baseline; padding:var(--s-2) 0; border-top:1px solid var(--line); }
.hist__row:first-child { border-top:0; }
.hist__date { grid-area:date; font-size:12px; color:var(--text-3); white-space:nowrap; font-variant-numeric:tabular-nums; }
.hist__box { grid-area:box; font-size:13.5px; font-weight:600; min-width:0; overflow-wrap:anywhere; }
.hist__prize { grid-area:prize; display:inline-flex; align-items:center; gap:6px; font-size:13px; white-space:nowrap; justify-self:end; }
.hist__prize strong { font-variant-numeric:tabular-nums; }
.hist__exp { grid-area:exp; font-size:12px; color:var(--text-2); justify-self:end; }
.hist__row--off .hist__box, .hist__row--off .hist__prize, .hist__row--off .hist__exp { color:var(--text-3); }
.dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
.dot--plain { background:var(--text-3); }
.dot--accent { background:var(--accent); }
.dot--gold { background:var(--prize-gold); }
.hist__empty { display:grid; gap:4px; justify-items:start; padding:var(--s-2) 0; }
.hist__empty p { margin:0; font-size:13px; color:var(--text-2); }
.hist__more { justify-self:center; }
.hist__keep { text-align:center; margin:0; }
</style>
