<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { fetchScoreRecords, fetchScoreSummary, fetchWallet, type Wallet, type ScoreDay, type ScoreRecord } from "@/lib/api";
import { clock, dayLabel, localDate, monthDayTime, whole } from "@/lib/format";
import ExpiryStrip from "@/components/checkin/ExpiryStrip.vue";
import { accountToken } from "@/lib/connections";
import { providerName, type ProviderId } from "@/lib/provider";
import { track } from "@/lib/track";
import { byWeek, lastDays, spentTotals } from "@/lib/score-usage";
import UsageChart from "@/components/UsageChart.vue";
import WalletInvite from "@/components/WalletInvite.vue";
import PlanToday from "@/components/checkin/PlanToday.vue";
import { useCheckin } from "@/lib/checkin-store";
import { usePeriodPlans } from "@/lib/period-plan-store";
import { firstDaily, planDate, planPrice, purchaseLink } from "@/lib/period-plan";
import { useLocalePath } from "@/lib/use-locale";

const props = defineProps<{ provider: ProviderId; externalId: number }>();
const wallet = ref<Wallet | null>(null);
const { t, te, locale } = useI18n();

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
 * 限時積分的來源（Harper 的 kind／rewardKind）對到錢包已有的名字；同一種獎勵在錢包裡只有一個名字。
 * 不認得的值不顯示原始代碼（copy.md §8.4 來源表）。
 */
const SOURCE: Record<string, string> = { checkin: "checkin", task: "task", newcomer: "newcomer", referral: "referral", welcome: "signup", event: "campaign", other: "grant" };
const sourceOf = (kind?: string) => (kind && SOURCE[kind] ? t(`wallet.reason.${SOURCE[kind]}`) : "");
/** 月卡的列（PM 2026-10-19 R3＝A）：每日、首張加贈，與退款收回它們的列。不認得的種類照服務給的分類。 */
const PLAN_ITEM: Record<string, [string, string]> = { daily: ["planDaily", "refundPlanDaily"], bonus: ["planBonus", "refundPlanBonus"] };
function planItemOf(r: ScoreRecord): string {
  if (!r.planKind) return "";
  const known = PLAN_ITEM[r.planKind];
  if (known) return t(`wallet.reason.${known[r.record === "refund" ? 1 : 0]}`);
  // 不認得的月卡種類：用通用的入帳或退款名稱，不露出原始代碼（ui.md §4.5）
  return t(r.record === "refund" ? "wallet.reason.refund" : "wallet.reason.grant");
}
/** 流水的項目名：獎勵入帳用來源的名字（簽到寶箱、任務獎勵…），其餘照服務給的分類。 */
const itemOf = (r: ScoreRecord) => planItemOf(r) || (r.recordType === "add" && r.rewardKind && SOURCE[r.rewardKind] ? sourceOf(r.rewardKind) : reason(r.record));
/** 第二行：限時積分入帳寫到期時間（過了寫已到期）；到期那一筆寫是哪一種獎勵到期。 */
function subOf(r: ScoreRecord): { text: string; off: boolean } | null {
  // 月卡的積分不會到期：入帳列沒有第二行，和限時的寶箱一眼分得開；退回列寫是退款
  if (planItemOf(r)) return r.record === "refund" ? { text: t("wallet.record.planRefund"), off: false } : null;
  if (r.recordType === "add" && r.expiresAt) {
    const off = Date.parse(r.expiresAt) <= Date.now();
    return { text: off ? t("wallet.record.expired") : t("wallet.record.expires", { datetime: monthDayTime(r.expiresAt) }), off };
  }
  if (r.record === "expire" && sourceOf(r.rewardKind)) return { text: t("wallet.record.expiredFrom", { source: sourceOf(r.rewardKind) }), off: false };
  return null;
}
const expiries = computed(() => wallet.value?.expiries ?? []);
const detailOpen = ref(false);

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

// ---- 月卡（ui.md §4）：持卡的人看今天那一行，沒卡的人在「前往儲值」下方有一行入口 ----
const plans = usePeriodPlans();
const checkin = useCheckin();
const { lp } = useLocalePath();
const mine = computed(() => (plans.mine?.active ? plans.mine : null));
/** 今天簽到過沒有：簽到面板讀過才知道，沒讀過就照「簽到時一起領」寫（ui.md §4.2） */
const planLine = computed(() => plans.line(checkin.panel ? checkin.panel.checkin.todayClaimed : null));
const planLink = computed(() => purchaseLink(plans.offer));
const pitch = computed(() => {
  const o = plans.offer;
  if (mine.value || !o?.onSale) return "";
  // 首次購買才用加倍後的每天量；「最多」是每天都領到的上限（copy.md v2 的 {maxTotal}），持卡狀態讀不到時照一般的算
  const first = plans.mine?.firstBonus.status === "available" && o.firstBonusDailyCredits > 0;
  const daily = first ? firstDaily(o) : o.dailyCredits;
  const vars = { price: planPrice(o, locale.value), credits: whole(o.credits), dailyCredits: whole(o.dailyCredits), firstDaily: whole(firstDaily(o)), maxTotal: whole(o.credits + daily * o.days) };
  return t(first ? "plan.wallet.pitchBonus" : "plan.wallet.pitch", vars);
});

/** 錢包頁的「領取」：領到了就連餘額與流水一起重讀 */
async function claimToday() {
  if (await plans.claim()) { void refresh(); void load(true); }
}

async function refresh() {
  void plans.load();
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

    <ExpiryStrip :expiring="expiries" :now="Date.now()" />
    <!-- 第一排：手上有多少、怎麼拿到更多（儲值、邀請）、最近用了多少 -->
    <div class="overview">
      <section class="panel balance" data-tour="wallet-balance">
        <p class="eyebrow">{{ $t("wallet.balance") }}</p>
        <p class="balance__num">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.9 4.1 4.5.5-3.3 3.1.9 4.4L8 11.4l-3.9 2.2.9-4.4L1.6 6.1l4.5-.5z" /></svg>
          <span v-if="wallet">{{ whole(wallet.score + wallet.tempScore) }}</span>
          <span v-else class="subtle">{{ $t("linked.balanceUnknown") }}</span>
        </p>
        <p v-if="wallet?.tempScore" class="subtle">{{ $t("wallet.temp", { n: whole(wallet.tempScore) }) }}</p>
        <p v-if="wallet?.tempScore && expiries.length" class="subtle">{{ $t("wallet.tempEarliest", { datetime: monthDayTime(expiries[0].expiresAt) }) }}</p>
        <!-- 限時積分明細：每一筆的金額、來源、到期時間（owner 2026-10-19，跟 Console 一致）；預設收起 -->
        <div v-if="wallet?.tempScore && expiries.length" class="expiring">
          <div class="expiring__head">
            <span class="expiring__title">{{ $t("wallet.expiring.title") }}</span>
            <button type="button" class="btn btn--ghost btn--sm" :aria-expanded="detailOpen" @click="detailOpen = !detailOpen">{{ detailOpen ? $t("wallet.expiring.hide") : $t("wallet.expiring.show") }}</button>
          </div>
          <ul v-if="detailOpen" class="expiring__list">
            <li v-for="(e, i) in expiries" :key="`${e.expiresAt}-${i}`">
              <strong>{{ $t("wallet.expiring.amount", { amount: whole(e.amount) }) }}</strong>
              <span v-if="sourceOf(e.kind)" class="expiring__src">{{ sourceOf(e.kind) }}</span>
              <span class="expiring__at">{{ $t("wallet.record.expires", { datetime: monthDayTime(e.expiresAt) }) }}</span>
            </li>
          </ul>
        </div>
        <div v-if="mine && planLine.kind !== 'hidden'" class="plan" data-testid="wallet-plan">
          <div class="plan__head">
            <span class="plan__title">{{ mine.remainingDays <= 1 ? $t("plan.row.title.last") : $t("plan.row.title", { n: whole(mine.remainingDays) }, mine.remainingDays) }}</span>
            <span v-if="mine.endsOn" class="plan__last">{{ $t("plan.wallet.lastDay", { date: planDate(mine.endsOn, locale) }) }}</span>
          </div>
          <div class="plan__today">
            <PlanToday class="plan__line" :line="planLine" :claiming="plans.claiming" @claim="claimToday" />
            <RouterLink v-if="planLine.kind === 'withCheckin'" :to="lp('/checkin')" class="link plan__go">{{ $t("plan.wallet.goCheckin") }}</RouterLink>
          </div>
          <p v-if="planLine.bonusCredits > 0" class="plan__sub">{{ $t("plan.row.bonusPart", { bonus: whole(planLine.bonusCredits) }) }}</p>
          <p v-if="checkin.panel" class="plan__sub">{{ $t("plan.row.makeup", { left: whole(checkin.panel.checkin.makeup.left) }, checkin.panel.checkin.makeup.left) }}</p>
          <a v-if="mine.canPurchase" class="link plan__more" :href="planLink" target="_blank" rel="noopener" @click="track('plan_click', { detail: 'wallet' })">{{ $t("plan.wallet.buyMore") }}</a>
        </div>
        <a class="btn btn--primary btn--lg balance__cta" href="https://console.harperharbor.com/me/billing" target="_blank" rel="noopener" @click="track('topup_click')">{{ $t("wallet.topUp") }} ↗</a>
        <a v-if="pitch" class="link plan__pitch" data-testid="wallet-plan-pitch" :href="planLink" target="_blank" rel="noopener" @click="track('plan_click', { detail: 'wallet' })">{{ pitch }}</a>
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

    <section class="panel history" data-tour="wallet-records">
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
              <span class="row__item" :class="{ 'row__item--off': subOf(r)?.off }"><span class="row__name">{{ itemOf(r) }}</span><small v-if="subOf(r)" class="row__sub">{{ subOf(r)!.text }}</small></span>
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
.row__item { display: grid; min-width: 0; }
.row__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row__sub { font-size: 12px; color: var(--text-2); }
.row__item--off .row__name, .row__item--off .row__sub { color: var(--text-3); }
.plan { display: grid; gap: 4px; padding-top: var(--s-2); border-top: 1px solid var(--line); }
.plan__head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px var(--s-2); }
.plan__title { font-size: 14px; font-weight: 600; }
.plan__last { font-size: 12px; color: var(--text-2); }
.plan__today { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1) var(--s-3); }
.plan__line { justify-content: flex-start; }
.plan__go, .plan__more { display: inline-flex; align-items: center; min-height: 30px; font-size: 13px; }
.plan__more { justify-self: start; }
.balance .plan__sub { font-size: 12px; color: var(--text-3); }
.plan__pitch { font-size: 13px; color: var(--text-2); text-wrap: pretty; }
.expiring { display: grid; gap: var(--s-1); padding-top: var(--s-2); border-top: 1px solid var(--line); }
.expiring__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
.expiring__title { font-size: 13px; font-weight: 600; }
.expiring__list { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow-y: auto; display: grid; }
.expiring__list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px var(--s-2); align-items: baseline; min-height: 44px; padding: var(--s-1) 0; border-top: 1px solid var(--line); }
.expiring__list li:first-child { border-top: 0; }
.expiring__list strong { font-variant-numeric: tabular-nums; white-space: nowrap; }
.expiring__src { font-size: 12px; color: var(--text-2); text-align: right; }
.expiring__at { grid-column: 1 / -1; font-size: 12px; color: var(--text-2); }
.row__time { font-variant-numeric: tabular-nums; }
.row__num { min-width: 5em; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.row__num--add { color: var(--success); }

@media (max-width: 820px) {
  .row { grid-template-columns: 26px minmax(0, 1fr) auto; }
  .row__time { display: none; }
}
</style>
