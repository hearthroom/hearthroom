<script setup lang="ts">
/**
 * 機率公告（ui.md §8）：公開頁，不登入也能看。表格與滾輪格子讀同一份獎表（Harbor 公開方案），
 * 語系檔與程式都沒有任何機率或金額（LunaTalk 三端各存一份、對不上的教訓）。
 * 公告的是不含保底的機率；保底另寫一段規則。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { chestTitle } from "@/lib/checkin";
import { fetchPlan, type RewardPlan } from "@/lib/rewards";
import { dateOnly, whole } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";

const { t, locale } = useI18n();
const { lp } = useLocalePath();
const plan = ref<RewardPlan | null>(null);
const error = ref(false);

/** 公告順序：簽到的寶箱依週期與里程碑，再來是任務與新手；獎表裡沒有的不列。 */
const ORDER = ["daily", "day3", "day7", "m14", "m28", "daily_all", "weekly_active", "weekly_share", "newcomer"];
const chests = computed(() => {
  const p = plan.value;
  if (!p) return [];
  const keys = Object.keys(p.chests).sort((a, b) => (ORDER.indexOf(a) + 100 * +(ORDER.indexOf(a) < 0)) - (ORDER.indexOf(b) + 100 * +(ORDER.indexOf(b) < 0)));
  return keys.map((key) => {
    const c = chestTitle(key, p);
    const prizes = [...p.chests[key].prizes].sort((a, b) => (a.credits ?? Infinity) - (b.credits ?? Infinity));
    return { key, title: t(c.key, c.params ?? {}), prizes };
  });
});
const pct = (bps: number) => new Intl.NumberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bps / 100) + "%";

async function load() {
  error.value = false;
  try { plan.value = await fetchPlan(); } catch { error.value = true; }
}
onMounted(() => { document.title = pageTitle(t("odds.title")); void load(); });
</script>

<template>
  <div class="page page--narrow odds">
    <h1 class="display">{{ t("odds.title") }}</h1>
    <p v-if="plan" class="subtle">{{ t("odds.updated", { date: dateOnly(Math.floor(Date.parse(plan.updatedAt) / 1000)) }) }}</p>

    <div v-if="error" class="notice notice--error odds__error" role="alert">
      <p>{{ t("odds.error") }}</p>
      <button type="button" class="btn" @click="load">{{ t("odds.reload") }}</button>
    </div>
    <template v-else-if="!plan">
      <div v-for="i in 3" :key="i" class="panel odds__ghost" aria-busy="true"><span class="ghost" /><span class="ghost" /><span class="ghost" /></div>
    </template>
    <template v-else>
      <nav class="odds__chips" :aria-label="t('odds.title')">
        <a v-for="c in chests" :key="c.key" :href="`#${c.key}`" class="chip">{{ c.title }}</a>
      </nav>
      <section v-for="c in chests" :id="c.key" :key="c.key" class="panel odds__box" :aria-labelledby="`odds-${c.key}`">
        <h2 :id="`odds-${c.key}`">{{ c.title }}</h2>
        <table>
          <thead><tr><th scope="col">{{ t("odds.col.prize") }}</th><th scope="col">{{ t("odds.col.chance") }}</th></tr></thead>
          <tbody>
            <tr v-for="p in c.prizes" :key="p.tier">
              <td>
                <span class="odds__tier"><i class="dot" :class="p.tier >= 5 ? 'dot--gold' : p.tier >= 3 ? 'dot--accent' : 'dot--plain'" aria-hidden="true" />{{ t(`checkin.result.tier.${p.tier}`) }}</span>
                {{ p.item ? t("checkin.result.cosmetic.frame") : t("odds.prize.credits", { amount: whole(p.credits ?? 0) }) }}
              </td>
              <td>{{ pct(p.bps) }}</td>
            </tr>
          </tbody>
          <tfoot><tr><th scope="row">{{ t("odds.total") }}</th><td>{{ pct(c.prizes.reduce((s, p) => s + p.bps, 0)) }}</td></tr></tfoot>
        </table>
      </section>
      <section class="panel odds__rules">
        <h2>{{ t("odds.rules.title") }}</h2>
        <ul>
          <li v-if="plan.pity">{{ t("odds.rules.pity", { count: plan.pity.every - 1, amount: whole(plan.pity.threshold) }) }}</li>
          <li>{{ t("odds.rules.equal") }}</li>
          <li>{{ t("odds.rules.noBuy") }}</li>
          <li>{{ t("odds.rules.records", { days: plan.drawRetentionDays }) }}</li>
        </ul>
      </section>
    </template>
    <p class="odds__back"><RouterLink :to="lp('/checkin')" class="link">{{ t("odds.back") }}</RouterLink></p>
  </div>
</template>

<style scoped>
.odds { display:grid; gap:var(--s-4); padding-top:var(--s-5); padding-bottom:var(--s-7); }
.odds h1 { margin:0; font-size:1.5rem; }
.odds > .subtle { margin:-8px 0 0; }
.odds__chips { display:flex; gap:var(--s-2); overflow-x:auto; margin:0 calc(-1 * var(--s-4)); padding:2px var(--s-4); scrollbar-width:none; }
.odds__chips .chip { flex:none; height:32px; padding:0 12px; display:inline-flex; align-items:center; background:var(--surface); box-shadow:0 0 0 1px var(--line); white-space:nowrap; }
.odds__box, .odds__rules { padding:var(--s-4); scroll-margin-top:calc(var(--header-h) + var(--s-3)); }
.odds__box h2, .odds__rules h2 { margin:0 0 var(--s-2); font-size:16px; }
table { width:100%; border-collapse:collapse; font-size:14px; font-variant-numeric:tabular-nums; }
th, td { padding:var(--s-2) 0; text-align:left; border-top:1px solid var(--line); }
thead th { border-top:0; font-size:12px; font-weight:500; color:var(--text-3); }
td:last-child, th:last-child { text-align:right; width:72px; }
tfoot th, tfoot td { font-weight:600; }
.odds__tier { display:inline-flex; align-items:center; gap:6px; min-width:6.5em; color:var(--text-2); font-size:13px; }
.dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
.dot--plain { background:var(--text-3); } .dot--accent { background:var(--accent); } .dot--gold { background:var(--prize-gold); }
.odds__rules ul { margin:0; padding-left:1.2em; display:grid; gap:var(--s-2); font-size:14px; line-height:1.7; color:var(--text-2); }
.odds__ghost { padding:var(--s-4); display:grid; gap:var(--s-2); }
.odds__ghost .ghost { height:20px; }
.odds__error { display:grid; gap:var(--s-2); justify-items:start; }
.odds__error p { margin:0; }
.odds__back { margin:0; text-align:center; }
</style>
