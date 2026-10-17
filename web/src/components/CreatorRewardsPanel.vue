<script setup lang="ts">
/**
 * 發放分頁裡的「創作季待發放」：活動期間送審、已經過審、還沒發放的卡（上線前已過審的補發，和過審當下沒發成的）。
 * 一次發這一頁（服務端一頁 20 筆，也是批次上限），發之前確認筆數與總積分；每筆結果留在那一列。
 * 下面列出沒完成的發放（排隊中、處理中），可以重試：同一把 key、同一個金額，服務端不會發兩次。
 * 只在發放分頁通過管理員檢查後才掛上；服務端每次都再判。
 */
import { onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  batchReward, campaignErrorText, fetchRewardDue, fetchRewardList, formatNumber, retryReward,
  type RewardDueItem, type RewardListItem,
} from "@/lib/campaign";
import { confirmDialog } from "@/lib/confirm";
import { useSession } from "@/lib/session";

const { t, te, locale } = useI18n();
const session = useSession();

const due = reactive({ items: [] as RewardDueItem[], total: 0, loading: true, error: "" });
const open = ref<RewardListItem[]>([]);
/** 這次批次每張卡的結果（cardId → 已入帳／錯誤代碼） */
const results = ref<Record<number, string>>({});
const busy = ref(false);
/** 上一次批次的總結（已入帳幾筆、失敗幾筆） */
const done = ref("");
/** 服務端的代碼轉成看得懂的話；不認得的照原樣 */
const errorLabel = (code: string) => { const k = `review.creator.error.${code}`; return te(k) ? t(k) : code; };
/** 失敗重按沿用同一個操作編號（服務端認成同一次），成功就丟掉 */
let batchOp: { key: string; id: string } | null = null;

async function token() {
  const v = await session.accessToken();
  if (!v) throw new Error(t("auth.expired"));
  return v;
}
async function load() {
  due.loading = true;
  due.error = "";
  try {
    const tk = await token();
    const [d, pending, queued] = await Promise.all([fetchRewardDue(tk), fetchRewardList(tk, { status: "pending" }), fetchRewardList(tk, { status: "blocked_insufficient" })]);
    due.items = d.items;
    due.total = d.total;
    open.value = [...queued.items, ...pending.items];
  } catch (e) {
    due.error = campaignErrorText(e);
  } finally {
    due.loading = false;
  }
}
onMounted(load);

const date = (ms: number) => new Intl.DateTimeFormat(locale.value, { timeZone: "Asia/Taipei", month: "short", day: "numeric" }).format(ms);

async function payPage() {
  const items = due.items;
  if (!items.length || busy.value) return;
  const points = items.reduce((n, i) => n + i.amount, 0);
  if (!(await confirmDialog({ message: t("review.creator.confirm", { count: items.length, points: formatNumber(points) }), confirmText: t("campaign.payouts.pay") }))) return;
  const ids = items.map((i) => i.cardId);
  const key = ids.join(",");
  if (batchOp?.key !== key) batchOp = { key, id: crypto.randomUUID() };
  busy.value = true;
  try {
    const res = await batchReward(await token(), ids, batchOp.id);
    batchOp = null;
    // 已入帳的會從待發放消失，所以先留一行總結；沒發成的列還在，結果標在那一列
    const paid = res.items.filter((r) => "reward" in r && r.reward.status === "paid").length;
    const queued = res.items.filter((r) => "reward" in r && r.reward.status !== "paid").length;
    done.value = t("review.creator.done", { paid, queued, failed: res.items.length - paid - queued });
    for (const r of res.items) results.value[r.cardId] = "reward" in r ? (r.reward.status === "paid" ? t("campaign.payout.paid") : t(`review.creator.status.${r.reward.status}`)) : t("review.creator.failed", { error: errorLabel(r.error) });
  } catch (e) {
    due.error = campaignErrorText(e);
  } finally {
    busy.value = false;
  }
  await load();
}

const retryOps = new Map<string, string>();
async function retry(r: RewardListItem) {
  if (busy.value) return;
  const op = retryOps.get(r.id) ?? crypto.randomUUID();
  retryOps.set(r.id, op);
  busy.value = true;
  try {
    await retryReward(await token(), r.id, op);
    retryOps.delete(r.id);
  } catch (e) {
    due.error = campaignErrorText(e);
  } finally {
    busy.value = false;
  }
  await load();
}
</script>

<template>
  <section class="panel crp" data-creator-rewards aria-labelledby="crp-h">
    <div class="crp__head">
      <div>
        <h2 id="crp-h" class="crp__h2">{{ t("review.creator.title") }}</h2>
        <p class="crp__cap">{{ t("review.creator.lead") }}</p>
      </div>
      <button type="button" class="btn btn--primary" data-pay-page :disabled="busy || !due.items.length" @click="payPage">
        {{ t("review.creator.payPage", { n: due.items.length }) }}
      </button>
    </div>
    <p v-if="done" class="notice" role="status" data-batch-done>{{ done }}</p>
    <p v-if="due.error" class="notice notice--error" role="alert">{{ due.error }}</p>
    <div v-if="due.loading && !due.items.length" class="ghost crp__ghost" aria-hidden="true" />
    <p v-else-if="!due.items.length" class="crp__cap">{{ t("review.creator.empty") }}</p>
    <ul v-else class="crp__list">
      <li v-for="i in due.items" :key="i.cardId" :data-due="i.cardId">
        <span class="crp__name">{{ i.cardName || `#${i.cardId}` }}</span>
        <span class="crp__meta num">@{{ i.author.handle }} · {{ date(i.registeredAt) }}</span>
        <span class="crp__amount num">{{ formatNumber(i.amount) }}</span>
        <span v-if="results[i.cardId]" class="crp__result">{{ results[i.cardId] }}</span>
      </li>
    </ul>
    <p v-if="due.total > due.items.length" class="crp__cap">{{ t("review.creator.more", { n: due.total - due.items.length }) }}</p>

    <template v-if="open.length">
      <h3 class="crp__h3">{{ t("review.creator.open") }}</h3>
      <ul class="crp__list">
        <li v-for="r in open" :key="r.id" :data-open="r.id">
          <span class="crp__name">{{ r.cardName || `#${r.cardId}` }}</span>
          <span class="crp__meta num">@{{ r.author.handle }} · {{ t(`review.creator.status.${r.status}`) }}</span>
          <span class="crp__amount num">{{ formatNumber(r.amount) }}</span>
          <button type="button" class="btn btn--sm" :disabled="busy" @click="retry(r)">{{ t("campaign.payouts.retry") }}</button>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.crp { display: grid; gap: var(--s-3); padding: var(--s-5); }
.crp__head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--s-3); }
.crp__h2 { margin: 0; font-size: 18px; font-weight: 650; }
.crp__h3 { margin: var(--s-2) 0 0; font-size: 15px; font-weight: 650; }
.crp__cap { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-2); }
.crp__ghost { height: 120px; border-radius: var(--r-md); }
.crp__list { list-style: none; margin: 0; padding: 0; display: grid; }
.crp__list li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1) var(--s-3); min-height: 44px; padding: var(--s-2) 0; font-size: 14px; }
.crp__list li + li { border-top: 1px solid var(--line); }
.crp__name { flex: 1; min-width: 120px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crp__meta { font-size: 12.5px; color: var(--text-3); }
.crp__amount { font-weight: 700; }
.crp__result { flex-basis: 100%; font-size: 12.5px; color: var(--text-2); }
</style>
