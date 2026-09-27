<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { fetchScoreRecords, fetchScoreSummary, fetchWallet, type Wallet, type ScoreDay, type ScoreRecord } from "@/lib/api";
import { clock, dayLabel, localDate, whole } from "@/lib/format";
import { accountToken } from "@/lib/connections";
import { providerName, type ProviderId } from "@/lib/provider";
import { track } from "@/lib/track";
import { byWeek, lastDays, spentTotals } from "@/lib/score-usage";
import UsageChart from "@/components/UsageChart.vue";
import WalletInvite from "@/components/WalletInvite.vue";

const props = defineProps<{ provider: ProviderId; externalId: number }>();
const wallet = ref<Wallet | null>(null);
const { t, te } = useI18n();

const PAGE = 30;
const records = ref<ScoreRecord[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const error = ref("");
type Kind = "all" | "add" | "sub";
const kind = ref<Kind>("all");

async function load(reset = false) {
  if (reset) { page.value = 1; records.value = []; }
  loading.value = true;
  error.value = "";
  try {
    const token = await accountToken(props.provider, props.externalId);
    if (!token) throw new Error(t("auth.expired"));
    const res = await fetchScoreRecords(token, page.value, PAGE, props.provider);
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
/** 流水的項目：服務給的是分類代碼（chat、purchase…），換成使用者看得懂的名字；沒見過的代碼照原樣顯示。 */
const reason = (code: string) => (te(`wallet.reason.${code}`) ? t(`wallet.reason.${code}`) : code);

/**
 * 最近 84 天的每日收支（剛好十二週）：上面的數字、長條圖，以及流水每一天的小計都從這裡來。
 * 讀不到就整塊不顯示，流水照常。
 */
const days = ref<ScoreDay[] | null>(null);
const byDate = computed(() => new Map((days.value ?? []).map((d) => [d.date, d])));
const totals = computed(() => (days.value ? spentTotals(days.value) : null));
type Range = "7" | "30" | "week";
const range = ref<Range>("30");
const bars = computed(() => (!days.value ? [] : range.value === "week" ? byWeek(days.value).slice(-12) : lastDays(days.value, Number(range.value))));

/** 按日分組：同一天的擠在一起，時間只顯示時分；每一天附上當天的支出與收入小計。 */
const groups = computed(() => {
  const out: { key: string; label: string; rows: ScoreRecord[]; spent: number; earned: number }[] = [];
  for (const r of shown.value) {
    const key = localDate(r.createTime);
    const last = out[out.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else out.push({ key, label: dayLabel(r.createTime), rows: [r], spent: 0, earned: 0 });
  }
  for (const [i, g] of out.entries()) {
    const day = byDate.value.get(g.key);
    if (day) { g.spent = day.spent; g.earned = day.earned; continue; }
    // 統計沒涵蓋到的舊日子：只有整天都載進來了才自己加（最後一組可能還有沒翻到的）
    if (i === out.length - 1 && hasMore.value) { g.spent = g.earned = -1; continue; }
    for (const r of g.rows) { if (r.recordType === "add") g.earned += r.score; else g.spent += r.score; }
  }
  return out;
});

async function loadSummary() {
  try {
    const token = await accountToken(props.provider, props.externalId);
    if (!token) throw new Error(t("auth.expired"));
    days.value = await fetchScoreSummary(token, 84, props.provider);
  } catch { days.value = null; }
}

async function refresh() {
  try {
    const token = await accountToken(props.provider, props.externalId);
    if (!token) throw new Error(t('auth.expired'));
    wallet.value = await fetchWallet(token, props.provider);
  } catch { wallet.value = null; }
  void loadSummary();
}
onMounted(() => {
  refresh();
  // 在別的分頁充完值切回來：視窗一取得焦點就更新餘額與流水
  window.addEventListener("focus", refresh);
});
onBeforeUnmount(() => window.removeEventListener("focus", refresh));
watch(() => [props.provider, props.externalId], () => load(true), { immediate: true });
</script>

<template>
  <section class="wallet-service">
    <h2 class="wallet__title">{{ providerName(provider) }}</h2>

    <!-- 第一排：手上有多少、怎麼拿到更多（儲值、邀請）、最近用了多少 -->
    <div class="overview">
      <section class="panel balance">
        <p class="eyebrow">{{ $t("wallet.balance") }}</p>
        <p class="balance__num">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.9 4.1 4.5.5-3.3 3.1.9 4.4L8 11.4l-3.9 2.2.9-4.4L1.6 6.1l4.5-.5z" /></svg>
          <span v-if="wallet">{{ whole(wallet.score + wallet.tempScore) }}</span>
          <span v-else class="subtle">{{ $t("linked.balanceUnknown") }}</span>
        </p>
        <p v-if="wallet?.tempScore" class="subtle">{{ $t("wallet.temp", { n: whole(wallet.tempScore) }) }}</p>
        <a class="btn btn--primary btn--lg balance__cta" href="https://console.harperharbor.com/me/wallet" target="_blank" rel="noopener" @click="track('topup_click')">{{ $t("wallet.topUp") }} ↗</a>
      </section>

      <WalletInvite :provider="provider" :external-id="externalId" />

      <section v-if="totals" class="panel spent" data-testid="wallet-spent">
        <p class="eyebrow">{{ $t("wallet.usage.spent") }}</p>
        <dl class="spent__list">
          <div><dt>{{ $t("time.today") }}</dt><dd>{{ whole(totals.today) }}</dd></div>
          <div><dt>{{ $t("wallet.usage.thisWeek") }}</dt><dd>{{ whole(totals.week) }}</dd></div>
          <div><dt>{{ $t("wallet.usage.last30") }}</dt><dd>{{ whole(totals.month) }}</dd></div>
        </dl>
        <p class="spent__note subtle">{{ $t("wallet.usage.scope", { provider: providerName(provider) }) }}</p>
      </section>
    </div>

    <section v-if="days" class="panel usage">
      <div class="panel__head">
        <h2 class="panel__title">{{ $t("wallet.usage.title") }}</h2>
        <div class="seg">
          <button v-for="r in (['7', '30', 'week'] as Range[])" :key="r" type="button" class="seg__item" :class="{ 'seg__item--on': range === r }" :aria-pressed="range === r" @click="range = r">
            {{ $t(r === '7' ? 'wallet.usage.range7' : r === '30' ? 'wallet.usage.range30' : 'wallet.usage.rangeWeek') }}
          </button>
        </div>
      </div>
      <UsageChart :bars="bars" :weekly="range === 'week'" />
    </section>

    <section class="panel history">
      <div class="panel__head">
        <h2 class="panel__title">{{ $t("wallet.records") }}<span v-if="total" class="history__n">{{ total }}</span></h2>
        <div class="seg">
          <button v-for="k in (['all', 'add', 'sub'] as Kind[])" :key="k" type="button" class="seg__item" :class="{ 'seg__item--on': kind === k }" :aria-pressed="kind === k" @click="kind = k">
            {{ $t(k === 'all' ? 'wallet.records.all' : k === 'add' ? 'wallet.records.income' : 'wallet.records.expense') }}
          </button>
        </div>
      </div>

      <div v-if="error" class="notice notice--error" role="alert"><p>{{ error }}</p><button class="btn" :disabled="loading" @click="load(true); refresh()">{{ $t("linked.retry") }}</button></div>
      <div v-else-if="loading && !records.length" class="history__ghosts"><div v-for="i in 8" :key="i" class="ghost" /></div>
      <p v-else-if="!shown.length" class="muted history__empty">{{ $t("wallet.records.empty") }}</p>

      <div v-else class="ledger">
        <section v-for="g in groups" :key="g.key" class="ledger__day">
          <h3 class="ledger__date">
            <span>{{ g.label }}</span>
            <span v-if="g.spent >= 0" class="ledger__sum">
              <template v-if="g.spent">{{ $t("wallet.records.expense") }} {{ whole(g.spent) }}</template>
              <template v-if="g.spent && g.earned"> · </template>
              <template v-if="g.earned">{{ $t("wallet.records.income") }} {{ whole(g.earned) }}</template>
            </span>
          </h3>
          <ul class="ledger__rows">
            <li v-for="r in g.rows" :key="r.id" class="row">
              <span class="row__dot" :class="r.recordType === 'add' ? 'row__dot--add' : 'row__dot--sub'" aria-hidden="true">{{ r.recordType === "add" ? "+" : "−" }}</span>
              <span class="row__item">{{ reason(r.record) }}</span>
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
  </section>
</template>

<style scoped>
.wallet-service { display: grid; gap: var(--s-4); }
.wallet__title { font-size: 22px; }

/* 三張等高的卡：餘額、邀請、最近消耗。窄一點就兩欄，手機一欄 */
.overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--s-4); align-items: stretch; }

.balance { display: flex; flex-direction: column; gap: 6px; padding: var(--s-5); }
.balance__num { display: inline-flex; align-items: center; gap: 8px; margin: 2px 0; font-size: 36px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
.balance__num svg { width: 22px; height: 22px; fill: var(--gold); filter: drop-shadow(0 1px 2px rgba(242, 176, 30, 0.4)); }
.balance__cta { margin-top: auto; }
.balance .eyebrow, .balance p { margin: 0; }

.spent { display: grid; gap: var(--s-3); align-content: start; padding: var(--s-5); }
.spent__list { display: grid; gap: var(--s-2); margin: 0; }
.spent__list div { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-3); }
.spent__list dt { font-size: 13.5px; color: var(--text-2); }
.spent__list dd { margin: 0; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.spent__note { margin: 0; font-size: 12px; }

.panel__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); }
.panel__title { font-size: 15px; font-weight: 600; }

.usage { display: grid; gap: var(--s-5); padding: var(--s-4) var(--s-5) var(--s-5); }

.history { padding: var(--s-4) var(--s-5) var(--s-5); display: grid; gap: var(--s-3); }
.history__n { margin-left: 6px; font-size: 12px; font-weight: 500; color: var(--text-3); font-variant-numeric: tabular-nums; }
.history__ghosts { display: grid; gap: 8px; }
.history__ghosts .ghost { height: 44px; }
.history__empty { font-size: 13.5px; padding: var(--s-6) 0; text-align: center; }
.history__more { justify-self: center; }

.ledger { display: grid; gap: var(--s-4); }
.ledger__date { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-3); font-size: 12px; font-weight: 600; color: var(--text-3); margin-bottom: 4px; }
.ledger__sum { font-weight: 500; font-variant-numeric: tabular-nums; }
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
  .row { grid-template-columns: 26px minmax(0, 1fr) auto; }
  .row__time { display: none; }
}
</style>
