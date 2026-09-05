<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { fetchScoreRecords, TOP_UP_URL, type ScoreRecord } from "@/lib/api";
import { clock, dateOnly, dayLabel, whole } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";

const session = useSession();
const { t } = useI18n();

const PAGE = 30;
const records = ref<ScoreRecord[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref("");
type Kind = "all" | "add" | "sub";
const kind = ref<Kind>("all");

const PLAN_LABEL: Record<string, string> = { unlimited: "wallet.plan.unlimited", member: "wallet.plan.member", trial: "wallet.plan.trial" };

async function load(reset = false) {
  if (reset) { page.value = 1; records.value = []; }
  loading.value = true;
  error.value = "";
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const res = await fetchScoreRecords(token, page.value, PAGE);
    records.value = reset ? res.records : [...records.value, ...res.records];
    total.value = res.total;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}
const hasMore = computed(() => records.value.length < total.value);
function more() { page.value += 1; load(); }

/** 收入／支出的篩選在手上這批裡做：流水是自己的，量不大，不值得為它多一條 API。 */
const shown = computed(() => records.value.filter((r) => (kind.value === "all" ? true : r.recordType === kind.value)));
/** 按日分組：同一天的擠在一起，時間只顯示時分。 */
const groups = computed(() => {
  const out: { label: string; rows: ScoreRecord[] }[] = [];
  for (const r of shown.value) {
    const label = dayLabel(r.createTime);
    const last = out[out.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else out.push({ label, rows: [r] });
  }
  return out;
});

const refresh = () => session.refreshWallet();
onMounted(() => {
  document.title = pageTitle(t("wallet.title"));
  track("wallet_view");
  refresh();
  // 在別的分頁充完值切回來：視窗一取得焦點就更新餘額與流水
  window.addEventListener("focus", refresh);
});
onBeforeUnmount(() => window.removeEventListener("focus", refresh));
watch(() => session.me?.accountNumId, () => load(true), { immediate: true });
</script>

<template>
  <div class="page wallet">
    <h1 class="display wallet__title">{{ $t("wallet.title") }}</h1>

    <div class="wallet__grid">
      <aside class="wallet__side">
        <!-- 餘額：這頁唯一的大數字 -->
        <section class="panel balance">
          <p class="eyebrow">{{ $t("wallet.balance") }}</p>
          <p class="balance__num">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.9 4.1 4.5.5-3.3 3.1.9 4.4L8 11.4l-3.9 2.2.9-4.4L1.6 6.1l4.5-.5z" /></svg>
            <span v-if="session.wallet">{{ whole(session.wallet.score + session.wallet.tempScore) }}</span>
            <span v-else class="ghost balance__ghost" />
          </p>
          <p v-if="session.wallet?.tempScore" class="subtle">{{ $t("wallet.temp", { n: whole(session.wallet.tempScore) }) }}</p>
          <a class="btn btn--primary btn--lg balance__cta" :href="TOP_UP_URL" target="_blank" rel="noopener" @click="track('topup_click')">{{ $t("wallet.topUp") }} ↗</a>
        </section>

        <section class="panel plans">
          <p class="eyebrow">{{ $t("wallet.plan") }}</p>
          <ul v-if="session.wallet?.plans.length" class="plans__list">
            <li v-for="plan in session.wallet.plans" :key="plan.tier" class="plan">
              <span class="plan__tier" :class="`plan__tier--${plan.tier}`">{{ $t(PLAN_LABEL[plan.tier] ?? "wallet.plan") }}</span>
              <span class="subtle">{{ $t("wallet.plan.expires", { date: dateOnly(plan.expiresAt) }) }}</span>
            </li>
          </ul>
          <p v-else class="muted plans__none">{{ $t("wallet.plan.none") }}</p>
        </section>
      </aside>

      <section class="panel history">
        <div class="history__head">
          <h2 class="history__title">{{ $t("wallet.records") }}<span v-if="total" class="history__n">{{ total }}</span></h2>
          <div class="seg">
            <button v-for="k in (['all', 'add', 'sub'] as Kind[])" :key="k" class="seg__item" :class="{ 'seg__item--on': kind === k }" :aria-pressed="kind === k" @click="kind = k">
              {{ $t(k === 'all' ? 'wallet.records.all' : k === 'add' ? 'wallet.records.income' : 'wallet.records.expense') }}
            </button>
          </div>
        </div>

        <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
        <div v-else-if="loading && !records.length" class="history__ghosts"><div v-for="i in 8" :key="i" class="ghost" /></div>
        <p v-else-if="!shown.length" class="muted history__empty">{{ $t("wallet.records.empty") }}</p>

        <div v-else class="ledger">
          <section v-for="g in groups" :key="g.label" class="ledger__day">
            <h3 class="ledger__date">{{ g.label }}</h3>
            <ul class="ledger__rows">
              <li v-for="r in g.rows" :key="r.id" class="row">
                <span class="row__dot" :class="r.recordType === 'add' ? 'row__dot--add' : 'row__dot--sub'" aria-hidden="true">{{ r.recordType === "add" ? "+" : "−" }}</span>
                <span class="row__item">{{ r.record }}</span>
                <span class="row__time subtle">{{ clock(r.createTime) }}</span>
                <span class="row__num" :class="r.recordType === 'add' ? 'row__num--add' : ''">{{ r.recordType === "add" ? "+" : "−" }}{{ whole(r.score) }}</span>
              </li>
            </ul>
          </section>
        </div>

        <!-- 不翻頁，往下接：流水是往回看的東西，沒有人需要跳到第七頁 -->
        <button v-if="hasMore" class="btn btn--sm history__more" :disabled="loading" @click="more()">
          {{ loading ? "…" : $t("comment.loadMore") }}
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.wallet { max-width: 1080px; }
.wallet__title { font-size: 22px; margin-bottom: var(--s-4); }
.wallet__grid { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: var(--s-4); align-items: start; }
.wallet__side { display: grid; gap: var(--s-4); position: sticky; top: calc(var(--header-h) + var(--s-4)); }

.balance { display: grid; gap: 6px; padding: var(--s-5); }
.balance__num { display: inline-flex; align-items: center; gap: 8px; margin: 2px 0; font-size: 36px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
.balance__num svg { width: 22px; height: 22px; fill: var(--gold); filter: drop-shadow(0 1px 2px rgba(242, 176, 30, 0.4)); }
.balance__ghost { display: inline-block; width: 120px; height: 36px; }
.balance__cta { margin-top: var(--s-3); }

.plans { padding: var(--s-4) var(--s-5); }
.plans__list { list-style: none; margin: var(--s-2) 0 0; padding: 0; display: grid; gap: var(--s-2); }
.plan { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); }
.plan__tier { padding: 2px 9px; border-radius: 6px; font-size: 12.5px; font-weight: 600; background: var(--surface-2); }
.plan__tier--unlimited { background: var(--accent-tint); color: var(--accent-text); }
.plan__tier--member { background: var(--gold-soft); color: var(--gold-dark); }
.plans__none { margin-top: 4px; font-size: 13.5px; }

.history { padding: var(--s-4) var(--s-5) var(--s-5); display: grid; gap: var(--s-3); }
.history__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); }
.history__title { font-size: 15px; font-weight: 600; }
.history__n { margin-left: 6px; font-size: 12px; font-weight: 500; color: var(--text-3); font-variant-numeric: tabular-nums; }
.history__ghosts { display: grid; gap: 8px; }
.history__ghosts .ghost { height: 44px; }
.history__empty { font-size: 13.5px; padding: var(--s-6) 0; text-align: center; }
.history__more { justify-self: center; }

.ledger { display: grid; gap: var(--s-4); }
.ledger__date { font-size: 12px; font-weight: 600; color: var(--text-3); margin-bottom: 4px; }
.ledger__rows { list-style: none; margin: 0; padding: 0; }
.row {
  display: grid; grid-template-columns: 26px minmax(0, 1fr) auto auto; align-items: center; gap: var(--s-3);
  padding: 9px 8px; margin: 0 -8px; border-radius: var(--r-sm);
  font-size: 13.5px;
  transition: background var(--dur) var(--ease);
}
.row:hover { background: var(--surface-2); }
.row__dot { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 999px; font-size: 14px; font-weight: 700; }
.row__dot--add { background: var(--success-soft); color: var(--success); }
.row__dot--sub { background: var(--surface-2); color: var(--text-3); }
.row__item { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row__time { font-variant-numeric: tabular-nums; }
.row__num { min-width: 5em; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.row__num--add { color: var(--success); }

@media (max-width: 820px) {
  .wallet__grid { grid-template-columns: 1fr; }
  .wallet__side { position: static; }
  .row { grid-template-columns: 26px minmax(0, 1fr) auto; }
  .row__time { display: none; }
}
</style>
