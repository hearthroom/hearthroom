<script setup lang="ts">
/**
 * 社群管理的「發放」分頁 /review/payouts：只給真人應用管理員（活動列表的 canEdit）；其他人直接打網址看到一句說明，服務端每次都再判。
 *
 * 頂部是平台設定的唯讀摘要（是否開放、可用額度、單筆上限）。打開時在背景對帳一次（查 Provider 那邊處理中的發放），
 * 回來後重新載入兩個列表；有補記入帳才說一聲，對帳失敗不打擾，頁面照常用。
 * 「待發放」可勾選（一次最多 20 筆，服務端的批次上限）批次發放或單筆發放，發之前確認筆數與總點數；每筆結果留在那一列，
 * 發完重新載入時，已經離開待發放的列也留著，讓管理員看得到結果。
 * 「發放紀錄」可依狀態篩選。排隊中：重試、取消；處理中：查詢結果，建立滿 10 分鐘且查過「查無」才能取消（服務端同一條規則）；
 * 其他狀態沒有動作。取消要理由，最多 500 字，以字元計。
 * 每個寫入動作的 operationId 依動作與對象保存：失敗重按沿用（服務端會認成同一次），成功就丟掉；不同的勾選組合是不同的批次。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  DEFAULT_TIMEZONE, batchPayout, campaignErrorText, cancelPayout, checkPayout, fetchCampaignPool, fetchCampaigns, fetchPayable, fetchPayouts,
  localized, reconcilePayouts, requestPayout, retryPayout,
  type Campaign, type CampaignPool, type PayableItem, type PayoutListItem, type PayoutStatus, type PayoutView,
} from '@/lib/campaign';
import { confirmDialog } from '@/lib/confirm';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { pageTitle } from '@/lib/i18n';
import { wrapTab } from '@/lib/focus-trap';

const { t } = useI18n();
const session = useSession();
const route = useRoute();
const router = useRouter();
const { lp, locale } = useLocalePath();

/** 服務端一頁的筆數與批次上限（campaign-payout.ts） */
const PAGE = 20;
const BATCH_MAX = 20;
/** 處理中的發放要建立滿這麼久、而且查過「查無」才能取消（campaign-payout.ts 的 TEN_MIN） */
const CANCEL_AFTER = 600_000;
const REASON_MAX = 500;
const STATUSES = ['pending', 'paid', 'blocked_insufficient', 'failed', 'cancelled'] as const satisfies readonly PayoutStatus[];

// ---- 網址上的分段、篩選、頁碼 ----
const one = (v: unknown) => (typeof v === 'string' ? v : '');
const view = computed(() => (one(route.query.view) === 'history' ? 'history' : 'payable'));
const status = computed(() => STATUSES.find((s) => s === one(route.query.status)));
const page = computed(() => { const n = Number(one(route.query.page)); return n >= 1 && Number.isSafeInteger(n) ? n : 1; });
function go(next: { view?: string; status?: string; page?: number }) {
  const q = { view: view.value, status: status.value, page: 1, ...next };
  void router.replace({ query: { ...(q.view === 'history' ? { view: 'history' } : {}), ...(q.status ? { status: q.status } : {}), ...(q.page > 1 ? { page: String(q.page) } : {}) } });
}

// ---- 資料 ----
const access = ref<'loading' | 'ok' | 'denied' | 'error'>('loading');
const accessError = ref('');
const campaigns = ref<Campaign[]>([]);
const pool = ref<CampaignPool | null>(null);
const poolError = ref('');
const reconciled = ref('');
const payable = reactive({ items: [] as PayableItem[], total: 0, loading: true, error: '' });
const history = reactive({ items: [] as PayoutListItem[], total: 0, loading: true, error: '' });
const selected = ref<string[]>([]);
/** 整批送出失敗：結果不確定時是中性的提示，不是紅字 */
const batchNote = ref<{ text: string; uncertain: boolean } | null>(null);
/**
 * 每一列最近一次動作的結果：待發放用內容 id，發放紀錄用發放 id。
 * tone 只管顏色；sent 是「已經發出去或排進佇列」，這種列不能再勾、不能再發。
 */
type Result = { text: string; tone: 'ok' | 'bad' | 'neutral'; sent?: boolean };
/** 待發放裡留著、但重新載入時已經不在待發放的列：結果要到發放紀錄看 */
const gone = reactive(new Set<string>());
const contentResult = reactive(new Map<string, Result>());
const payoutResult = reactive(new Map<string, Result>());
/** 進行中的動作（pay:<內容>、batch、retry:<發放>、check:<發放>） */
const busy = reactive(new Set<string>());
let alive = true, payableGen = 0, historyGen = 0;

/** reactive：畫面要看某一列有沒有還沒了結的單筆發放 */
const ops = reactive(new Map<string, string>());
const opFor = (key: string) => { let id = ops.get(key); if (!id) { id = crypto.randomUUID(); ops.set(key, id); } return id; };

async function token() {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}

/** keep：剛發放過，已經離開待發放但有結果的列留在原位 */
async function loadPayable(keep = false) {
  const gen = ++payableGen;
  payable.loading = true; payable.error = '';
  try {
    const res = await fetchPayable(await token(), { page: view.value === 'payable' ? page.value : 1 });
    if (!alive || gen !== payableGen) return;
    const fresh = new Map(res.items.map((i) => [i.contentId, i]));
    const kept = keep ? payable.items.filter((i) => fresh.has(i.contentId) || contentResult.has(i.contentId)).map((i) => fresh.get(i.contentId) ?? i) : [];
    const seen = new Set(kept.map((i) => i.contentId));
    gone.clear();
    for (const id of seen) if (!fresh.has(id)) gone.add(id);
    payable.items = [...kept, ...res.items.filter((i) => !seen.has(i.contentId))];
    payable.total = res.total;
    selected.value = selected.value.filter((id) => fresh.has(id));
  } catch (e) { if (gen === payableGen) payable.error = campaignErrorText(e); } finally { if (gen === payableGen) payable.loading = false; }
}
async function loadHistory() {
  const gen = ++historyGen;
  history.loading = true; history.error = '';
  try {
    const res = await fetchPayouts(await token(), { status: status.value, page: view.value === 'history' ? page.value : 1 });
    if (!alive || gen !== historyGen) return;
    history.items = res.items; history.total = res.total;
  } catch (e) { if (gen === historyGen) history.error = campaignErrorText(e); } finally { if (gen === historyGen) history.loading = false; }
}
async function loadPool() {
  try { pool.value = await fetchCampaignPool(await token()); poolError.value = ''; } catch (e) { poolError.value = campaignErrorText(e); }
}
/** 發放、重試、取消、查詢之後：兩個列表與額度一起更新 */
const refresh = () => Promise.all([loadPayable(true), loadHistory(), loadPool()]);

async function init() {
  access.value = 'loading';
  try {
    const res = await fetchCampaigns(await token());
    if (!alive) return;
    campaigns.value = res.items;
    access.value = res.canEdit ? 'ok' : 'denied';
  } catch (e) { access.value = 'error'; accessError.value = campaignErrorText(e); return; }
  if (access.value !== 'ok') return;
  void loadPayable(); void loadHistory(); void loadPool();
  // 背景對帳：不擋畫面；失敗不說，下次打開再對
  token().then(reconcilePayouts).then((res) => {
    if (!alive) return;
    const n = res.items.filter((i) => i.result === 'paid').length;
    if (n > 0) reconciled.value = t('campaign.payouts.reconciled', { count: n }, n);
    return refresh();
  }, () => {});
}

// ---- 顯示 ----
const bySlug = computed(() => new Map(campaigns.value.map((c) => [c.slug, c])));
const titleOf = (slug: string) => { const c = bySlug.value.get(slug); return c ? localized(c.title, locale.value) || slug : slug; };
/** 用活動自己的時區顯示；活動讀不到時用看的人的時區 */
const at = (ms: number, slug: string) => new Intl.DateTimeFormat(locale.value, { timeZone: bySlug.value.has(slug) ? bySlug.value.get(slug)!.timezone || DEFAULT_TIMEZONE : undefined, dateStyle: 'medium', timeStyle: 'short' }).format(ms);
const num = (n: number) => n.toLocaleString(String(locale.value));
const points = (n: number) => t('campaign.page.points', { n: num(n) });
/**
 * 一筆發放的結果：狀態，加上紀錄上的原因（點數池不足、Provider 的碼）。
 * 處理中是「送了、還不知道結果」：指向查詢結果，不把暫時的碼當成失敗講。失敗才是紅字。
 */
function outcome(p: PayoutView): Result {
  if (p.status === 'pending') return { tone: 'neutral', sent: true, text: t('campaign.payouts.pendingNote') };
  return { tone: p.status === 'failed' ? 'bad' : 'ok', sent: p.status !== 'failed', text: [t(`campaign.status.${p.status}`), p.error ? campaignErrorText(p.error) : ''].filter(Boolean).join(' · ') };
}
const failure = (e: unknown): Result => ({ tone: 'bad', text: campaignErrorText(e) });
/** 請求送出去之後沒拿到明確的拒絕（斷線、5xx）：錢可能已經發了 */
const uncertain = (e: unknown) => !(e instanceof ApiError) || e.status >= 500;
const payFailure = (e: unknown, attempted: boolean): Result => (attempted && uncertain(e) ? { tone: 'neutral', text: t('campaign.payouts.uncertain') } : failure(e));
const sent = (contentId: string) => contentResult.get(contentId)?.sent === true;
/**
 * 能不能放進批次：已經發出去的、已經離開待發放的、單筆發放還在送或還沒了結（留著 pay:<id> 的 operationId）的都不行。
 * 那些列只能用單筆「發放」重按，它沿用同一個 operationId，服務端認得出是同一次，不會發兩次。
 */
const batchable = (id: string) => !sent(id) && !gone.has(id) && !ops.has(`pay:${id}`) && !busy.has(`pay:${id}`);
/** 單筆發放：離開待發放的列只有還沒了結的那一次可以重按（同一個 operationId） */
const payable1 = (id: string) => !sent(id) && (!gone.has(id) || ops.has(`pay:${id}`));
const toneClass = (r?: Result) => (r ? `rpo-result--${r.tone}` : '');
const canCancel = (p: PayoutListItem) => p.status === 'blocked_insufficient' || (p.status === 'pending' && p.checkedAbsentAt !== null && Date.now() - p.createdAt >= CANCEL_AFTER);

const list = computed(() => (view.value === 'payable' ? payable : history));
const hasNext = computed(() => page.value * PAGE < list.value.total);
const picked = computed(() => payable.items.filter((i) => selected.value.includes(i.contentId) && batchable(i.contentId)));
const pickedPoints = computed(() => picked.value.reduce((s, i) => s + i.due, 0));
function toggle(id: string, on: boolean) {
  selected.value = on ? (selected.value.includes(id) || picked.value.length >= BATCH_MAX ? selected.value : [...selected.value, id]) : selected.value.filter((x) => x !== id);
}

// ---- 動作 ----
/**
 * 跑一個寫入動作：成功丟掉 operationId，失敗留著給下一次重按；不論結果都重新載入。
 * attempted：拿到令牌、請求真的送出去了（令牌過期這種失敗沒有送出任何東西）。
 */
async function act(key: string, run: (access: string) => Promise<void>, onError: (e: unknown, attempted: boolean) => void) {
  if (busy.has(key)) return;
  busy.add(key);
  let attempted = false;
  try { const tk = await token(); attempted = true; await run(tk); ops.delete(key); } catch (e) { onError(e, attempted); } finally { busy.delete(key); }
  await refresh();
}
const confirmPay = (count: number, total: number, confirmText: string) => confirmDialog({ message: t('campaign.payouts.confirm', { count, points: num(total) }, count), confirmText });

async function payOne(item: PayableItem) {
  if (!(await confirmPay(1, item.due, t('campaign.payouts.pay')))) return;
  const key = `pay:${item.contentId}`;
  await act(key, async (tk) => { contentResult.set(item.contentId, outcome(await requestPayout(tk, item.contentId, opFor(key)))); }, (e, attempted) => contentResult.set(item.contentId, payFailure(e, attempted)));
}
async function paySelected() {
  const rows = picked.value;
  if (!rows.length || busy.has('batch')) return;
  if (!(await confirmPay(rows.length, pickedPoints.value, t('campaign.payouts.paySelected')))) return;
  // 同一組勾選不論勾的順序都是同一批：本體與 operationId 的鍵用同一個排序
  const ids = rows.map((i) => i.contentId).sort();
  const key = `batch:${ids.join(',')}`;
  batchNote.value = null;
  busy.add('batch');
  try {
    await act(key, async (tk) => {
      const res = await batchPayout(tk, ids, opFor(key));
      for (const it of res.items) contentResult.set(it.contentId, 'payout' in it ? outcome(it.payout) : failure(it.error));
      selected.value = [];
    }, (e, attempted) => { batchNote.value = attempted && uncertain(e) ? { uncertain: true, text: t('campaign.payouts.uncertain') } : { uncertain: false, text: campaignErrorText(e) }; });
  } finally { busy.delete('batch'); }
}
const retry = (p: PayoutListItem) => {
  const key = `retry:${p.id}`;
  return act(key, async (tk) => { payoutResult.set(p.id, outcome(await retryPayout(tk, p.id, opFor(key)))); }, (e) => payoutResult.set(p.id, failure(e)));
};
const check = (p: PayoutListItem) => act(`check:${p.id}`, async (tk) => {
  const res = await checkPayout(tk, p.id);
  payoutResult.set(p.id, res.result === 'paid' ? outcome(res.payout) : { tone: 'neutral', text: t(`campaign.payouts.${res.result}`) });
}, (e) => payoutResult.set(p.id, failure(e)));

// ---- 取消對話框 ----
const dialogBox = ref<HTMLElement | null>(null);
let opener: HTMLElement | null = null;
const dialog = ref<{ payout: PayoutListItem; reason: string; busy: boolean; error: string } | null>(null);
const reasonLength = computed(() => [...(dialog.value?.reason.trim() ?? '')].length);
const ready = computed(() => !!dialog.value && !dialog.value.busy && reasonLength.value > 0 && reasonLength.value <= REASON_MAX);
async function openCancel(p: PayoutListItem, e: Event) {
  opener = e.currentTarget as HTMLElement | null;
  dialog.value = { payout: p, reason: '', busy: false, error: '' };
  await nextTick();
  dialogBox.value?.querySelector<HTMLElement>('textarea')?.focus();
}
async function close() {
  const id = dialog.value?.payout.id;
  dialog.value = null;
  await nextTick();
  const origin = opener;
  opener = null;
  if (origin?.isConnected) return origin.focus();
  if (id) document.querySelector<HTMLElement>(`[data-payout="${id}"] h3 a`)?.focus();
}
async function submitCancel() {
  const d = dialog.value;
  if (!d || !ready.value) return;
  const key = `cancel:${d.payout.id}`;
  d.busy = true; d.error = '';
  try {
    payoutResult.set(d.payout.id, outcome(await cancelPayout(await token(), d.payout.id, d.reason.trim(), opFor(key))));
    ops.delete(key);
    await close();
    await refresh();
  } catch (e) { d.error = campaignErrorText(e); void refresh(); } finally { d.busy = false; }
}
function onKey(e: KeyboardEvent) {
  if (!dialog.value) return;
  if (e.key === 'Escape') { if (!dialog.value.busy) void close(); return; }
  wrapTab(e, dialogBox.value);
}

// 換分段、篩選或頁碼：舊的列與結果先拿掉，免得在新資料到之前對上一頁的列動作
watch(() => [view.value, status.value, page.value], () => {
  if (access.value !== 'ok') return;
  contentResult.clear(); payoutResult.clear(); selected.value = [];
  if (view.value === 'payable') { payable.items = []; void loadPayable(); } else { history.items = []; void loadHistory(); }
});
onMounted(() => {
  document.title = pageTitle(t('moderation.tab.payouts'));
  document.addEventListener('keydown', onKey);
  void init();
});
onBeforeUnmount(() => { alive = false; document.removeEventListener('keydown', onKey); });
</script>

<template>
  <section class="rpo" :aria-label="t('moderation.tab.payouts')">
    <div v-if="access === 'loading'" class="ghost rpo-ghost" />
    <p v-else-if="access === 'denied'" class="panel rpo-empty muted">{{ t('campaign.payouts.adminOnly') }}</p>
    <p v-else-if="access === 'error'" class="notice notice--error" role="alert">{{ accessError }} <button class="btn btn--sm" @click="init">{{ t('review.refresh') }}</button></p>
    <template v-else>
      <section class="panel rpo-pool" data-pool aria-labelledby="rpo-pool-h">
        <h2 id="rpo-pool-h">{{ t('campaign.pool.title') }}</h2>
        <p v-if="poolError" class="notice notice--error">{{ poolError }}</p>
        <div v-else-if="!pool" class="ghost rpo-ghost--pool" />
        <p v-else-if="!pool.configured" class="notice">{{ t('campaign.pool.notConfigured') }}</p>
        <dl v-else class="rpo-pool__list">
          <div><dt>{{ t('campaign.pool.enabled') }}</dt><dd>{{ pool.enabled ? t('campaign.pool.on') : t('campaign.pool.off') }}</dd></div>
          <div><dt>{{ t('campaign.pool.balance') }}</dt><dd class="num">{{ num(pool.balance) }}</dd></div>
          <div><dt>{{ t('campaign.pool.maxPayout') }}</dt><dd class="num">{{ pool.maxPayout ? num(pool.maxPayout) : t('campaign.pool.noLimit') }}</dd></div>
        </dl>
      </section>

      <p v-if="reconciled" class="notice" role="status">{{ reconciled }}</p>

      <div class="rpo-bar">
        <div class="seg rpo-tabs">
          <button v-for="v in (['payable', 'history'] as const)" :key="v" type="button" class="seg__item" :class="{ 'seg__item--on': view === v }" :aria-pressed="view === v" @click="go({ view: v })">{{ t(`campaign.payouts.${v}`) }}</button>
        </div>
        <select v-if="view === 'history'" class="input rpo-filter" data-filter="status" :value="status ?? ''" :aria-label="t('campaign.payouts.statusFilter')" @change="go({ status: ($event.target as HTMLSelectElement).value })">
          <option value="">{{ t('campaign.payouts.allStatuses') }}</option>
          <option v-for="s in STATUSES" :key="s" :value="s">{{ t(`campaign.status.${s}`) }}</option>
        </select>
      </div>

      <p v-if="list.error" class="notice notice--error" role="alert">{{ list.error }} <button class="btn btn--sm" :disabled="list.loading" @click="view === 'payable' ? loadPayable() : loadHistory()">{{ t('review.refresh') }}</button></p>

      <template v-if="view === 'payable'">
        <div v-if="payable.items.length" class="rpo-batch">
          <span class="subtle">{{ t('campaign.payouts.selected', { count: picked.length, points: num(pickedPoints) }) }}<template v-if="picked.length >= BATCH_MAX"> · {{ t('campaign.payouts.limit', { n: BATCH_MAX }) }}</template></span>
          <button data-action="pay-selected" class="btn btn--sm btn--primary" :disabled="!picked.length || busy.has('batch')" @click="paySelected">{{ t('campaign.payouts.paySelected') }}</button>
        </div>
        <p v-if="batchNote" data-batch-note class="notice" :class="{ 'notice--error': !batchNote.uncertain }" :role="batchNote.uncertain ? 'status' : 'alert'">{{ batchNote.text }}</p>
        <div class="rpo-list" :aria-busy="payable.loading">
          <template v-if="payable.loading && !payable.items.length"><div v-for="n in 3" :key="n" class="ghost rpo-ghost--row" /></template>
          <p v-else-if="!payable.items.length && !payable.error" class="panel rpo-empty muted">{{ t('campaign.payouts.emptyPayable') }}</p>
          <article v-for="item in payable.items" :key="item.contentId" class="panel rpo-row" :data-content="item.contentId">
            <label class="rpo-check">
              <input type="checkbox" :checked="selected.includes(item.contentId) && batchable(item.contentId)" :aria-label="t('campaign.payouts.select', { title: item.contentTitle })"
                :disabled="!batchable(item.contentId) || busy.has('batch') || (!picked.some((i) => i.contentId === item.contentId) && picked.length >= BATCH_MAX)"
                @change="toggle(item.contentId, ($event.target as HTMLInputElement).checked)" />
            </label>
            <div class="rpo-row__main">
              <h3><RouterLink :to="lp(`/review/campaign/${item.contentId}`)">{{ item.contentTitle }}</RouterLink></h3>
              <p class="subtle rpo-line">@{{ item.applicant.handle }} · {{ titleOf(item.campaignSlug) }}</p>
              <dl class="rpo-sum">
                <div><dt>{{ t('campaign.detail.target') }}</dt><dd class="num">{{ points(item.target) }}</dd></div>
                <div><dt>{{ t('campaign.mine.paid') }}</dt><dd class="num">{{ points(item.paidTotal) }}</dd></div>
                <div><dt>{{ t('campaign.detail.due') }}</dt><dd class="num">{{ points(item.due) }}</dd></div>
              </dl>
              <p class="rpo-line rpo-result" :class="toneClass(contentResult.get(item.contentId))" aria-live="polite">{{ contentResult.get(item.contentId)?.text }}</p>
              <p v-if="gone.has(item.contentId)" class="subtle rpo-line">{{ t('campaign.payouts.seeHistory') }}</p>
            </div>
            <div class="rpo-actions">
              <button data-action="pay" class="btn btn--sm" :disabled="!payable1(item.contentId) || busy.has(`pay:${item.contentId}`) || busy.has('batch')" @click="payOne(item)">{{ t('campaign.payouts.pay') }}</button>
            </div>
          </article>
        </div>
      </template>

      <div v-else class="rpo-list" :aria-busy="history.loading">
        <template v-if="history.loading && !history.items.length"><div v-for="n in 3" :key="n" class="ghost rpo-ghost--row" /></template>
        <p v-else-if="!history.items.length && !history.error" class="panel rpo-empty muted">{{ t('campaign.payouts.emptyHistory') }}</p>
        <article v-for="p in history.items" :key="p.id" class="panel rpo-row" :data-payout="p.id">
          <div class="rpo-row__main">
            <div class="rpo-row__head">
              <h3><RouterLink :to="lp(`/review/campaign/${p.contentId}`)">{{ p.contentTitle }}</RouterLink></h3>
              <span class="chip">{{ t(`campaign.status.${p.status}`) }}</span>
            </div>
            <p class="subtle rpo-line">@{{ p.applicant.handle }} · {{ titleOf(p.campaignSlug) }} · <time>{{ at(p.settledAt ?? p.createdAt, p.campaignSlug) }}</time></p>
            <p class="rpo-line"><span class="num">{{ points(p.amount) }}</span> · <span class="subtle">{{ t('campaign.payouts.attempts', { n: p.attempts }, p.attempts) }}</span></p>
            <p v-if="p.error" class="rpo-line" :class="p.status === 'pending' ? 'rpo-result--neutral' : 'rpo-result--bad'">{{ campaignErrorText(p.error) }}</p>
            <p v-if="p.status === 'failed'" class="subtle rpo-line">{{ t('campaign.payouts.payAgain') }}</p>
            <p class="rpo-line rpo-result" :class="toneClass(payoutResult.get(p.id))" aria-live="polite">{{ payoutResult.get(p.id)?.text }}</p>
          </div>
          <div class="rpo-actions">
            <button v-if="p.status === 'blocked_insufficient'" data-action="retry" class="btn btn--sm btn--primary" :disabled="busy.has(`retry:${p.id}`)" @click="retry(p)">{{ t('campaign.payouts.retry') }}</button>
            <button v-if="p.status === 'pending'" data-action="check" class="btn btn--sm" :disabled="busy.has(`check:${p.id}`)" @click="check(p)">{{ t('campaign.payouts.check') }}</button>
            <button v-if="canCancel(p)" data-action="cancel" class="btn btn--sm btn--danger" @click="openCancel(p, $event)">{{ t('campaign.payouts.cancel') }}</button>
          </div>
        </article>
      </div>

      <div v-if="page > 1 || hasNext" class="rpo-pager">
        <button class="btn btn--sm" :disabled="page === 1 || list.loading" @click="go({ page: page - 1 })">{{ t('moderation.previous') }}</button>
        <button class="btn btn--sm" :disabled="!hasNext || list.loading" @click="go({ page: page + 1 })">{{ t('moderation.next') }}</button>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="dialog" class="modal-backdrop" @click.self="!dialog.busy && close()">
        <form ref="dialogBox" class="modal panel rpo-dialog" role="dialog" aria-modal="true" aria-labelledby="rpo-dialog-title" @submit.prevent="submitCancel">
          <h2 id="rpo-dialog-title" class="modal__title">{{ t('campaign.payouts.cancel') }}</h2>
          <p class="subtle rpo-line">{{ dialog.payout.contentTitle }} · {{ points(dialog.payout.amount) }}</p>
          <label class="rpo-field">
            <span class="subtle">{{ t('campaign.payouts.reason') }}</span>
            <textarea v-model="dialog.reason" class="input" rows="4" :disabled="dialog.busy" aria-describedby="rpo-reason-hint" />
            <span id="rpo-reason-hint" class="rpo-field__foot subtle">
              <span>{{ t('campaign.payouts.reasonKept') }}</span>
              <span class="num" :class="{ 'rpo-over': reasonLength > REASON_MAX }">{{ reasonLength }}/{{ REASON_MAX }}</span>
            </span>
          </label>
          <p v-if="dialog.error" class="notice notice--error" role="alert">{{ dialog.error }}</p>
          <div class="modal__actions">
            <button type="button" class="btn" :disabled="dialog.busy" @click="close">{{ t('campaign.payouts.keep') }}</button>
            <button type="submit" class="btn btn--danger-solid" :disabled="!ready">{{ t('campaign.payouts.cancel') }}</button>
          </div>
        </form>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.rpo { display: grid; gap: var(--s-4); min-width: 0; }
.rpo-ghost { height: 160px; }
.rpo-ghost--pool { height: 48px; }
.rpo-ghost--row { height: 120px; }
.rpo-empty { padding: var(--s-5); margin: 0; }
.rpo-pool { padding: var(--s-4) var(--s-5); display: grid; gap: var(--s-3); }
.rpo-pool h2 { margin: 0; font-size: 15px; }
.rpo-pool__list { display: flex; flex-wrap: wrap; gap: var(--s-3) var(--s-6); margin: 0; }
.rpo-pool__list dt, .rpo-sum dt { color: var(--text-2); font-size: 13px; }
.rpo-pool__list dd, .rpo-sum dd { margin: 0; font-weight: 700; }
.rpo-bar { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between; }
.rpo-tabs { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.rpo-filter { width: auto; min-width: 160px; max-width: 100%; }
.rpo-batch { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between; }
.rpo-list { display: grid; gap: var(--s-3); }
.rpo-row { padding: var(--s-4); display: flex; gap: var(--s-3); align-items: flex-start; min-width: 0; overflow-wrap: anywhere; }
.rpo-row__main { flex: 1; min-width: 0; display: grid; gap: var(--s-2); }
.rpo-row__head { display: flex; justify-content: space-between; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
.rpo-row h3 { margin: 0; font-size: 16px; min-width: 0; }
.rpo-row h3 a:hover { color: var(--accent-text); }
.rpo-row .chip { cursor: default; }
.rpo-check { display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; margin: calc(-1 * var(--s-2)) 0 0 calc(-1 * var(--s-2)); cursor: pointer; }
.rpo-line { margin: 0; }
.rpo-sum { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-3); margin: 0; }
.rpo-result:empty { display: none; }
.rpo-result, .rpo-result--bad, .rpo-result--neutral { font-size: 14px; }
.rpo-result--ok { color: var(--success); }
.rpo-result--bad { color: var(--danger); }
.rpo-result--neutral { color: var(--text-2); }
.rpo-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); justify-content: flex-end; }
.rpo-actions:empty { display: none; }
.rpo-pager { display: flex; gap: var(--s-2); justify-content: center; }
.rpo-dialog { display: grid; gap: var(--s-3); }
.rpo-field { display: grid; gap: 6px; }
.rpo-field__foot { display: flex; justify-content: space-between; gap: var(--s-2); font-size: 12px; }
.rpo-over { color: var(--danger); }
@media (max-width: 760px) {
  .rpo-pool { padding: var(--s-4); }
  .rpo-row { flex-wrap: wrap; }
  .rpo-row[data-payout] .rpo-actions, .rpo-row[data-content] .rpo-actions { flex-basis: 100%; }
  .rpo-actions .btn, .rpo-batch .btn, .rpo-pager .btn, .rpo-filter, .rpo-tabs .seg__item { min-height: 44px; }
  .rpo-actions .btn { flex: 1; }
  .rpo-filter { flex: 1; }
  .rpo-sum { grid-template-columns: minmax(0, 1fr); gap: var(--s-1); }
}
</style>
