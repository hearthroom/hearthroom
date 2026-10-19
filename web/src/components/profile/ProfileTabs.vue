<script setup lang="ts">
/**
 * 主頁分區。「作品」只放已發布的卡——就是訪客看到的樣子；草稿、審核、額度、編輯都留在「我的卡片」
 * （owner 2026-10-19：主頁不是第二個我的卡片）。收藏、最近對話、關注只有自己看得到，標一把鎖。
 * 分區與頁碼記在網址上（?tab=&page=），重新整理或分享連結都回到同一個位置。
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import AccountIcon from '@/components/AccountIcon.vue';
import CardGrid from '@/components/CardGrid.vue';
import BadgeWall from '@/components/BadgeWall.vue';
import CoverImg from '@/components/CoverImg.vue';
import LibraryToggle from '@/components/LibraryToggle.vue';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { can } from '@/lib/provider';
import { fetchBoard } from '@/lib/api';
import { fetchConversations, libraryRequest, type ConversationSummary } from '@/lib/library';
import { platformPath } from '@/lib/connection-ui';
import { displayName } from '@/lib/display-name';
import { contentLang } from '@/lib/i18n';
import { hueFrom, relativeTime } from '@/lib/format';
import type { CommunityCard } from '@/lib/types';
import type { BadgeCollection } from '../../../../shared/community-badges';

const props = defineProps<{ badges: BadgeCollection | null; counts: { works: number | null; following: number | null } }>();
const session = useSession();
const route = useRoute(), router = useRouter();
const { lp, locale } = useLocalePath();
const { t } = useI18n();

const TABS = ['works', 'saved', 'recent', 'following', 'badges'] as const;
type Tab = (typeof TABS)[number];
const PRIVATE: Tab[] = ['saved', 'recent', 'following'];
const tab = computed<Tab>(() => (TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'works'));
const page = computed(() => Math.max(1, Math.floor(Number(route.query.page) || 1)));
const sort = computed(() => (route.query.sort === 'hot' ? 'hot' : 'new'));
/** 作品頁第一格放「建立新卡」，一頁 23 張卡＋它＝24 格，欄數 2／3／4／6 都排得滿 */
const WORKS_PAGE = 23, LIST_PAGE = 24;
const count = (k: Tab) => (k === 'works' ? props.counts.works : k === 'following' ? props.counts.following : k === 'badges' ? props.badges?.items.filter((b) => b.state === 'earned').length ?? null : null);
function go(next: Partial<{ tab: Tab; page: number; sort: 'new' | 'hot' }>) {
  const nextTab = next.tab ?? tab.value;
  // 換分區就回第一頁、排序回預設；只在作品分區記排序
  const nextSort = nextTab === 'works' ? next.sort ?? (next.tab && next.tab !== tab.value ? 'new' : sort.value) : 'new';
  const nextPage = next.page ?? 1;
  void router.replace({ query: { ...route.query, tab: nextTab === 'works' ? undefined : nextTab, page: nextPage > 1 ? String(nextPage) : undefined, sort: nextSort === 'hot' ? 'hot' : undefined } });
  // 切分區不動捲動位置（路由 keepScrollOnQuery）；翻頁時分頁鈕在底下，捲回分區列的頂端，但已經看得到就不動
  if (next.page && area.value && area.value.getBoundingClientRect().top < 0) area.value.scrollIntoView({ block: 'start' });
}
const area = ref<HTMLElement | null>(null);
defineExpose({ go });

const cards = ref<CommunityCard[]>([]), chats = ref<ConversationSummary[]>([]);
const authors = ref<{ handle: string; name: string; avatar: string; bio: string }[]>([]);
const loading = ref(true), failed = ref(false), hasNext = ref(false), total = ref<number | null>(null);
let sequence = 0;
async function load() {
  const seq = ++sequence;
  loading.value = true; failed.value = false; hasNext.value = false;
  try {
    const handle = session.profile?.handle;
    if (tab.value === 'badges') return;
    if (tab.value === 'works') {
      if (!handle) return;
      const result = await fetchBoard({ author: handle, sort: sort.value, limit: WORKS_PAGE, offset: (page.value - 1) * WORKS_PAGE });
      if (seq === sequence) { cards.value = result.items; hasNext.value = result.hasNext; total.value = result.total; }
      return;
    }
    const token = await session.accessToken();
    if (!token) throw new Error('auth');
    if (tab.value === 'recent') {
      const result = await fetchConversations(token, contentLang(locale.value), page.value);
      if (seq === sequence) { chats.value = result.conversations; hasNext.value = result.hasNextPage; }
    } else {
      const kind = tab.value === 'saved' ? 'favorites' : 'following';
      const result = await libraryRequest<{ items: CommunityCard[] | typeof authors.value; hasNext: boolean }>(`${kind}?offset=${(page.value - 1) * LIST_PAGE}&lang=${contentLang(locale.value)}`, token);
      if (seq === sequence) { if (kind === 'favorites') cards.value = result.items as CommunityCard[]; else authors.value = result.items as typeof authors.value; hasNext.value = result.hasNext; }
    }
  } catch { if (seq === sequence) failed.value = true; }
  finally { if (seq === sequence) loading.value = false; }
}
watch([tab, page, sort, locale, () => session.profile?.handle], load, { immediate: true });
const time = (chat: ConversationSummary) => { const v = Date.parse(chat.lastChatTime || chat.createTime || ''); return Number.isFinite(v) ? relativeTime(v) : ''; };
const range = computed(() => (tab.value === 'works' && total.value !== null
  ? t('pager.pageOf', { n: page.value, total: Math.max(1, Math.ceil(total.value / WORKS_PAGE)) })
  : t('pager.page', { n: page.value })));
const createTo = computed(() => lp(can('editor') ? '/create' : '/mine'));
</script>

<template>
  <section ref="area" class="tabs-area" :aria-label="$t('profile.tabs.label')">
    <div role="tablist" class="tabbar" :aria-label="$t('profile.tabs.label')">
      <button v-for="k in TABS" :key="k" role="tab" type="button" class="tab" :class="{ 'tab--on': tab === k }" :aria-selected="tab === k" @click="go({ tab: k })">
        <span class="tab__icon"><AccountIcon :name="k === 'works' ? 'cards' : k === 'saved' ? 'heart' : k === 'recent' ? 'chat' : k === 'following' ? 'users' : 'spark'" /></span>
        {{ $t('profile.tabs.' + k) }}
        <span v-if="count(k) !== null" class="tab__count">{{ count(k) }}</span>
        <AccountIcon v-if="PRIVATE.includes(k)" name="lock" class="tab__lock" :aria-label="$t('profile.onlyYou')" :title="$t('profile.onlyYou')" />
      </button>
    </div>

    <template v-if="tab === 'works'">
      <div class="toolbar">
        <span class="toolbar__hint"><AccountIcon name="eye" /><span>{{ $t('profile.worksHint') }}</span></span>
        <div class="seg" role="radiogroup" :aria-label="$t('profile.sortNew')">
          <button type="button" role="radio" class="seg__item" :class="{ 'seg__item--on': sort === 'new' }" :aria-checked="sort === 'new'" @click="go({ sort: 'new' })">{{ $t('profile.sortNew') }}</button>
          <button type="button" role="radio" class="seg__item" :class="{ 'seg__item--on': sort === 'hot' }" :aria-checked="sort === 'hot'" @click="go({ sort: 'hot' })">{{ $t('profile.sortHot') }}</button>
        </div>
        <RouterLink :to="lp('/mine')" class="btn btn--sm toolbar__manage">{{ $t('profile.manageCards') }}<AccountIcon name="arrow" /></RouterLink>
      </div>
      <p v-if="failed" class="notice notice--error" role="alert">{{ $t('library.loadFailed') }} <button class="btn btn--sm" @click="load">{{ $t('library.retry') }}</button></p>
      <div v-else class="works">
        <CardGrid :cards="cards" :loading="loading && !cards.length" :busy="loading" :empty-title="$t('profile.worksEmpty')" :empty-hint="$t('profile.worksEmptyHint')">
          <template #lead>
            <RouterLink :to="createTo" class="create"><span class="create__plus"><AccountIcon name="plus" /></span><strong>{{ $t('profile.createCard') }}</strong><span>{{ $t('profile.createHint') }}</span></RouterLink>
          </template>
        </CardGrid>
      </div>
    </template>

    <template v-else-if="tab === 'badges'">
      <div class="toolbar"><span class="toolbar__hint">{{ $t('badgeWall.title') }}</span><RouterLink :to="lp('/me/badges')" class="btn btn--sm toolbar__manage">{{ $t('profile.manageBadges') }}<AccountIcon name="arrow" /></RouterLink></div>
      <BadgeWall v-if="badges" :items="badges.items" :selected="badges.featured" />
      <div v-else class="ghost rows-ghost" aria-hidden="true" />
    </template>

    <template v-else>
      <p class="toolbar toolbar__hint"><AccountIcon name="lock" /><span>{{ $t('profile.onlyYou') }} · {{ $t(`library.${tab === 'saved' ? 'favorites' : tab === 'recent' ? 'conversations' : 'following'}Hint`) }}</span></p>
      <p v-if="failed" class="notice notice--error" role="alert">{{ $t('library.loadFailed') }} <button class="btn btn--sm" @click="load">{{ $t('library.retry') }}</button></p>
      <CardGrid v-else-if="tab === 'saved'" :cards="cards" :loading="loading && !cards.length" :busy="loading" :empty-title="$t('library.favoritesEmpty')" :empty-hint="$t('library.favoritesHint')" />
      <div v-else-if="loading" class="rows" aria-hidden="true"><div v-for="n in 4" :key="n" class="ghost rows-ghost" /></div>
      <div v-else-if="tab === 'recent' ? !chats.length : !authors.length" class="empty panel"><p class="empty__title">{{ $t(`library.${tab === 'recent' ? 'conversations' : 'following'}Empty`) }}</p><RouterLink class="btn" :to="lp('/')">{{ $t('library.discover') }}</RouterLink></div>
      <div v-else-if="tab === 'recent'" class="rows">
        <a v-for="chat in chats" :key="`${chat.provider}:${chat.conversationRoleId}`" :href="platformPath(lp(`/play/${encodeURIComponent(chat.cardNumber ?? chat.conversationRoleId)}?resume=${encodeURIComponent(chat.conversationId)}`), chat.provider)" class="row panel">
          <CoverImg v-if="chat.roleAvatar" class="row__avatar" :src="chat.roleAvatar" loading="lazy" /><span v-else class="row__avatar mono" :style="{ '--h': hueFrom(chat.roleName) }"><AccountIcon name="cards" /></span>
          <span class="row__body"><strong>{{ chat.conversationTitle || displayName(chat.roleName, locale) || $t('library.untitled') }}</strong><span v-if="chat.conversationTitle" class="muted">{{ displayName(chat.roleName, locale) }}</span></span>
          <time v-if="time(chat)" class="row__time">{{ time(chat) }}</time>
          <span class="btn btn--sm">{{ $t('library.resume') }}</span>
        </a>
      </div>
      <div v-else class="people">
        <article v-for="author in authors" :key="author.handle" class="person panel">
          <RouterLink class="person__who" :to="lp(`/authors/${author.handle}`)"><img v-if="author.avatar" :src="author.avatar" alt="" /><span v-else class="mono" :style="{ '--h': hueFrom(author.name) }">{{ [...author.name][0] }}</span><span><strong>{{ author.name }}</strong><span class="muted">{{ author.bio || $t('library.authorHint') }}</span></span></RouterLink>
          <LibraryToggle kind="following" :target="author.handle" :initial-active="true" />
        </article>
      </div>
    </template>

    <nav v-if="tab !== 'badges' && !loading && !failed && (page > 1 || hasNext)" class="pager" :aria-label="$t('profile.tabs.' + tab)">
      <button class="btn btn--sm" :disabled="page === 1" @click="go({ page: page - 1 })">← {{ $t('pager.prev') }}</button>
      <span class="subtle">{{ range }}</span>
      <button class="btn btn--sm" :disabled="!hasNext" @click="go({ page: page + 1 })">{{ $t('pager.next') }} →</button>
    </nav>
  </section>
</template>

<style scoped>
.tabs-area { scroll-margin-top: calc(var(--header-h) + 48px); display: grid; gap: var(--s-4); min-width: 0; }
.tabbar { position: sticky; top: calc(var(--header-h) + 8px); z-index: 3; display: flex; gap: 4px; padding: 6px; overflow-x: auto; border-radius: var(--r-lg); background: color-mix(in srgb, var(--surface-2) 84%, transparent); backdrop-filter: saturate(180%) blur(16px); box-shadow: 0 0 0 1px var(--line); scrollbar-width: none; container-type: inline-size; }
.tabbar::-webkit-scrollbar { display: none; }
.tab { display: inline-flex; flex: none; align-items: center; gap: 8px; height: 44px; padding: 0 14px 0 10px; border: 0; border-radius: var(--r-md); background: none; font: inherit; font-size: 14.5px; font-weight: 500; color: var(--text-2); white-space: nowrap; cursor: pointer; }
.tab:hover { background: color-mix(in srgb, var(--text) 5%, transparent); color: var(--text); }
.tab__icon { display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--r-sm); color: var(--text-3); }
.tab__icon svg { width: 15px; height: 15px; }
.tab--on { background: var(--surface); color: var(--text); font-weight: 650; box-shadow: 0 0 0 1px var(--line), 0 4px 12px -6px rgba(16, 16, 24, 0.25); }
.tab--on .tab__icon { background: var(--accent-grad); color: var(--on-accent); }
.tab__count { min-width: 22px; height: 20px; padding: 0 6px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--text) 7%, transparent); font-size: 12px; font-weight: 600; line-height: 20px; text-align: center; color: var(--text-3); font-variant-numeric: tabular-nums; }
.tab--on .tab__count { background: var(--accent-tint); color: var(--accent-text); }
.tab__lock { width: 12px !important; height: 12px !important; color: var(--text-3); }
@container (max-width: 720px) { .tab__icon { display: none; } .tab { padding: 0 12px; } }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); margin: 0; }
.toolbar__hint { display: inline-flex; flex: 1; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: var(--text-3); }
.toolbar__hint > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toolbar__hint svg { width: 15px; height: 15px; flex: none; }
.toolbar__manage svg { width: 14px; height: 14px; }
.seg { display: flex; flex: none; padding: 3px; border-radius: var(--r-pill); background: var(--surface-2); }
.seg__item { height: 28px; padding: 0 12px; border: 0; border-radius: var(--r-pill); background: none; font: inherit; font-size: 13px; color: var(--text-2); cursor: pointer; white-space: nowrap; }
.seg__item--on { background: var(--text); color: var(--surface); }
/* 主欄比整頁窄：照容器寬度排欄，不照視窗 */
.works :deep(.grid) { grid-template-columns: repeat(auto-fill, minmax(172px, 1fr)); }
.create { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-width: 0; min-height: 260px; padding: var(--s-4); border-radius: var(--r-md); text-align: center; color: var(--text-2); background: repeating-linear-gradient(135deg, transparent 0 10px, color-mix(in srgb, var(--accent) 4%, transparent) 10px 20px), color-mix(in srgb, var(--accent) 5%, var(--surface)); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 35%, transparent); }
.create:hover { box-shadow: inset 0 0 0 1.5px var(--accent), var(--shadow-md); }
.create__plus { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 16px; background: var(--accent-grad); color: var(--on-accent); }
.create__plus svg { width: 24px; height: 24px; }
.create strong { font-size: 15px; color: var(--text); }
.create span:last-child { font-size: 12px; line-height: 1.5; color: var(--text-3); }
.rows, .people { display: grid; gap: var(--s-3); }
.rows-ghost { height: 76px; border-radius: var(--r-md); }
.row { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) var(--s-4); color: inherit; }
.row__avatar { flex: none; width: 44px; height: 58px; border-radius: var(--r-sm); object-fit: cover; display: grid; place-items: center; }
.row__body { display: grid; gap: 2px; flex: 1; min-width: 0; }
.row__body strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row__time { font-size: 12px; color: var(--text-3); white-space: nowrap; }
.person { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) var(--s-4); }
.person__who { display: flex; align-items: center; gap: var(--s-3); flex: 1; min-width: 0; color: inherit; }
.person__who img, .person__who .mono { flex: none; width: 44px; height: 44px; border-radius: var(--r-pill); object-fit: cover; display: grid; place-items: center; }
.person__who > span:last-child { display: grid; min-width: 0; }
.person__who .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.empty { padding: var(--s-7) var(--s-5); text-align: center; }
.empty__title { margin-bottom: var(--s-3); font-weight: 600; }
.pager { display: flex; align-items: center; justify-content: center; gap: var(--s-4); }
@media (max-width: 700px) { .tabbar { top: calc(var(--header-h) + 4px); } .tab { height: 38px; } .works :deep(.grid) { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
