<script setup lang="ts">
/**
 * 分享申請的內容詳情 /review/campaign/:id：一份內容的所有位置、截圖、重複明細、應發與已入帳、發放紀錄、同一人在本活動的其他內容。
 *
 * 決定都在同一個對話框裡做：通過（檔位預設上次核准、沒有就是申請的檔位；「算一個有效位置」預設照目前的值）、退回補件、不通過
 * （後兩個要理由，最多 500 字，以字元計，跟服務端一樣）。已通過的位置只能「調整檔位」：同一個對話框，只開放檔位與有效位置。
 * 每開一次對話框配一個 operationId，送失敗重按沿用；每次決定帶這個位置讀到的版本號，別人先處理過會回 share_version_conflict，
 * 這時（或回 share_already_decided）關掉對話框、說一聲並重新載入，不自動覆蓋。補件截止（活動設定的 submitDeadline）之後不出現「退回補件」。
 * AI 審核帳號也能做決定（服務端允許）；真人應用管理員通過時服務端會一併發放，畫面依 canEdit 說明通過之後誰發獎勵。
 * 申請人只以 handle 出現：畫面上不放成員 id 或收款帳號。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import EvidenceViewer from '@/components/EvidenceViewer.vue';
import {
  DEFAULT_TIMEZONE, TIERS, campaignErrorText, decide, fetchCampaigns, fetchContentDetail, isWebUrl, localized,
  type Campaign, type ContentDetail, type DecisionBody, type DecisionResult, type Flags, type Tier,
} from '@/lib/campaign';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useReviewer } from '@/lib/review';
import { useLocalePath } from '@/lib/use-locale';
import { pageTitle } from '@/lib/i18n';
import { wrapTab } from '@/lib/focus-trap';

type Placement = ContentDetail['placements'][number];
type Kind = 'approve' | 'needs_info' | 'reject';

const { t } = useI18n();
const session = useSession();
const reviewer = useReviewer();
const route = useRoute();
const { lp, locale } = useLocalePath();

/** 服務端的理由上限（campaign-review.ts），以字元計 */
const REASON_MAX = 500;
const FLAGS = ['duplicateLocation', 'duplicateImage', 'burst'] as const satisfies readonly (keyof Flags)[];
const KIND_KEY: Record<Kind, string> = { approve: 'approve', needs_info: 'needsInfo', reject: 'reject' };

const id = computed(() => String(route.params.id ?? ''));
const data = ref<ContentDetail | null>(null);
const campaigns = ref<{ items: Campaign[]; canEdit: boolean } | null>(null);
const loading = ref(true);
const error = ref('');
const conflict = ref('');
const done = ref('');
/** 這次看的時候服務端說補件截止了（畫面上的時間可能還沒到） */
const closed = ref(false);
let generation = 0, alive = true;

async function token() {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}
/** 活動列表只讀一次：補件截止、時區、名稱與 canEdit 都從這裡來。讀不到就當不知道，補件截止交給服務端把關。 */
let campaignsOnce: Promise<void> | null = null;
const loadCampaigns = () => (campaignsOnce ??= token().then(fetchCampaigns).then((r) => { campaigns.value = r; }, () => {}));
async function load() {
  const gen = ++generation;
  loading.value = true; error.value = '';
  try {
    const [detail] = await Promise.all([fetchContentDetail(await token(), id.value), loadCampaigns()]);
    if (!alive || gen !== generation) return;
    data.value = detail;
    document.title = pageTitle(detail.content.title);
  } catch (e) { if (gen === generation) error.value = campaignErrorText(e); } finally { if (gen === generation) loading.value = false; }
}

const campaign = computed(() => campaigns.value?.items.find((c) => c.slug === data.value?.content.campaignSlug) ?? null);
const canEdit = computed(() => campaigns.value?.canEdit ?? false);
const pastDeadline = computed(() => closed.value || (campaign.value?.submitDeadline != null && Date.now() >= campaign.value.submitDeadline));
const campaignTitle = computed(() => (campaign.value ? localized(campaign.value.title, locale.value) : '') || data.value?.content.campaignSlug || '');
/** 用活動自己的時區顯示；活動讀不到時用看的人的時區，時刻本身還是對的 */
const at = (ms: number) => new Intl.DateTimeFormat(locale.value, { timeZone: campaign.value ? campaign.value.timezone || DEFAULT_TIMEZONE : undefined, dateStyle: 'medium', timeStyle: 'short' }).format(ms);
const points = (n: number) => t('campaign.page.points', { n });
const indexOf = (placementId: string) => (data.value?.placements.findIndex((p) => p.id === placementId) ?? -1) + 1;
const actionsOf = (p: Placement): Kind[] | 'regrade' => {
  if (p.reviewStatus === 'approved') return 'regrade';
  if (p.reviewStatus === 'rejected') return [];
  if (p.reviewStatus === 'needs_info' || pastDeadline.value) return ['approve', 'reject'];
  return ['approve', 'needs_info', 'reject'];
};
/** 檔位選單：活動有設定金額的檔，加上這次的預設值（設定改過也不會選不到原本的） */
const tierOptions = (current: Tier) => TIERS.filter((x) => x === current || !campaign.value || campaign.value.tiers[x] != null);
const tierLabel = (x: Tier) => {
  const n = campaign.value?.tiers[x];
  return n != null ? `${t(`campaign.tier.${x}`)} · ${points(n)}` : t(`campaign.tier.${x}`);
};

// ---- 決定對話框 ----
const dialogBox = ref<HTMLElement | null>(null);
/** 打開對話框的那顆鍵：怎麼關焦點都還給它；它不在了（例如通過之後換成「調整檔位」）就落到那個位置的標題 */
let opener: HTMLElement | null = null;
const dialog = ref<{ kind: Kind; regrade: boolean; placement: Placement; tier: Tier; counts: boolean; reason: string; operationId: string; busy: boolean; error: string } | null>(null);
const reasonLength = computed(() => [...(dialog.value?.reason.trim() ?? '')].length);
const ready = computed(() => {
  const d = dialog.value;
  if (!d || d.busy) return false;
  return d.kind === 'approve' || (reasonLength.value > 0 && reasonLength.value <= REASON_MAX);
});
const dialogTitle = computed(() => (!dialog.value ? '' : dialog.value.regrade ? t('campaign.decide.regrade') : t(`campaign.decide.${KIND_KEY[dialog.value.kind]}`)));

async function open(kind: Kind, p: Placement, e: Event) {
  done.value = ''; conflict.value = '';
  // 從點擊本身拿：macOS 的 Safari、Firefox 用滑鼠點按鈕不會讓它取得焦點
  opener = e.currentTarget as HTMLElement | null;
  dialog.value = { kind, regrade: p.reviewStatus === 'approved', placement: p, tier: p.approvedTier ?? p.requestedTier, counts: p.countsAsPlacement, reason: '', operationId: crypto.randomUUID(), busy: false, error: '' };
  await nextTick();
  dialogBox.value?.querySelector<HTMLElement>('textarea, select')?.focus();
}
async function close() {
  const placementId = dialog.value?.placement.id;
  dialog.value = null;
  await refocus(placementId);
}
async function refocus(placementId?: string) {
  await nextTick();
  const origin = opener;
  opener = null;
  if (origin?.isConnected) return origin.focus();
  if (placementId) document.querySelector<HTMLElement>(`[data-placement="${placementId}"] h3`)?.focus();
}
/** 通過時順便發放的結果：只在有值時多說一句 */
function payoutNote(res: DecisionResult): string {
  if (res.payoutError) return campaignErrorText(res.payoutError);
  switch (res.payout?.status) {
    case 'paid': return t('campaign.decide.paid');
    case 'blocked_insufficient': return t('campaign.decide.queued');
    case 'pending': return t('campaign.decide.processing');
    case 'failed': return t('campaign.decide.failed');
    default: return '';
  }
}
async function submit() {
  const d = dialog.value;
  if (!d || !ready.value) return;
  d.busy = true; d.error = '';
  const body: DecisionBody = d.kind === 'approve'
    ? { decision: 'approve', tier: d.tier, countsAsPlacement: d.counts, expectedVersion: d.placement.version, operationId: d.operationId }
    : { decision: d.kind, reason: d.reason.trim(), expectedVersion: d.placement.version, operationId: d.operationId };
  try {
    const res = await decide(await token(), d.placement.id, body);
    done.value = [t('campaign.decide.done'), payoutNote(res)].filter(Boolean).join(' · ');
    dialog.value = null;
    await load();
    await reviewer.refresh();
    await refocus(d.placement.id);
  } catch (e) {
    const code = e instanceof ApiError ? e.code : '';
    if (code === 'share_version_conflict' || code === 'share_already_decided') {
      // 別人先處理了：不在舊資料上重送，關掉、說一聲、讀最新的
      conflict.value = campaignErrorText(e);
      dialog.value = null;
      await load();
      await refocus(d.placement.id);
      return;
    }
    if (code === 'campaign_submit_closed') closed.value = true;
    d.error = campaignErrorText(e);
  } finally { d.busy = false; }
}
function onKey(e: KeyboardEvent) {
  if (!dialog.value) return;
  if (e.key === 'Escape') { if (!dialog.value.busy) void close(); return; }
  wrapTab(e, dialogBox.value);
}

watch(id, () => { done.value = ''; conflict.value = ''; closed.value = false; data.value = null; void load(); });
onMounted(() => {
  document.title = pageTitle(t('moderation.tab.campaign'));
  document.addEventListener('keydown', onKey);
  void load();
});
onBeforeUnmount(() => { alive = false; document.removeEventListener('keydown', onKey); });
</script>

<template>
  <section class="rcd" :aria-label="t('moderation.tab.campaign')">
    <RouterLink class="rcd-back subtle" :to="lp('/review/campaign')">← {{ t('campaign.detail.back') }}</RouterLink>

    <p v-if="conflict" class="notice notice--error" role="alert">{{ conflict }}</p>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }} <button class="btn btn--sm" :disabled="loading" @click="load">{{ t('review.refresh') }}</button></p>
    <p v-if="done" class="notice" role="status">{{ done }}</p>

    <template v-if="!data && loading"><div class="ghost rcd-ghost--head" /><div v-for="n in 2" :key="n" class="ghost rcd-ghost" /></template>

    <div v-if="data" class="rcd-body" :aria-busy="loading">
      <header class="panel rcd-head">
        <p class="eyebrow">{{ campaignTitle }}</p>
        <h2 class="rcd-head__title">{{ data.content.title }}</h2>
        <dl class="rcd-facts">
          <div><dt>{{ t('campaign.detail.applicant') }}</dt><dd><RouterLink :to="lp(`/review/members/${encodeURIComponent(data.content.applicant.handle)}`)">@{{ data.content.applicant.handle }}</RouterLink></dd></div>
          <div><dt>{{ t('campaign.detail.submittedAt') }}</dt><dd>{{ at(data.content.createdAt) }}</dd></div>
          <div v-if="data.content.cardId !== null"><dt>{{ t('campaign.share.field.cardId') }}</dt><dd><RouterLink :to="lp(`/cards/${data.content.cardId}`)">#{{ data.content.cardId }}</RouterLink></dd></div>
        </dl>
        <dl class="rcd-sum">
          <div><dt>{{ t('campaign.detail.target') }}</dt><dd class="num">{{ points(data.payout.target) }}</dd></div>
          <div><dt>{{ t('campaign.mine.paid') }}</dt><dd class="num">{{ points(data.paidTotal) }}</dd></div>
          <div><dt>{{ t('campaign.detail.due') }}</dt><dd class="num">{{ points(data.payout.due) }}</dd></div>
        </dl>
      </header>

      <article v-for="(p, i) in data.placements" :key="p.id" class="panel rcd-place" :data-placement="p.id">
        <div class="rcd-place__head">
          <h3 tabindex="-1">{{ t('campaign.detail.placement', { n: i + 1 }) }} · {{ t(`campaign.platform.${p.platform}`) }} · {{ p.location }}</h3>
          <span class="chip">{{ t(`campaign.review.${p.reviewStatus}`) }}</span>
        </div>
        <dl class="rcd-facts">
          <div v-if="p.url"><dt>{{ t('campaign.share.field.url') }}</dt><dd><a v-if="isWebUrl(p.url)" :href="p.url" target="_blank" rel="noopener noreferrer">{{ p.url }}</a><span v-else>{{ p.url }}</span></dd></div>
          <div><dt>{{ t('campaign.share.field.publishedAt') }}</dt><dd>{{ at(p.publishedAt) }}</dd></div>
          <div><dt>{{ t('campaign.share.field.requestedTier') }}</dt><dd>{{ t(`campaign.tier.${p.requestedTier}`) }}</dd></div>
          <div v-if="p.approvedTier"><dt>{{ t('campaign.share.field.tier') }}</dt><dd>{{ t(`campaign.tier.${p.approvedTier}`) }}<template v-if="!p.countsAsPlacement"> · {{ t('campaign.detail.notCounted') }}</template></dd></div>
          <div v-if="p.note"><dt>{{ t('campaign.share.field.note') }}</dt><dd class="rcd-text">{{ p.note }}</dd></div>
        </dl>
        <EvidenceViewer v-if="p.evidence.length" :items="p.evidence" :token="token" />
        <p v-else class="subtle rcd-line">{{ t('campaign.detail.noShots') }}</p>

        <div v-if="FLAGS.some((f) => p.flags[f])" class="rcd-flags">
          <template v-for="f in FLAGS" :key="f"><span v-if="p.flags[f]" class="chip rcd-chip--warn">{{ t(`campaign.flag.${f}`) }}</span></template>
        </div>
        <p v-for="other in p.duplicates.location" :key="other" class="subtle rcd-line">{{ t('campaign.detail.sameLocation', { n: indexOf(other) }) }}</p>
        <p v-if="p.duplicates.image.length" class="subtle rcd-line">
          {{ t('campaign.detail.sameImage') }}
          <template v-for="(d, k) in p.duplicates.image" :key="d.contentId"><template v-if="k"> · </template><RouterLink :to="lp(`/review/campaign/${d.contentId}`)">@{{ d.handle }}</RouterLink></template>
        </p>
        <p v-if="p.reviewReason" class="notice rcd-text"><span class="subtle">{{ t('campaign.detail.lastReason') }}</span> {{ p.reviewReason }}</p>

        <div class="rcd-place__actions">
          <button v-if="actionsOf(p) === 'regrade'" data-action="regrade" class="btn btn--sm" @click="open('approve', p, $event)">{{ t('campaign.decide.regrade') }}</button>
          <template v-else>
            <button v-for="k in (actionsOf(p) as Kind[])" :key="k" :data-action="k" class="btn btn--sm" :class="{ 'btn--primary': k === 'approve', 'btn--danger': k === 'reject' }" @click="open(k, p, $event)">{{ t(`campaign.decide.${KIND_KEY[k]}`) }}</button>
          </template>
        </div>
      </article>

      <section v-if="data.payouts.length" class="panel rcd-list" aria-labelledby="rcd-payouts">
        <h3 id="rcd-payouts">{{ t('campaign.detail.payouts') }}</h3>
        <ul>
          <li v-for="x in data.payouts" :key="x.id"><span class="num">{{ points(x.amount) }}</span><span class="chip">{{ t(`campaign.status.${x.status}`) }}</span><time class="subtle">{{ at(x.settledAt ?? x.createdAt) }}</time></li>
        </ul>
      </section>
      <section v-if="data.history.length" class="panel rcd-list" aria-labelledby="rcd-history">
        <h3 id="rcd-history">{{ t('campaign.detail.history') }}</h3>
        <ul>
          <li v-for="h in data.history" :key="h.id"><RouterLink :to="lp(`/review/campaign/${h.id}`)">{{ h.title }}</RouterLink><span class="subtle">{{ t('campaign.mine.paid') }} {{ points(h.paidTotal) }}</span><time class="subtle">{{ at(h.createdAt) }}</time></li>
        </ul>
      </section>
    </div>

    <Teleport to="body">
      <div v-if="dialog" class="modal-backdrop" @click.self="!dialog.busy && close()">
        <form ref="dialogBox" class="modal panel rcd-dialog" role="dialog" aria-modal="true" aria-labelledby="rcd-dialog-title" @submit.prevent="submit">
          <h2 id="rcd-dialog-title" class="modal__title">{{ dialogTitle }}</h2>
          <p class="subtle rcd-line">{{ t(`campaign.platform.${dialog.placement.platform}`) }} · {{ dialog.placement.location }}</p>
          <template v-if="dialog.kind === 'approve'">
            <label class="rcd-field">
              <span class="subtle">{{ t('campaign.share.field.tier') }}</span>
              <select v-model="dialog.tier" class="input" :disabled="dialog.busy">
                <option v-for="x in tierOptions(dialog.placement.approvedTier ?? dialog.placement.requestedTier)" :key="x" :value="x">{{ tierLabel(x) }}</option>
              </select>
            </label>
            <label class="rcd-check"><input v-model="dialog.counts" type="checkbox" :disabled="dialog.busy" /> {{ t('campaign.decide.counts') }}</label>
            <p class="subtle rcd-line">{{ t(canEdit ? 'campaign.decide.payNow' : 'campaign.decide.payLater') }}</p>
          </template>
          <label v-else class="rcd-field">
            <span class="subtle">{{ t('campaign.decide.reason') }}</span>
            <textarea v-model="dialog.reason" class="input" rows="4" :disabled="dialog.busy" aria-describedby="rcd-reason-hint" />
            <span id="rcd-reason-hint" class="rcd-field__foot subtle">
              <span>{{ t('campaign.decide.reasonShown') }}</span>
              <span class="num" :class="{ 'rcd-over': reasonLength > REASON_MAX }">{{ reasonLength }}/{{ REASON_MAX }}</span>
            </span>
          </label>
          <p v-if="dialog.error" class="notice notice--error" role="alert">{{ dialog.error }}</p>
          <div class="modal__actions">
            <button type="button" class="btn" :disabled="dialog.busy" @click="close">{{ t('dialog.cancel') }}</button>
            <button type="submit" class="btn" :class="dialog.kind === 'reject' ? 'btn--danger-solid' : 'btn--primary'" :disabled="!ready">{{ dialogTitle }}</button>
          </div>
        </form>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.rcd { display: grid; gap: var(--s-4); min-width: 0; }
.rcd-back { justify-self: start; font-size: 14px; }
.rcd-back:hover { color: var(--accent-text); }
.rcd-ghost--head { height: 180px; }
.rcd-ghost { height: 240px; }
.rcd-body { display: grid; gap: var(--s-4); min-width: 0; }
.rcd-head, .rcd-place, .rcd-list { padding: var(--s-4) var(--s-5); display: grid; gap: var(--s-3); min-width: 0; overflow-wrap: anywhere; }
.rcd-head .eyebrow { margin: 0; }
.rcd-head__title { margin: 0; font-size: 20px; }
.rcd-facts { display: grid; gap: var(--s-2); margin: 0; }
.rcd-facts > div { display: grid; grid-template-columns: 128px minmax(0, 1fr); gap: var(--s-3); }
.rcd-facts dt { color: var(--text-2); font-size: 13px; }
.rcd-facts dd { margin: 0; min-width: 0; }
.rcd-facts a, .rcd-line a, .rcd-list a { color: var(--accent-text); }
.rcd-sum { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-3); margin: 0; padding-top: var(--s-3); border-top: 1px solid var(--line); }
.rcd-sum dt { color: var(--text-2); font-size: 13px; }
.rcd-sum dd { margin: 0; font-size: 17px; font-weight: 700; }
.rcd-place__head { display: flex; justify-content: space-between; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
.rcd-place__head h3 { margin: 0; font-size: 16px; min-width: 0; }
.rcd-place__head h3:focus { outline: none; }
.rcd-place .chip, .rcd-list .chip { cursor: default; }
.rcd-text { white-space: pre-wrap; }
.rcd-line { margin: 0; }
.rcd-flags { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.rcd-chip--warn { background: var(--gold-soft); color: var(--warning-text); }
.rcd-place__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.rcd-place__actions:empty { display: none; }
.rcd-list h3 { margin: 0; font-size: 16px; }
.rcd-list ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.rcd-list li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }
.rcd-dialog { display: grid; gap: var(--s-3); }
.rcd-field { display: grid; gap: 6px; }
.rcd-field__foot { display: flex; justify-content: space-between; gap: var(--s-2); font-size: 12px; }
.rcd-over { color: var(--danger); }
.rcd-check { display: flex; align-items: center; gap: var(--s-2); min-height: 44px; }
@media (max-width: 760px) {
  .rcd-head, .rcd-place, .rcd-list { padding: var(--s-4); }
  .rcd-facts > div { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .rcd-sum { grid-template-columns: minmax(0, 1fr); }
  .rcd-place__actions .btn { flex: 1; min-height: 44px; }
  .rcd-dialog select.input { min-height: 44px; }
}
</style>
