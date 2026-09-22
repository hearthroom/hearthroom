<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { fetchConversations, libraryRequest, type ConversationSummary } from '@/lib/library';
import { platformPath } from '@/lib/connection-ui';
import { contentLang, pageTitle } from '@/lib/i18n';
import { hueFrom, relativeTime } from '@/lib/format';
import type { CommunityCard } from '@/lib/types';
import CardGrid from '@/components/CardGrid.vue';
import LibraryToggle from '@/components/LibraryToggle.vue';
import AccountIcon from '@/components/AccountIcon.vue';
const session = useSession();
const route = useRoute(), router = useRouter();
const { locale, lp } = useLocalePath();
const { t } = useI18n();
const tabs = ['conversations', 'favorites', 'following'] as const;
const tab = computed(() => tabs.includes(route.query.tab as typeof tabs[number]) ? route.query.tab as typeof tabs[number] : 'conversations');
const page = computed(() => Math.max(1, Math.floor(Number(route.query.page) || 1)));
const chats = ref<ConversationSummary[]>([]), cards = ref<CommunityCard[]>([]);
const authors = ref<{ handle: string; name: string; avatar: string; bio: string }[]>([]);
const loading = ref(true), failed = ref(false), hasNext = ref(false);
let sequence = 0;
async function load() {
  const seq = ++sequence;
  loading.value = true; failed.value = false; chats.value = []; cards.value = []; authors.value = []; hasNext.value = false;
  document.title = pageTitle(t('library.title'));
  try {
    const token = await session.accessToken();
    if (!token) throw new Error('auth');
    if (tab.value === 'conversations') {
      const result = await fetchConversations(token, contentLang(locale.value), page.value);
      if (seq === sequence) { chats.value = result.conversations; hasNext.value = result.hasNextPage; }
    } else {
      const result = await libraryRequest<{ items: CommunityCard[] | typeof authors.value; hasNext: boolean }>(`${tab.value}?offset=${(page.value - 1) * 24}&lang=${contentLang(locale.value)}`, token);
      if (seq === sequence) { if (tab.value === 'favorites') cards.value = result.items as CommunityCard[]; else authors.value = result.items as typeof authors.value; hasNext.value = result.hasNext; }
    }
  } catch { if (seq === sequence) failed.value = true; }
  finally { if (seq === sequence) loading.value = false; }
}
function navigate(next: string, n = 1) { void router.push({ query: { tab: next, ...(n > 1 ? { page: String(n) } : {}) } }); }
const empty = computed(() => !chats.value.length && !cards.value.length && !authors.value.length);
const time = (chat: ConversationSummary) => { const value = Date.parse(chat.lastChatTime || chat.createTime || ''); return Number.isFinite(value) ? relativeTime(value) : ''; };
watch([tab, page, locale, () => session.me, () => session.profile?.showNsfw, () => session.profile?.hiddenTags?.join(',')], load, { immediate: true });
</script>
<template>
  <div class="page library">
    <header class="library__header"><div><p class="eyebrow">{{ $t('library.eyebrow') }}</p><h1 class="display">{{ $t('library.title') }}</h1><p class="muted">{{ $t('library.hint') }}</p></div><RouterLink class="btn library__discover" :to="lp('/')">{{ $t('library.discover') }} <AccountIcon name="arrow" /></RouterLink></header>
    <nav class="library__tabs" :aria-label="$t('library.title')"><RouterLink v-for="item in tabs" :key="item" :to="{ path: lp('/library'), query: { tab: item } }" :aria-current="tab === item ? 'page' : undefined" :class="{ 'library__tab--on': tab === item }">{{ $t(`library.${item}`) }}</RouterLink></nav>
    <div class="library__context"><p class="muted">{{ $t(`library.${tab}Hint`) }}</p></div>
    <div v-if="failed" class="empty panel" role="alert"><p class="empty__title">{{ $t('library.loadFailed') }}</p><button class="btn" @click="load">{{ $t('library.retry') }}</button></div>
    <CardGrid v-else-if="tab === 'favorites' && (loading || !empty)" :cards="cards" :loading="loading" />
    <div v-else-if="loading" class="library__rows" aria-hidden="true"><div v-for="n in 4" :key="n" class="ghost library__ghost" /></div>
    <div v-else-if="empty" class="empty panel library__empty"><span class="library__empty-icon"><AccountIcon :name="tab === 'conversations' ? 'calendar' : tab === 'favorites' ? 'cards' : 'folder'" /></span><h2 class="empty__title">{{ $t(`library.${tab}Empty`) }}</h2><p class="empty__hint muted">{{ $t(`library.${tab}Hint`) }}</p><RouterLink class="btn" :to="lp('/')">{{ $t('library.discover') }}</RouterLink></div>
    <div v-else-if="tab === 'conversations'" class="library__rows">
      <a v-for="chat in chats" :key="`${chat.provider}:${chat.conversationRoleId}`" :href="platformPath(lp(`/play/${encodeURIComponent(chat.cardNumber ?? chat.conversationRoleId)}?resume=${encodeURIComponent(chat.conversationId)}`), chat.provider)" class="conversation panel">
        <img v-if="chat.roleAvatar" class="conversation__avatar" :src="chat.roleAvatar" alt="" loading="lazy" /><span v-else class="conversation__avatar mono" :style="{ '--h': hueFrom(chat.roleName) }"><AccountIcon name="cards" /></span>
        <div class="conversation__body"><div class="conversation__heading"><h2>{{ chat.conversationTitle || chat.roleName || $t('library.untitled') }}</h2><time v-if="time(chat)" :datetime="chat.lastChatTime || chat.createTime">{{ time(chat) }}</time></div><p v-if="chat.conversationTitle" class="conversation__role muted">{{ chat.roleName }}</p><p class="conversation__preview muted">{{ $t('library.resumeHint') }}</p></div>
        <span class="conversation__continue">{{ $t('library.resume') }} <AccountIcon name="arrow" /></span>
      </a>
    </div>
    <div v-else class="library__authors">
      <article v-for="author in authors" :key="author.handle" class="followed panel"><RouterLink class="followed__identity" :to="lp(`/authors/${author.handle}`)"><img v-if="author.avatar" :src="author.avatar" alt="" /><span v-else class="mono" :style="{ '--h': hueFrom(author.name) }">{{ [...author.name][0] }}</span><div><h2>{{ author.name }}</h2><p class="muted">{{ author.bio || $t('library.authorHint') }}</p></div></RouterLink><LibraryToggle kind="following" :target="author.handle" :initial-active="true" /></article>
    </div>
    <nav v-if="!loading && !failed && (page > 1 || hasNext)" class="pager" :aria-label="$t('library.title')"><button class="btn" :disabled="page === 1" @click="navigate(tab, page - 1)">{{ $t('pager.prev') }}</button><span class="muted">{{ $t('pager.page', { n: page }) }}</span><button class="btn" :disabled="!hasNext" @click="navigate(tab, page + 1)">{{ $t('pager.next') }}</button></nav>
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
.library__context { display:flex; align-items:center; flex-wrap:wrap; gap:var(--s-3); justify-content:space-between; padding-block:var(--s-5); font-size:.875rem; }
.library__provider { padding:var(--s-1) var(--s-3); border:1px solid var(--border); border-radius:var(--r-pill); color:var(--text-2); }
.library__rows { display:grid; gap:var(--s-3); }
.library__ghost { min-height:112px; border-radius:var(--r-lg); }
.conversation { display:flex; align-items:center; gap:var(--s-4); padding:var(--s-4); min-width:0; }
.conversation:hover { border-color:var(--border-strong); }
.conversation__avatar { width:72px; height:80px; border-radius:var(--r-sm); object-fit:cover; flex:none; display:grid; place-items:center; }
.conversation__body { flex:1; min-width:0; }
.conversation__heading { display:flex; align-items:baseline; justify-content:space-between; gap:var(--s-3); }
.conversation h2,.followed h2 { font-size:1rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.conversation time { color:var(--text-3); font-size:.8125rem; white-space:nowrap; }
.conversation__role { font-size:.8125rem; margin-top:var(--s-1); }
.conversation__preview { margin-top:var(--s-2); overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; font-size:.875rem; overflow-wrap:anywhere; }
.conversation__continue { display:flex; align-items:center; gap:var(--s-2); color:var(--accent-text); font-size:.875rem; flex:none; }
.library__authors { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--s-4); }
.followed { min-width:0; display:flex; align-items:center; justify-content:space-between; gap:var(--s-4); padding:var(--s-5); }
.followed__identity { display:flex; align-items:center; gap:var(--s-3); min-width:0; flex:1; }
.followed__identity > img,.followed__identity > span { width:48px; height:48px; border-radius:var(--r-pill); object-fit:cover; flex:none; }
.followed__identity div { min-width:0; }
.followed__identity p { font-size:.875rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:var(--s-1); }
.library__empty { display:grid; justify-items:center; gap:var(--s-3); padding:var(--s-7) var(--s-5); }
.library__empty-icon { display:grid; place-items:center; width:64px; height:64px; border-radius:var(--r-lg); background:var(--surface-2); color:var(--text-3); margin-bottom:var(--s-2); }
.empty .btn { min-height:44px; margin-top:var(--s-3); }
@media(max-width:700px) { .library__header { align-items:flex-start; } .library__discover { display:none; } .library__tabs { gap:var(--s-4); } .library__tabs a { flex:1; justify-content:center; } .library__authors { grid-template-columns:minmax(0,1fr); } .conversation__continue { display:none; } .conversation__heading { display:block; } .conversation time { display:block; margin-top:var(--s-1); } .conversation__avatar { width:56px; height:72px; } }
</style>
