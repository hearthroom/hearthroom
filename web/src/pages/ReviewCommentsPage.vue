<script setup lang="ts">
/**
 * 社群管理的「留言」分頁：待審、被檢舉、最近移除三個佇列，加上頂部的統計與底部的關鍵詞。
 *
 * 移除、駁回檢舉、禁言都要理由，在對話框裡填；每開一次對話框配一個操作編號，送失敗重按沿用同一個，
 * 服務端靠它認出重送。放行不用理由，按一下就送，同樣一則留言重按沿用上一次的編號。
 * AI 審核帳號只能放行：服務端擋其他動作，畫面上也不給。它讀關鍵詞會被拒（agent_not_allowed），這裡就靠那一聲認出來。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError, addKeyword, decideComment, fetchCommentQueue, fetchCommentStats, fetchKeywords, muteMember, removeKeyword, type CommentKeyword, type CommentQueueTab, type CommentStats, type QueuedComment } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useReviewer } from '@/lib/review';
import { useLocalePath } from '@/lib/use-locale';
import { dateTime } from '@/lib/format';
import { pageTitle } from '@/lib/i18n';
import { wrapTab } from '@/lib/focus-trap';

const { t, locale } = useI18n();
const session = useSession();
const reviewer = useReviewer();
const { lp } = useLocalePath();

const TABS: CommentQueueTab[] = ['held', 'reported', 'removed'];
/** 服務端一頁的筆數（comment-moderation.ts 的 QUEUE_PAGE） */
const PAGE = 20;
const tab = ref<CommentQueueTab>('held');
const page = ref(1);
const items = ref<QueuedComment[]>([]);
const total = ref(0);
const stats = ref<CommentStats | null>(null);
const loading = ref(true);
const error = ref('');
const done = ref('');
const agent = ref(false);
const keywords = ref<CommentKeyword[] | null>(null);
const keywordDraft = ref('');
const keywordBusy = ref(false);
let keywordOperation = crypto.randomUUID();
/** 放行沒有對話框：同一則重按沿用編號，成功後丟掉 */
const releaseOps = new Map<string, string>();
const busyId = ref('');
let generation = 0, alive = true;

type DialogKind = 'remove' | 'dismiss' | 'mute';
const dialogBox = ref<HTMLElement | null>(null);
const listBox = ref<HTMLElement | null>(null);
const tabsBox = ref<HTMLElement | null>(null);
/** 打開對話框的那顆鍵：怎麼關（完成、取消、Esc、點背景）焦點都還給它 */
let opener: HTMLElement | null = null;
const dialog = ref<{ kind: DialogKind; item: QueuedComment; reason: string; days: 7 | 30 | null; operationId: string; busy: boolean; error: string } | null>(null);

const hasNext = computed(() => page.value * PAGE < total.value);
const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : '');
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : t(fallback));
/** 處理一則留言時撞到衝突：別人先處理了。共用的衝突碼對應的是卡片審核的說法，這裡換成留言的。 */
const decisionMessage = (e: unknown) => (codeOf(e) === 'moderation_conflict' ? t('moderation.comments.conflict') : message(e, 'moderation.error.retry'));

async function token() {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}
async function load() {
  const gen = ++generation;
  loading.value = true; error.value = '';
  try {
    const access = await token();
    const [queue, numbers] = await Promise.all([fetchCommentQueue(tab.value, page.value, access), fetchCommentStats(access)]);
    if (!alive || gen !== generation) return;
    items.value = queue.items; total.value = queue.total; stats.value = numbers;
  } catch (e) { if (gen === generation) error.value = message(e, 'state.loadFailed'); } finally { if (gen === generation) loading.value = false; }
}
async function loadKeywords() {
  try { keywords.value = (await fetchKeywords(await token())).items; } catch (e) { if (codeOf(e) === 'agent_not_allowed') agent.value = true; }
}
async function afterDecision() {
  done.value = t('moderation.saved');
  await load();
  await reviewer.refresh();
}
/**
 * 佇列重讀之後把焦點放回來：按下去的那顆鍵還在就回它；那一則已經離開佇列（放行、移除、駁回）就落到補上同一個位置的那一則
 * 的第一顆鍵，最後一則就往前一則；佇列空了落到目前的分頁鍵。不然焦點掉回頁首，鍵盤使用者得從頭 Tab 一遍。
 */
async function refocus(origin: HTMLElement | null, index: number) {
  await nextTick();
  if (origin?.isConnected) return origin.focus();
  const rows = [...(listBox.value?.querySelectorAll<HTMLElement>('.cmod-item') ?? [])];
  const row = rows[Math.min(Math.max(index, 0), rows.length - 1)];
  (row?.querySelector<HTMLElement>('.cmod-item__actions button:not(:disabled)') ?? tabsBox.value?.querySelector<HTMLElement>('.seg__item--on'))?.focus();
}
const rowOf = (item: QueuedComment) => items.value.findIndex((i) => i.id === item.id);

async function release(item: QueuedComment, e: Event) {
  if (busyId.value) return;
  const origin = e.currentTarget as HTMLElement | null, index = rowOf(item);
  let ok = false;
  const operationId = releaseOps.get(item.id) ?? crypto.randomUUID();
  releaseOps.set(item.id, operationId);
  busyId.value = item.id; error.value = ''; done.value = '';
  try {
    await decideComment(item.id, { action: 'release', reason: '', operationId }, await token());
    releaseOps.delete(item.id);
    await afterDecision();
    ok = true;
  } catch (e) { error.value = decisionMessage(e); } finally { busyId.value = ''; }
  if (ok) await refocus(origin, index);
}

async function open(kind: DialogKind, item: QueuedComment, e: Event) {
  done.value = '';
  // 從點擊本身拿：macOS 的 Safari、Firefox 用滑鼠點按鈕不會讓它取得焦點
  opener = e.currentTarget as HTMLElement | null;
  dialog.value = { kind, item, reason: '', days: 7, operationId: crypto.randomUUID(), busy: false, error: '' };
  await nextTick();
  dialogBox.value?.querySelector<HTMLElement>('textarea')?.focus();
}
async function close() {
  dialog.value = null;
  await nextTick();
  if (opener?.isConnected) opener.focus();
  opener = null;
}
const dialogTitle = computed(() => {
  const d = dialog.value;
  if (!d) return '';
  return d.kind === 'remove' ? t('moderation.comments.removeTitle') : d.kind === 'mute' ? t('moderation.comments.muteTitle', { name: d.item.author.displayName }) : t('moderation.comments.dismiss');
});
async function confirmDialog() {
  const d = dialog.value;
  if (!d || d.busy || !d.reason.trim()) return;
  d.busy = true; d.error = '';
  try {
    const access = await token();
    const reason = d.reason.trim();
    if (d.kind === 'mute') await muteMember(d.item.author.handle, { days: d.days, reason, operationId: d.operationId }, access);
    else await decideComment(d.item.id, { action: d.kind, reason, operationId: d.operationId }, access);
    const origin = opener, index = rowOf(d.item);
    await close();
    await afterDecision();
    await refocus(origin, index);
  } catch (e) {
    if (codeOf(e) === 'agent_not_allowed') agent.value = true;
    d.error = d.kind === 'mute' ? message(e, 'moderation.error.retry') : decisionMessage(e);
  } finally { d.busy = false; }
}
function onKey(e: KeyboardEvent) {
  if (!dialog.value) return;
  if (e.key === 'Escape') { if (!dialog.value.busy) void close(); return; }
  wrapTab(e, dialogBox.value);
}

async function add() {
  const pattern = keywordDraft.value.trim();
  if (!pattern || keywordBusy.value) return;
  keywordBusy.value = true; error.value = '';
  try {
    keywords.value = (await addKeyword(pattern, keywordOperation, await token())).items;
    keywordDraft.value = ''; keywordOperation = crypto.randomUUID();
  } catch (e) { error.value = message(e, 'moderation.error.retry'); } finally { keywordBusy.value = false; }
}
async function drop(k: CommentKeyword) {
  if (keywordBusy.value) return;
  keywordBusy.value = true; error.value = '';
  try { keywords.value = (await removeKeyword(k.id, crypto.randomUUID(), await token())).items; } catch (e) { error.value = message(e, 'moderation.error.retry'); } finally { keywordBusy.value = false; }
}

/** 攔截率：一位小數的百分比 */
const percent = computed(() => new Intl.NumberFormat(String(locale.value), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }));
/** 處理時間中位數：一小時內講分鐘，兩天內講小時，再久講天；單位交給 Intl。 */
function duration(ms: number | null): string {
  if (ms === null) return '—';
  const [unit, n] = ms < 3_600_000 ? ['minute', ms / 60_000] : ms < 172_800_000 ? ['hour', ms / 3_600_000] : ['day', ms / 86_400_000];
  return new Intl.NumberFormat(String(locale.value), { style: 'unit', unit: unit as string, unitDisplay: 'short', maximumFractionDigits: 0 }).format(Math.max(1, Math.round(n as number)));
}

watch([tab, page], () => { void load(); });
function pick(next: CommentQueueTab) { if (tab.value === next) return; page.value = 1; tab.value = next; done.value = ''; }
onMounted(() => {
  document.title = pageTitle(t('moderation.title'));
  document.addEventListener('keydown', onKey);
  void load(); void loadKeywords();
});
onBeforeUnmount(() => { alive = false; document.removeEventListener('keydown', onKey); });
</script>

<template>
  <section class="cmod" :aria-label="t('moderation.tab.comments')">
    <dl v-if="stats" class="cmod-stats panel">
      <div class="stat"><dt>{{ t('moderation.comments.stats.held') }}</dt><dd>{{ stats.held }}</dd></div>
      <div class="stat"><dt>{{ t('moderation.comments.stats.openReports') }}</dt><dd>{{ stats.openReports }}</dd></div>
      <div class="stat"><dt>{{ t('moderation.comments.stats.removed7d') }}</dt><dd>{{ stats.removed7d }}</dd></div>
      <div class="stat"><dt>{{ t('moderation.comments.stats.median') }}</dt><dd>{{ duration(stats.medianHandleMs7d) }}</dd></div>
      <div class="stat"><dt>{{ t('moderation.comments.stats.holdRate') }}</dt><dd>{{ stats.holdRate7d == null ? '—' : percent.format(stats.holdRate7d) }}</dd></div>
      <div class="stat"><dt>{{ t('moderation.comments.stats.reports7d') }}</dt><dd>{{ stats.reports7d ?? 0 }}</dd></div>
    </dl>

    <div ref="tabsBox" class="seg cmod-tabs">
      <button v-for="key in TABS" :key="key" type="button" class="seg__item" :class="{ 'seg__item--on': tab === key }" :aria-pressed="tab === key" @click="pick(key)">{{ t(`moderation.comments.${key}`) }}</button>
    </div>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }} <button class="btn btn--sm" :disabled="loading" @click="load">{{ t('review.refresh') }}</button></p>
    <p v-if="done" class="notice" role="status">{{ done }}</p>

    <div ref="listBox" class="cmod-list" :aria-busy="loading">
      <template v-if="loading && !items.length"><div v-for="n in 3" :key="n" class="ghost cmod-ghost" /></template>
      <p v-else-if="!items.length" class="panel cmod-empty muted">{{ t('moderation.comments.empty') }}</p>
      <article v-for="item in items" :key="item.id" class="panel cmod-item" :data-comment="item.id">
        <div class="cmod-item__head">
          <RouterLink class="cmod-item__card" :to="lp(item.target.kind === 'post' ? `/blog/p/${item.target.id}` : `/cards/${item.target.id}`)">{{ item.target.title }}</RouterLink>
          <time class="subtle">{{ dateTime(item.createdAt) }}</time>
        </div>
        <RouterLink class="subtle cmod-item__author" :to="lp(`/review/members/${item.author.handle}`)">{{ item.author.displayName }} · @{{ item.author.handle }}</RouterLink>
        <p class="cmod-item__text">{{ item.content }}</p>
        <div class="cmod-item__chips">
          <span v-if="item.suggestedBy === 'ai'" class="chip cmod-chip--ai">{{ t('moderation.comments.aiSuggested') }}</span>
          <span v-else-if="item.holdReason" class="chip">{{ t(`moderation.comments.holdReason.${item.holdReason}`) }}</span>
          <span v-for="(n, r) in item.reports.byReason" :key="r" class="chip">{{ t('moderation.comments.reportItem', { reason: t(`comment.reportReason.${r}`), n }) }}</span>
        </div>
        <!-- AI 標記時寫的理由；已移除的留言是審核人寫的移除原因 -->
        <p v-if="item.moderationReason && (item.suggestedBy === 'ai' || tab === 'removed')" class="notice cmod-item__reason">{{ item.moderationReason }}</p>
        <div v-if="tab !== 'removed'" class="cmod-item__actions">
          <button v-if="tab === 'held'" data-action="release" class="btn btn--sm btn--primary" :disabled="!!busyId" @click="release(item, $event)">{{ t('moderation.comments.release') }}</button>
          <template v-if="!agent">
            <button v-if="tab === 'reported'" data-action="dismiss" class="btn btn--sm" :disabled="!!busyId" @click="open('dismiss', item, $event)">{{ t('moderation.comments.dismiss') }}</button>
            <button data-action="remove" class="btn btn--sm btn--danger" :disabled="!!busyId" @click="open('remove', item, $event)">{{ t('moderation.comments.remove') }}</button>
            <button data-action="mute" class="btn btn--sm btn--ghost" :disabled="!!busyId" @click="open('mute', item, $event)">{{ t('moderation.comments.mute') }}</button>
          </template>
        </div>
      </article>
    </div>
    <div v-if="page > 1 || hasNext" class="cmod-pager">
      <button class="btn btn--sm" :disabled="page === 1 || loading" @click="page--">{{ t('moderation.previous') }}</button>
      <button class="btn btn--sm" :disabled="!hasNext || loading" @click="page++">{{ t('moderation.next') }}</button>
    </div>

    <section v-if="!agent && keywords" class="panel cmod-keywords" :aria-label="t('moderation.comments.keywords')">
      <h2>{{ t('moderation.comments.keywords') }}</h2>
      <form class="cmod-keywords__add" @submit.prevent="add">
        <input v-model="keywordDraft" class="input" maxlength="100" :aria-label="t('moderation.comments.keywordAdd')" :disabled="keywordBusy" />
        <button class="btn btn--sm" :disabled="keywordBusy || !keywordDraft.trim()">{{ t('moderation.comments.keywordAdd') }}</button>
      </form>
      <p v-if="!keywords.length" class="subtle">{{ t('moderation.comments.keywordsEmpty') }}</p>
      <ul v-else class="cmod-keywords__list">
        <li v-for="k in keywords" :key="k.id" :data-keyword="k.id">
          <span>{{ k.pattern }}</span>
          <button class="btn btn--sm btn--ghost" :disabled="keywordBusy" :aria-label="t('moderation.comments.keywordRemove', { pattern: k.pattern })" @click="drop(k)">{{ t('dialog.delete') }}</button>
        </li>
      </ul>
    </section>

    <Teleport to="body">
      <div v-if="dialog" class="modal-backdrop" @click.self="!dialog.busy && close()">
        <form ref="dialogBox" class="modal panel" role="dialog" aria-modal="true" aria-labelledby="cmod-dialog-title" @submit.prevent="confirmDialog">
          <h2 id="cmod-dialog-title" class="modal__title">{{ dialogTitle }}</h2>
          <p class="cmod-dialog__quote">{{ dialog.item.content }}</p>
          <div v-if="dialog.kind === 'mute'" class="seg">
            <button v-for="d in ([7, 30, null] as const)" :key="String(d)" type="button" class="seg__item" :class="{ 'seg__item--on': dialog.days === d }" :aria-pressed="dialog.days === d" @click="dialog.days = d">{{ t(d === 7 ? 'moderation.comments.mute7' : d === 30 ? 'moderation.comments.mute30' : 'moderation.comments.muteForever') }}</button>
          </div>
          <label class="cmod-dialog__field">
            <span class="subtle">{{ t(dialog.kind === 'remove' ? 'moderation.comments.removeReason' : 'moderation.reason') }}</span>
            <textarea autocomplete="off" v-model="dialog.reason" class="input" rows="3" maxlength="2000" :disabled="dialog.busy" />
          </label>
          <p v-if="dialog.error" class="notice notice--error" role="alert">{{ dialog.error }}</p>
          <div class="modal__actions">
            <button type="button" class="btn" :disabled="dialog.busy" @click="close">{{ t('dialog.cancel') }}</button>
            <button type="submit" class="btn" :class="dialog.kind === 'dismiss' ? 'btn--primary' : 'btn--danger-solid'" :disabled="dialog.busy || !dialog.reason.trim()">{{ t(`moderation.comments.${dialog.kind}`) }}</button>
          </div>
        </form>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.cmod { display: grid; gap: var(--s-4); min-width: 0; }
.cmod-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-4); margin: 0; padding: var(--s-4) var(--s-5); }
.cmod-stats dd { margin: 0; }
.cmod-tabs { justify-self: start; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.cmod-list { display: grid; gap: var(--s-3); }
.cmod-ghost { height: 120px; }
.cmod-empty { padding: var(--s-5); margin: 0; }
.cmod-item { padding: var(--s-4); display: grid; gap: var(--s-2); min-width: 0; overflow-wrap: anywhere; }
.cmod-item__head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; }
.cmod-item__card { font-weight: 600; color: var(--text); }
.cmod-item__card:hover, .cmod-item__author:hover { color: var(--accent-text); }
.cmod-item__author { justify-self: start; }
.cmod-item__text { margin: 0; font-size: 14px; line-height: 1.65; white-space: pre-wrap; }
.cmod-item__chips { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.cmod-item__chips:empty { display: none; }
.cmod-item__chips .chip { cursor: default; }
.cmod-chip--ai { background: var(--accent-tint); color: var(--accent-text); }
.cmod-item__reason { margin: 0; white-space: pre-wrap; }
.cmod-item__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.cmod-item__actions:empty { display: none; }
.cmod-pager { display: flex; gap: var(--s-2); justify-content: center; }
.cmod-keywords { padding: var(--s-4) var(--s-5); display: grid; gap: var(--s-3); }
.cmod-keywords h2 { font-size: 17px; }
.cmod-keywords__add { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.cmod-keywords__add .input { flex: 1; min-width: 160px; }
.cmod-keywords__list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--s-2); }
.cmod-keywords__list li { display: inline-flex; align-items: center; gap: var(--s-1); padding-inline-start: var(--s-3); border-radius: var(--r-pill); background: var(--surface-2); font-size: 13px; }
.cmod-dialog__quote { margin: 0; padding: var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 13.5px; line-height: 1.6; color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow-y: auto; }
.cmod-dialog__field { display: grid; gap: 6px; }
@media (max-width: 760px) {
  .cmod-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: var(--s-4); }
  .cmod-item__actions .btn, .cmod-keywords .btn, .cmod-keywords .input { min-height: 44px; }
  .cmod-item__actions .btn { flex: 1; }
}
</style>
