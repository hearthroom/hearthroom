<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { displayName } from '@/lib/display-name';
import { fetchConversations, previewConversationDeletion, deleteConversations, libraryRequest,isUnavailableFavorite,type LibraryFavorite, type ConversationSummary, type ConversationDeletionPreview, type ConversationDeletionResult } from '@/lib/library';
import { confirmDialog, confirmState } from '@/lib/confirm';
import { pageAway } from '@/pet/enabled';
import { contentLang, pageTitle } from '@/lib/i18n';
import { hueFrom } from '@/lib/format';
import CardGrid from '@/components/CardGrid.vue';
import FavoriteGrid from '@/components/FavoriteGrid.vue';
import LibraryToggle from '@/components/LibraryToggle.vue';
import AccountIcon from '@/components/AccountIcon.vue';
import MascotSay from '@/components/MascotSay.vue';
import ConversationRows from '@/components/ConversationRows.vue';
const session = useSession();
const route = useRoute(), router = useRouter();
const { locale, lp } = useLocalePath();
const { t } = useI18n();
const tabs = ['conversations', 'favorites', 'following'] as const;
const tab = computed(() => tabs.includes(route.query.tab as typeof tabs[number]) ? route.query.tab as typeof tabs[number] : 'conversations');
const page = computed(() => Math.max(1, Math.floor(Number(route.query.page) || 1)));
const chats = ref<ConversationSummary[]>([]), cards = ref<LibraryFavorite[]>([]);
const authors = ref<{ handle: string; name: string; avatar: string; bio: string }[]>([]);
const loading = ref(true), failed = ref(false), hasNext = ref(false);
const managing = ref(false), selected = ref<string[]>([]), locked = ref(false), toast = ref(''), pendingResult = ref(false);
const errors = ref<Record<string, 'busy'|'error'>>({});
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let retryPreview: { ids: string; preview: ConversationDeletionPreview } | undefined;
const selectedChats = computed(() => chats.value.filter(c => selected.value.includes(c.conversationId)));
const failedCount = computed(() => Object.keys(errors.value).length);
const allSelected = computed(() => chats.value.length > 0 && selected.value.length === chats.value.length);
let sequence = 0;
async function load(quiet = false) {
  const seq = ++sequence;
  if (!quiet) { loading.value = true; failed.value = false; chats.value = []; cards.value = []; authors.value = []; hasNext.value = false; }
  document.title = pageTitle(t('library.title'));
  try {
    const token = await session.accessToken();
    if (!token) throw new Error('auth');
    if (tab.value === 'conversations') {
      const result = await fetchConversations(token, contentLang(locale.value), page.value);
      if (seq === sequence) { chats.value = result.conversations; hasNext.value = result.hasNextPage; }
    } else {
      const result = await libraryRequest<{ items: LibraryFavorite[] | typeof authors.value; hasNext: boolean }>(`${tab.value}?offset=${(page.value - 1) * 24}&lang=${contentLang(locale.value)}`, token);
      if (seq === sequence) { if (tab.value === 'favorites') cards.value = result.items as LibraryFavorite[]; else authors.value = result.items as typeof authors.value; hasNext.value = result.hasNext; }
    }
  } catch { if (seq === sequence && !quiet) failed.value = true; }
  finally { if (seq === sequence) loading.value = false; }
}
function navigate(next: string, n = 1) { if (!locked.value) void router.push({ query: { tab: next, ...(n > 1 ? { page: String(n) } : {}) } }); }
function removedFavorite(id:string){cards.value=cards.value.filter(item=>(isUnavailableFavorite(item)?item.bookmarkId:item.id)!==id);}
const empty = computed(() => !chats.value.length && !cards.value.length && !authors.value.length);
function clearSelection() { selected.value = []; errors.value = {}; retryPreview = undefined; pendingResult.value = false; }
function finish() { if (locked.value) return; managing.value = false; clearSelection(); }
function selectAll() { if (!locked.value) selected.value = allSelected.value ? [] : chats.value.map(c => c.conversationId); }
async function remove(targets = selectedChats.value) {
  if (locked.value || !targets.length) return;
  locked.value = true;
  const frozen = [...targets], ids = frozen.map(c => c.conversationId).sort().join('|');
  const name = (c: ConversationSummary) => c.conversationTitle || displayName(c.roleName, locale.value) || t('library.untitled');
  let outcome: ConversationDeletionResult | undefined, unknown = false, expired = false;
  try {
    const token = await session.accessToken(); if (!token) throw new Error('auth');
    const preview = retryPreview?.ids === ids ? retryPreview.preview : await previewConversationDeletion(token, frozen);
    retryPreview = { ids, preview };
    const n = preview.groups.filter(g => frozen.some(c => c.conversationId === g.conversationId)).reduce((sum,g) => sum + g.count,0), one = frozen.length === 1;
    const confirmed = await confirmDialog({
      title: t(n === 0 ? 'library.manage.ghostTitle' : 'library.manage.confirmTitleN', { n }, n),
      message: n === 0 ? t('library.manage.ghostBody') : one ? t('library.manage.confirmBodyOne', { name: [...name(frozen[0])].slice(0,20).join('') + ([...name(frozen[0])].length > 20 ? '…' : '') }) : t('library.manage.confirmBodyN'),
      confirmText: n === 0 ? t('library.manage.removeRecord') : t('library.manage.confirmN', { n }, n), cancelText: t('library.manage.keep'),
      danger: true, dangerAppearance: 'subdued', busyText: t('library.manage.deleting'),
      items: one ? undefined : frozen.slice(0,3).map(c => ({ name: name(c), image: c.roleAvatar })),
      moreText: frozen.length > 3 ? t('library.manage.moreItems', { n: frozen.length - 3 }, frozen.length - 3) : undefined,
      onConfirm: async () => {
        try { outcome = preview.groups.length === frozen.length ? await deleteConversations(token, preview.selectionToken) : await deleteConversations(token, preview.selectionToken, frozen.map(c => c.conversationId)); }
        catch (e) { expired = (e as { code?: string }).code === 'selection_expired'; unknown = !expired; }
      },
    });
    if (!confirmed) return;
    if (expired) {
      retryPreview = undefined; managing.value = true; pendingResult.value = false;
      selected.value = frozen.map(c => c.conversationId); errors.value = Object.fromEntries(frozen.map(c => [c.conversationId,'error'])); return;
    }
    if (unknown || !outcome) {
      managing.value = true; pendingResult.value = true;
      selected.value = frozen.map(c => c.conversationId);
      errors.value = Object.fromEntries(frozen.map(c => [c.conversationId, 'error']));
      return;
    }
    pendingResult.value = false;
    const successes = new Set(outcome.results.filter(r => r.status === 'deleted').map(r => r.conversationId));
    const failed = frozen.filter(c => !successes.has(c.conversationId));
    errors.value = Object.fromEntries(failed.map(c => [c.conversationId, outcome!.results.find(r => r.conversationId === c.conversationId)?.status === 'busy' ? 'busy' : 'error']));
    selected.value = failed.map(c => c.conversationId);
    chats.value = chats.value.filter(c => !successes.has(c.conversationId));
    if (successes.size) {
      toast.value = outcome.deletedCount ? t('library.manage.deletedToast', { n: outcome.deletedCount }, outcome.deletedCount) : t('library.manage.removedToast');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.value = ''; }, 3000);
    }
    // Failed snapshots stay frozen for retry, even if another tab starts a new save.
    if (!failed.length) retryPreview = undefined;
    else { managing.value = true; retryPreview = { ids: failed.map(c => c.conversationId).sort().join('|'), preview }; }
    await load(true);
    // Keep errors reachable even if a concurrently refreshed index omits their rows.
    for (const c of failed) if (!chats.value.some(row => row.conversationId === c.conversationId)) chats.value.push(c);
    if (!chats.value.length) { if (page.value > 1) void router.push({ query: { tab: 'conversations', ...(page.value > 2 ? { page: String(page.value - 1) } : {}) } }); else managing.value = false; }
  } catch {
    managing.value = true; selected.value = frozen.map(c => c.conversationId);
    errors.value = Object.fromEntries(frozen.map(c => [c.conversationId, 'error']));
    retryPreview = undefined;
  } finally { locked.value = false; }
}
function key(e: KeyboardEvent) {
  if (!managing.value || locked.value || confirmState.current || (e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  if (e.key === 'Escape') { e.preventDefault(); finish(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selected.value = chats.value.map(c => c.conversationId); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value.length) { e.preventDefault(); void remove(); }
}
watch(managing, on => { pageAway.value += on ? 1 : -1; }, { flush: 'sync' });
watch([tab, page], ([next], [previous]) => { clearSelection(); if (next !== previous) managing.value = false; });
watch([tab, page, locale, () => session.me, () => session.profile?.showNsfw, () => session.profile?.hiddenTags?.join(',')], () => { void load(); }, { immediate: true });
onMounted(() => document.addEventListener('keydown', key));
onBeforeRouteLeave(() => !locked.value);
onBeforeRouteUpdate(() => !locked.value);
onBeforeUnmount(() => { document.removeEventListener('keydown', key); if (managing.value) pageAway.value--; clearTimeout(toastTimer); sequence++; });
</script>
<template>
  <div class="page library" :class="{'library--manage':managing}">
    <header class="library__header"><div><p class="eyebrow">{{ $t('library.eyebrow') }}</p><h1 class="display">{{ $t('library.title') }}</h1><p class="muted">{{ $t('library.hint') }}</p></div><RouterLink class="btn library__discover" :to="lp('/')">{{ $t('library.discover') }} <AccountIcon name="arrow" /></RouterLink></header>
    <nav class="library__tabs" :inert="locked" :aria-label="$t('library.title')"><RouterLink v-for="item in tabs" :key="item" :to="{ path: lp('/library'), query: { tab: item } }" :aria-current="tab === item ? 'page' : undefined" :class="{ 'library__tab--on': tab === item }">{{ $t(`library.${item}`) }}</RouterLink></nav>
    <div v-if="!managing" class="library__context"><p class="muted">{{ $t(`library.${tab}Hint`) }}</p><button v-if="tab==='conversations'&&!loading&&chats.length" class="btn btn--sm library__manage" :disabled="locked" @click="managing=true"><AccountIcon name="manage" />{{ $t('library.manage.manage') }}</button></div>
    <div v-else class="library__toolbar">
      <button class="btn btn--ghost library__all" :disabled="locked||loading" @click="selectAll">{{ $t(allSelected?'library.manage.clearAll':'library.manage.selectAll') }}</button>
      <span class="library__count" role="status" aria-live="polite"><span v-if="selected.length">{{ $t('library.manage.selectedCount',{n:selected.length},selected.length) }}</span><span v-else class="library__touch-hint">{{ $t('library.manage.selectHint') }}</span></span>
      <span class="library__keys subtle">{{ $t('library.manage.keysHint') }}</span>
      <button class="btn library__danger library__desktop-delete" data-delete-selected :disabled="!selected.length||locked" @click="remove()"><AccountIcon name="trash" />{{ $t('library.manage.deleteN',{n:selected.length},selected.length) }}</button>
      <button class="btn btn--sm library__done" :disabled="locked" @click="finish">{{ $t('library.manage.done') }}</button>
    </div>
    <div v-if="failedCount" class="notice notice--error library__failure" role="alert"><p>{{ $t(pendingResult?'library.manage.resultPending':'library.manage.partialBanner',{n:failedCount},failedCount) }}</p><button class="btn" :disabled="locked||!selected.length" @click="remove()">{{ $t('library.retry') }}</button></div>
    <div v-if="failed" class="empty panel" role="alert"><p class="empty__title">{{ $t('library.loadFailed') }}</p><button class="btn" @click="load()">{{ $t('library.retry') }}</button></div>
    <CardGrid v-else-if="tab === 'favorites' && loading" :cards="[]" loading />
    <FavoriteGrid v-else-if="tab === 'favorites' && !empty" :items="cards" @removed="removedFavorite" />
    <div v-else-if="loading" class="library__rows" aria-hidden="true"><div v-for="n in 4" :key="n" class="ghost library__ghost" /></div>
    <div v-else-if="empty" class="empty panel library__empty"><MascotSay src="/mascot/chuchu-sleep.webp" :size="132" /><h2 class="empty__title">{{ $t(`library.${tab}Empty`) }}</h2><p class="empty__hint muted">{{ $t(`library.${tab}Hint`) }}</p><RouterLink class="btn" :to="lp('/')">{{ $t('library.discover') }}</RouterLink></div>
    <ConversationRows v-else-if="tab==='conversations'" :chats="chats" :managing="managing" v-model:selected="selected" :locked="locked" :errors="errors" @remove="chat=>remove([chat])" />
    <div v-else class="library__authors">
      <article v-for="author in authors" :key="author.handle" class="followed panel"><RouterLink class="followed__identity" :to="lp(`/authors/${author.handle}`)"><img v-if="author.avatar" :src="author.avatar" alt="" /><span v-else class="mono" :style="{ '--h': hueFrom(author.name) }">{{ [...author.name][0] }}</span><div><h2>{{ author.name }}</h2><p class="muted">{{ author.bio || $t('library.authorHint') }}</p></div></RouterLink><LibraryToggle kind="following" :target="author.handle" :initial-active="true" /></article>
    </div>
    <nav v-if="!loading && !failed && (page > 1 || hasNext)" class="pager" :aria-label="$t('library.title')"><button class="btn" :disabled="page === 1||locked" @click="navigate(tab, page - 1)">{{ $t('pager.prev') }}</button><span class="muted">{{ $t('pager.page', { n: page }) }}</span><button class="btn" :disabled="!hasNext||locked" @click="navigate(tab, page + 1)">{{ $t('pager.next') }}</button></nav>
    <div v-if="managing" class="library__bottom"><button class="btn btn--lg library__danger" :disabled="!selected.length||locked" @click="remove()"><AccountIcon name="trash" />{{ $t('library.manage.deleteN',{n:selected.length},selected.length) }}</button></div>
    <p v-if="toast" class="toast" role="status">{{ toast }}</p>
  </div>
</template>
<style scoped>
.library { max-width: 1120px; }
.library__header { display:flex; align-items:center; justify-content:space-between; gap:var(--s-5); padding-block:var(--s-5) var(--s-6); }
.library__header h1 { font-size:clamp(1.75rem, 4vw, 2.25rem); margin-block:var(--s-2); }
.library__header p { max-width:48ch; }
.library__discover { flex:none; min-height:44px; }
.library__tabs { display:flex; gap:var(--s-5); border-bottom:1px solid var(--border); }
.library__tabs a { display:flex; align-items:center; min-height:48px; padding:var(--s-3) var(--s-1); font-weight:600; color:var(--text-2); border-bottom:2px solid transparent; text-align:center; }
.library__tabs .library__tab--on { color:var(--accent-text); border-color:var(--accent); }
.library__context { display:flex; align-items:center; gap:var(--s-3); justify-content:space-between; padding-block:var(--s-5); font-size:14px; }
.library__context p { min-width:0; }
.library__manage,.library__done { flex:none; position:relative; }
.library__toolbar { position:sticky; top:var(--header-h); z-index:12; display:flex; align-items:center; gap:var(--s-3); min-height:72px; padding-block:var(--s-3); background:var(--bg); border-bottom:1px solid var(--line); margin-bottom:var(--s-3); }
.library__toolbar .btn { min-height:var(--h-md); }
.library__all { color:var(--accent-text); white-space:nowrap; }
.library__count { flex:none; font-size:14px; }
.library__keys { flex:1; text-align:right; }
.library__danger { color:var(--danger); border-color:color-mix(in srgb,var(--danger) 55%,transparent); white-space:nowrap; }
.library__danger:hover:not(:disabled) { color:var(--danger); background:color-mix(in srgb,var(--danger) 10%,transparent); }
.library__touch-hint { display:none; }
.library__bottom { display:none; }
.library__failure { display:flex; align-items:center; justify-content:space-between; gap:var(--s-3); margin-bottom:var(--s-4); }
.library__failure p { overflow-wrap:anywhere; }
.library__failure .btn { flex:none; }
.library__provider { padding:var(--s-1) var(--s-3); border:1px solid var(--border); border-radius:var(--r-pill); color:var(--text-2); }
.library__rows { display:grid; gap:var(--s-3); }
.library__ghost { min-height:112px; border-radius:var(--r-lg); }
.followed h2 { font-size:1rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.library__authors { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--s-4); }
.followed { min-width:0; display:flex; align-items:center; justify-content:space-between; gap:var(--s-4); padding:var(--s-5); }
.followed__identity { display:flex; align-items:center; gap:var(--s-3); min-width:0; flex:1; }
.followed__identity > img,.followed__identity > span { width:48px; height:48px; border-radius:var(--r-pill); object-fit:cover; flex:none; }
.followed__identity div { min-width:0; }
.followed__identity p { font-size:.875rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:var(--s-1); }
.library__empty { display:grid; justify-items:center; gap:var(--s-3); padding:var(--s-7) var(--s-5); }
.empty .btn { min-height:44px; margin-top:var(--s-3); }
@media(max-width:700px) {
  .library__header { align-items:flex-start; } .library__discover { display:none; } .library__tabs { gap:var(--s-4); } .library__tabs a { flex:1; justify-content:center; } .library__authors { grid-template-columns:minmax(0,1fr); }
  .library__context p { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
  .library__manage::after { content:''; position:absolute; inset:-7px 0; }
  .library__toolbar { gap:var(--s-2); min-height:64px; }
  .library__toolbar .btn { min-height:var(--h-lg); min-width:var(--h-lg); padding-inline:var(--s-2); }
  .library__count { flex:1; min-width:0; text-align:center; font-size:13px; }
  .library__touch-hint { display:block; font-size:12px; overflow-wrap:anywhere; }
  .library__keys,.library__desktop-delete { display:none; }
  .library__bottom { display:flex; position:fixed; bottom:0; left:0; right:0; z-index:15; padding:var(--s-3) max(var(--s-4),env(safe-area-inset-right)) calc(var(--s-3) + env(safe-area-inset-bottom)) max(var(--s-4),env(safe-area-inset-left)); border-top:1px solid var(--line); background:color-mix(in srgb,var(--bg) 84%,transparent); backdrop-filter:blur(16px) saturate(1.2); -webkit-backdrop-filter:blur(16px) saturate(1.2); }
  .library__bottom .btn { flex:1; }
  .library--manage { padding-bottom:calc(88px + env(safe-area-inset-bottom)); }
}
:lang(ko) .library__failure,:lang(ko) .library__count { word-break:keep-all; }
:lang(ja) .library__failure,:lang(ja) .library__count { word-break:auto-phrase; }
</style>
