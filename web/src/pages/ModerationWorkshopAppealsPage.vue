<script setup lang="ts">
/**
 * 工作台「擴充申訴」（ui.md §3.9 ②）：製作者申訴原作者的退回／隱藏，站方決定維持、恢復或直接撤下。
 *
 *   分段「待處理 N｜已處理」→ 每筆一個面板：橫圖、擴充名、為《原卡》・製作者・原作者、原作者處理 chip＋時間
 *   → 兩段理由原文（原作者灰線、製作者 accent 線）→ 動作列（維持原處理、恢復｜靠右站方撤下）。
 *
 * - 已處理的沒有動作，改顯示結果 chip。案件與自己有關（伺服器帶 viewerRelation）時整排動作換成一句說明。
 * - 三個動作都要理由（confirmForm 必填）。送出失敗時保留同一份內容與 operationId，重試照原樣再送，
 *   伺服器才認得出是同一次處理；重新開確認框才算新的一次。
 * - 分頁只給 manager／owner；直接打網址的其他人看到伺服器的 403，畫面寫一句說明。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ExtensionCover from '@/components/workshop/ExtensionCover.vue';
import UndoToast from '@/components/workshop/UndoToast.vue';
import { ApiError } from '@/lib/api';
import { confirmForm, confirmState, settleConfirm } from '@/lib/confirm';
import { displayName } from '@/lib/display-name';
import { relativeTime } from '@/lib/format';
import { pageTitle } from '@/lib/i18n';
import { currentProvider } from '@/lib/provider';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import {
  appealCount, askRevokeReason, decideWorkshopAppeal, fetchWorkshopAppeals, refreshAppealCount, revokeWorkshop,
  type AppealDecision, type WorkshopAppeal,
} from '@/lib/workshop-moderation';

const { t, locale } = useI18n();
const session = useSession();
const { lp } = useLocalePath();

type Status = 'pending' | 'decided';
/** 端點沒說一頁幾筆；照工作台其他清單一頁 30 筆換頁 */
const PAGE = 30;
const status = ref<Status>('pending');
const offset = ref(0);
const items = ref<WorkshopAppeal[]>([]);
const hasNext = ref(false);
const loading = ref(true);
const loadError = ref('');
const forbidden = ref(false);
const busy = ref(false);
/** 送出失敗的那一次：同一份內容與 operationId，給「重試」原樣再送 */
type Attempt = { kind: 'decision'; appealId: string; body: { decision: AppealDecision; reason: string; operationId: string } }
  | { kind: 'revoke'; workshopId: string; body: { reason: string; operationId: string } };
const failed = ref<Attempt | null>(null);
const toast = ref<InstanceType<typeof UndoToast> | null>(null);

const identity = () => `${currentProvider()}:${session.me?.accountNumId ?? ''}`;
let generation = 0;
let alive = true;
let ownConfirmation = false;

async function token(): Promise<string> {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}

async function load() {
  const gen = ++generation, who = identity(), want = status.value, at = offset.value;
  loading.value = true; loadError.value = ''; forbidden.value = false;
  try {
    const access = await token();
    if (!alive || gen !== generation || who !== identity()) return;
    const got = await fetchWorkshopAppeals(want, at, access);
    if (!alive || gen !== generation || who !== identity()) return;
    // 處理掉後一頁的最後一筆，這頁就空了：退回上一頁，不留一個沒有換頁鈕的空態
    if (!got.items.length && at > 0) { offset.value = Math.max(0, at - PAGE); void load(); return; }
    items.value = got.items; hasNext.value = got.hasNext;
  } catch (e) {
    if (gen !== generation) return;
    items.value = [];
    if (e instanceof ApiError && e.status === 403) forbidden.value = true;
    else loadError.value = t('workshop.moderation.error.load');
  } finally {
    if (gen === generation) loading.value = false;
  }
}

function setStatus(next: Status) {
  if (next === status.value || busy.value) return;
  status.value = next; offset.value = 0; failed.value = null; void load();
}
function page(delta: number) {
  if (busy.value) return;
  offset.value = Math.max(0, offset.value + delta * PAGE); void load();
}

// 換帳號或換線路：清掉畫面、收掉還開著的確認框，重讀
watch(identity, () => {
  generation++; items.value = []; failed.value = null; busy.value = false;
  if (ownConfirmation && confirmState.current) settleConfirm(false);
  if (session.me) void load();
});
onMounted(() => { document.title = pageTitle(t('workshop.moderation.tab')); void load(); });
onBeforeUnmount(() => { alive = false; generation++; if (ownConfirmation && confirmState.current) settleConfirm(false); });

const nameOf = (a: WorkshopAppeal) => displayName(a.workshop.name, locale.value);

/** 問理由：維持／恢復是一般確認（焦點在取消），撤下走共用的危險確認框 */
async function ask(a: WorkshopAppeal, kind: AppealDecision | 'revoke'): Promise<string | null> {
  ownConfirmation = true;
  try {
    if (kind === 'revoke') return await askRevokeReason(nameOf(a));
    const got = await confirmForm({
      title: kind === 'upheld' ? t('workshop.moderation.uphold.title') : t('workshop.moderation.restore.title', { name: nameOf(a) }),
      message: kind === 'upheld' ? t(`workshop.moderation.uphold.body.${a.ownerAction}`, { name: nameOf(a) }) : t('workshop.moderation.restore.body'),
      confirmText: t(kind === 'upheld' ? 'workshop.moderation.uphold' : 'workshop.moderation.restore'),
      cancelText: t('dialog.cancel'),
      focusCancel: true,
      field: { label: t('workshop.moderation.decision.reason'), required: true, multiline: true, maxlength: 2000 },
    });
    return got?.text.trim() || null;
  } finally { ownConfirmation = false; }
}

async function act(a: WorkshopAppeal, kind: AppealDecision | 'revoke') {
  if (busy.value || a.viewerRelation || a.status !== 'pending') return;
  const who = identity();
  const reason = await ask(a, kind);
  if (!reason || !alive || who !== identity()) return;
  const operationId = crypto.randomUUID();
  await send(kind === 'revoke'
    ? { kind: 'revoke', workshopId: a.workshop.id, body: { reason, operationId } }
    : { kind: 'decision', appealId: a.id, body: { decision: kind, reason, operationId } });
}

async function send(attempt: Attempt) {
  if (busy.value) return;
  const who = identity();
  busy.value = true; failed.value = null;
  try {
    const access = await token();
    if (!alive || who !== identity()) return;
    if (attempt.kind === 'revoke') await revokeWorkshop(attempt.workshopId, attempt.body, access);
    else await decideWorkshopAppeal(attempt.appealId, attempt.body, access);
    if (!alive || who !== identity()) return;
    toast.value?.say(t(attempt.kind === 'revoke' ? 'workshop.moderation.toast.revoked' : 'workshop.moderation.toast.decided'));
    busy.value = false;
    await Promise.all([load(), refreshAppealCount(access)]);
  } catch (e) {
    if (!alive || who !== identity()) return;
    // 4xx（已被處理、沒權限、與自己有關）原樣重送也不會過：重讀清單讓畫面對上現況；只有網路與伺服器錯才給重試
    const status = e instanceof ApiError ? e.status : 0;
    if (status === 403) forbidden.value = true;
    else if (status >= 400 && status < 500 && status !== 408 && status !== 429) { busy.value = false; void load(); }
    else failed.value = attempt;
  } finally {
    if (alive && who === identity()) busy.value = false;
  }
}

const pendingLabel = computed(() => t('workshop.moderation.filter.pending', { n: appealCount.pending }));
const cardPath = (a: WorkshopAppeal) => lp(`/cards/${a.card.num || a.card.id}`);
</script>

<template>
  <section class="wsa" :aria-label="t('workshop.moderation.tab')">
    <div class="seg wsa__seg" role="radiogroup" :aria-label="t('workshop.moderation.filter')">
      <button type="button" role="radio" class="seg__item" :class="{ 'seg__item--on': status === 'pending' }" :aria-checked="status === 'pending'" data-wsa-status="pending" @click="setStatus('pending')">{{ pendingLabel }}</button>
      <button type="button" role="radio" class="seg__item" :class="{ 'seg__item--on': status === 'decided' }" :aria-checked="status === 'decided'" data-wsa-status="decided" @click="setStatus('decided')">{{ t('workshop.moderation.filter.decided') }}</button>
    </div>

    <p v-if="failed" class="notice notice--error wsa__notice" role="alert" data-wsa-failed>
      <span class="ws-text">{{ t('workshop.moderation.error.action') }}</span>
      <button type="button" class="btn btn--sm" :disabled="busy" @click="send(failed)">{{ t('library.retry') }}</button>
    </p>

    <p v-if="forbidden" class="notice wsa__notice" role="status" data-wsa-forbidden><span class="ws-text">{{ t('workshop.moderation.forbidden') }}</span></p>
    <p v-else-if="loadError" class="notice notice--error wsa__notice" role="alert">
      <span class="ws-text">{{ loadError }}</span>
      <button type="button" class="btn btn--sm" @click="load">{{ t('library.retry') }}</button>
    </p>
    <div v-else-if="loading && !items.length" class="wsa__list" aria-busy="true">
      <div v-for="n in 3" :key="n" class="ghost wsa__ghost" />
    </div>
    <div v-else-if="!items.length" class="panel wsa__empty" data-wsa-empty>
      <template v-if="status === 'pending'">
        <p class="wsa__empty-title">{{ t('workshop.moderation.empty.title') }}</p>
        <p class="subtle ws-text">{{ t('workshop.moderation.empty.body') }}</p>
      </template>
      <p v-else class="wsa__empty-title">{{ t('workshop.moderation.emptyDecided') }}</p>
    </div>
    <template v-else>
      <ul class="wsa__list" :aria-busy="loading || undefined">
        <li v-for="a in items" :key="a.id" class="panel wsa__case" :data-wsa-case="a.id">
          <div class="wsa__head">
            <ExtensionCover class="wsa__cover" :src="a.workshop.coverUrl" :name="a.workshop.name" />
            <div class="wsa__info">
              <RouterLink class="wsa__name ws-text" :to="lp(`/workshops/${encodeURIComponent(a.workshop.id)}`)">{{ nameOf(a) }}</RouterLink>
              <p class="wsa__meta">
                <RouterLink class="link" :to="cardPath(a)">{{ t('workshop.moderation.meta', { card: displayName(a.card.name, locale), maker: a.maker.name, owner: a.owner.name }) }}</RouterLink>
              </p>
              <div class="wsa__chips">
                <span class="chip" :class="a.ownerAction === 'returned' ? 'ws-chip--bad' : 'ws-chip--warn'">{{ t(`workshop.moderation.ownerAction.${a.ownerAction}`) }}</span>
                <span class="subtle">{{ relativeTime(a.ownerActedAt) }}</span>
                <span v-if="a.result" class="chip" :class="a.result === 'revoked' ? 'ws-chip--bad' : 'ws-chip--ok'" data-wsa-result>{{ t(`workshop.moderation.result.${a.result}`) }}</span>
              </div>
            </div>
          </div>
          <p class="ws-reason">{{ t('workshop.moderation.ownerReason', { reason: a.ownerReason }) }}</p>
          <p class="ws-reason wsa__appeal">{{ t('workshop.moderation.appealReason', { reason: a.appealReason }) }}</p>
          <p v-if="a.viewerRelation" class="notice wsa__notice" data-wsa-self>
            <span class="ws-text">{{ t(a.viewerRelation === 'maker' ? 'workshop.moderation.self.maker' : 'workshop.moderation.self.owner') }}</span>
          </p>
          <div v-else-if="a.status === 'pending'" class="wsa__actions">
            <button type="button" class="btn btn--sm" data-wsa-act="upheld" :disabled="busy" @click="act(a, 'upheld')">{{ t('workshop.moderation.uphold') }}</button>
            <button type="button" class="btn btn--sm" data-wsa-act="restored" :disabled="busy" @click="act(a, 'restored')">{{ t('workshop.moderation.restore') }}</button>
            <span class="wsa__spacer" />
            <button type="button" class="btn btn--sm btn--danger" data-wsa-act="revoke" :disabled="busy" @click="act(a, 'revoke')">{{ t('workshop.moderation.revoke') }}</button>
          </div>
        </li>
      </ul>
      <nav v-if="offset > 0 || hasNext" class="wsa__pager" :aria-label="t('workshop.moderation.tab')">
        <button type="button" class="btn btn--sm" :disabled="offset === 0 || loading || busy" @click="page(-1)">{{ t('moderation.previous') }}</button>
        <button type="button" class="btn btn--sm" :disabled="!hasNext || loading || busy" @click="page(1)">{{ t('moderation.next') }}</button>
      </nav>
    </template>
    <UndoToast ref="toast" />
  </section>
</template>

<style scoped>
.wsa { display: grid; gap: var(--s-4); max-width: 820px; min-width: 0; }
.wsa__seg { justify-self: start; }
.wsa__notice { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); margin: 0; }
.wsa__list { display: grid; gap: var(--s-3); margin: 0; padding: 0; list-style: none; }
.wsa__ghost { height: 220px; border-radius: var(--r-lg); }
.wsa__empty { display: grid; gap: var(--s-2); padding: var(--s-6) var(--s-5); text-align: center; justify-items: center; }
.wsa__empty p { margin: 0; }
.wsa__empty-title { font-weight: 600; }
.wsa__case { display: grid; gap: var(--s-3); padding: var(--s-4) var(--s-5); min-width: 0; }
.wsa__head { display: flex; align-items: flex-start; gap: var(--s-3); min-width: 0; }
.wsa__cover { width: 112px; flex: none; aspect-ratio: 16 / 9; border-radius: var(--r-sm); }
.wsa__info { display: grid; gap: 4px; flex: 1; min-width: 0; }
.wsa__name { font-weight: 700; color: var(--text); overflow-wrap: anywhere; }
.wsa__name:hover { color: var(--accent-text); }
.wsa__meta { margin: 0; font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; }
.wsa__meta .link { color: inherit; }
.wsa__chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
/* 製作者的申訴用 accent 線，和原作者的灰線分開 */
.wsa__appeal { box-shadow: inset 3px 0 0 var(--accent); }
.wsa__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.wsa__spacer { flex: 1; }
.wsa__pager { display: flex; gap: var(--s-2); justify-content: center; }
@media (max-width: 480px) {
  .wsa__case { padding: var(--s-4); }
  .wsa__cover { width: 96px; }
  .wsa__actions .btn { min-height: 44px; }
}
</style>
