<script setup lang="ts">
/**
 * 社群管理的「部落格」：左邊是分組與欄目的樹（新增、編輯、排序、刪除），右邊是選取範圍裡的文章與「新文章」。
 * 只給本站應用的 owner／admin（HarperHarbor 團隊），服務端再判一次。選取放在網址查詢上（?group=／?column=），
 * 重新整理或從編輯器返回都還在原處。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import BlogColumnDialog from '@/components/BlogColumnDialog.vue';
import BlogColumnTree from '@/components/BlogColumnTree.vue';
import { ApiError } from '@/lib/api';
import {
  allColumns, columnName, deleteColumn, displayStatus, fetchAdminColumns, fetchAdminPosts, saveColumn,
  type AdminPostRow, type BlogColumn, type BlogGroup, type TreePick,
} from '@/lib/blog';
import { confirmDialog } from '@/lib/confirm';
import { dateTime } from '@/lib/format';
import { LOCALES, pageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';

const { t } = useI18n();
const session = useSession();
const route = useRoute();
const router = useRouter();
const { lp, locale } = useLocalePath();

/** 服務端一頁的筆數（blog.ts 的 PAGE_SIZE） */
const PAGE = 12;
const STATUSES = ['', 'draft', 'published', 'unpublished'] as const;
const status = ref<(typeof STATUSES)[number]>('');
const page = ref(1);
const items = ref<AdminPostRow[]>([]);
const total = ref(0);
const loading = ref(true);
const error = ref('');
/** 不是應用 owner／admin：整頁只說這一句（服務端回 blog_write_forbidden） */
const forbidden = ref(false);
const groups = ref<BlogGroup[]>([]);
const treeLoaded = ref(false);
/** 手機上欄目樹收合；點頂部的目前名稱展開 */
const treeOpen = ref(false);
const dialog = ref<{ kind: 'group' | 'column'; initial: BlogColumn | null; parentId: string | null } | null>(null);

const hasNext = computed(() => page.value * PAGE < total.value);
const columns = computed(() => allColumns(groups.value));
const allCount = computed(() => groups.value.reduce((n, g) => n + (g.postCount ?? 0), 0));
const localeLabel = (code: string) => LOCALES.find((l) => l.code === code)?.label ?? code;
const nameOf = (c: BlogColumn | undefined, fallback = '') => columnName(c, String(locale.value), fallback);
const fmt = (n = 0) => new Intl.NumberFormat(String(locale.value)).format(n);

const picked = computed<TreePick>(() => {
  const q = route.query;
  if (typeof q.column === 'string' && q.column) return { kind: 'column', id: q.column };
  if (typeof q.group === 'string' && q.group) return { kind: 'group', id: q.group };
  return { kind: 'all' };
});
const pickedId = computed(() => (picked.value.kind === 'all' ? '' : picked.value.id));
const pickedItem = computed(() => (picked.value.kind === 'group' ? groups.value.find((g) => g.id === pickedId.value)
  : picked.value.kind === 'column' ? columns.value.find((c) => c.id === pickedId.value) : undefined));
const heading = computed(() => {
  const item = pickedItem.value;
  if (!item) return t('blog.admin.allPosts');
  if (picked.value.kind === 'column') return `${nameOf(groups.value.find((g) => g.id === item.parentId))} › ${nameOf(item)}`;
  return nameOf(item);
});
const newPostTo = computed(() => lp(picked.value.kind === 'column' ? `/review/blog/new?column=${encodeURIComponent(pickedId.value)}` : '/review/blog/new'));

/** 新增欄目要掛在哪個分組：選了分組就是它，否則第一個 */
const emptyColumnParent = computed(() => (picked.value.kind === 'group' ? pickedId.value : groups.value[0]?.id ?? null));
/** 列表空的時候說明為什麼空、下一步做什麼：先建分組、再建欄目、篩選太窄、或直接寫一篇 */
const empty = computed<{ title?: string; text: string; action?: 'group' | 'column' | 'post' | 'all' }>(() => {
  if (!treeLoaded.value) return { text: t('blog.empty') };
  if (!groups.value.length) return { text: t('blog.admin.noGroups'), action: 'group' };
  const groupItem = picked.value.kind === 'group' ? groups.value.find((g) => g.id === pickedId.value) : undefined;
  if (!columns.value.length || (groupItem && !groupItem.columns.length)) return { text: t('blog.admin.noColumns'), action: 'column' };
  if (status.value) return { text: t('blog.admin.statusEmpty'), action: 'all' };
  if (picked.value.kind === 'column') return { text: t('blog.admin.columnEmpty'), action: 'post' };
  return { title: t('blog.empty'), text: t('blog.admin.pickColumnHint'), action: 'post' };
});

async function token() {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}
const fail = (e: unknown, fallback = 'state.loadFailed') => {
  if (e instanceof ApiError && e.code === 'blog_write_forbidden') forbidden.value = true;
  else error.value = e instanceof Error ? e.message : t(fallback);
};

let generation = 0;
async function load() {
  const gen = ++generation;
  loading.value = true; error.value = '';
  try {
    const p = picked.value;
    const filter = p.kind === 'column' ? { column: p.id } : p.kind === 'group' ? { group: p.id } : {};
    const res = await fetchAdminPosts(await token(), { status: status.value, page: page.value, ...filter });
    if (gen !== generation) return;
    items.value = res.items; total.value = res.total;
  } catch (e) { if (gen === generation) fail(e); } finally { if (gen === generation) loading.value = false; }
}
async function loadTree() {
  try { groups.value = (await fetchAdminColumns(await token())).items; } catch (e) { fail(e); } finally { treeLoaded.value = true; }
}

function pick(next: TreePick) {
  treeOpen.value = false;
  const query = next.kind === 'all' ? {} : { [next.kind]: next.id };
  void router.replace({ path: route.path, query });
}

function openDialog(kind: 'group' | 'column', initial: BlogColumn | null = null, parentId: string | null = null) {
  dialog.value = { kind, initial, parentId };
}
const nextSort = computed(() => {
  const d = dialog.value;
  if (!d) return 0;
  return d.kind === 'group' ? groups.value.length : (groups.value.find((g) => g.id === d.parentId)?.columns.length ?? 0);
});
async function saved() {
  dialog.value = null;
  await loadTree();
}

/** 上移／下移：在同一層裡換位置，再把這一層的 sort 依新順序重排（只送有變的） */
async function move(item: BlogColumn, dir: -1 | 1) {
  const siblings: BlogColumn[] = item.parentId === null ? groups.value : (groups.value.find((g) => g.id === item.parentId)?.columns ?? []);
  const order = [...siblings];
  const i = order.findIndex((x) => x.id === item.id), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j]!, order[i]!];
  error.value = '';
  try {
    const access = await token();
    for (const [sort, c] of order.entries()) {
      if (c.sort === sort) continue;
      await saveColumn(access, { id: c.id, slug: c.slug, name: c.name, description: c.description, sort, enabled: c.enabled, parentId: c.parentId }, crypto.randomUUID());
    }
  } catch (e) { fail(e, 'moderation.error.retry'); }
  await loadTree();
}

async function remove(item: BlogColumn, kind: 'group' | 'column') {
  const message = t(kind === 'group' ? 'blog.admin.deleteGroupConfirm' : 'blog.admin.deleteColumnConfirm', { name: nameOf(item) });
  if (!(await confirmDialog({ title: t('blog.admin.delete'), message, confirmText: t('blog.admin.delete'), danger: true }))) return;
  error.value = '';
  try {
    await deleteColumn(await token(), item.id, crypto.randomUUID());
    if (pickedId.value === item.id) pick({ kind: 'all' });
  } catch (e) { fail(e, 'moderation.error.retry'); }
  await loadTree();
}

function retry() { void load(); void loadTree(); }

watch([status, () => route.query.group, () => route.query.column], () => { page.value = 1; void load(); });
watch(page, () => { void load(); });
onMounted(() => { document.title = pageTitle(t('moderation.tab.blog')); void load(); void loadTree(); });
</script>

<template>
  <section v-if="forbidden" class="rblog" :aria-label="t('moderation.tab.blog')">
    <p class="panel rblog-forbidden muted" data-forbidden>{{ t('blog.admin.managersOnly') }}</p>
  </section>
  <section v-else class="rblog" :aria-label="t('moderation.tab.blog')">
    <aside class="panel rblog-side" :class="{ 'rblog-side--open': treeOpen }">
      <button type="button" class="rblog-side__toggle" :aria-expanded="treeOpen" @click="treeOpen = !treeOpen">
        <span class="rblog-side__current">{{ heading }}</span><span class="rblog-side__caret" aria-hidden="true">▾</span>
      </button>
      <BlogColumnTree :groups="groups" :picked="picked" :total="allCount"
                      @pick="pick" @add-group="openDialog('group')" @add-column="(id) => openDialog('column', null, id)"
                      @edit="(item, kind) => openDialog(kind, item, item.parentId)" @move="move" @remove="remove" />
    </aside>

    <div class="panel rblog-main">
      <!-- 標題跟左欄選取的是同一個名字：畫面上不重複，只留給螢幕閱讀器當這一區的名稱 -->
      <h2 class="sr-only">{{ heading }}</h2>
      <div class="rblog-bar">
        <div class="seg rblog-status">
          <button v-for="s in STATUSES" :key="s" type="button" class="seg__item" :class="{ 'seg__item--on': status === s }" :aria-pressed="status === s" @click="status = s">{{ s ? t(`blog.admin.status.${s}`) : t('blog.all') }}</button>
        </div>
        <div class="rblog-bar__end">
          <p v-if="treeLoaded && !columns.length" id="rblog-need-column" class="subtle rblog-hint">{{ t('blog.admin.needColumn') }}</p>
          <RouterLink v-if="columns.length" class="btn btn--primary rblog-new" :to="newPostTo" data-action="new-post">{{ t('blog.admin.new') }}</RouterLink>
          <span v-else class="btn btn--primary rblog-new" aria-disabled="true" :aria-describedby="treeLoaded ? 'rblog-need-column' : undefined" data-action="new-post">{{ t('blog.admin.new') }}</span>
        </div>
      </div>

      <p v-if="error" class="notice notice--error rblog-error" role="alert">{{ error }} <button class="btn btn--sm" :disabled="loading" @click="retry">{{ t('blog.retry') }}</button></p>

      <div class="rblog-list" :aria-busy="loading">
        <template v-if="loading && !items.length"><div v-for="n in 3" :key="n" class="rblog-ghost"><div class="ghost" /><div class="ghost" /></div></template>
        <div v-else-if="!items.length" class="rblog-empty">
          <p v-if="empty.title" class="rblog-empty__title">{{ empty.title }}</p>
          <p class="muted rblog-empty__text">{{ empty.text }}</p>
          <button v-if="empty.action === 'group'" type="button" class="btn btn--primary" @click="openDialog('group')">{{ t('blog.admin.newGroup') }}</button>
          <button v-else-if="empty.action === 'column'" type="button" class="btn btn--primary" @click="openDialog('column', null, emptyColumnParent)">{{ t('blog.admin.newColumn') }}</button>
          <RouterLink v-else-if="empty.action === 'post'" class="btn btn--primary" :to="newPostTo">{{ t('blog.admin.new') }}</RouterLink>
          <button v-else-if="empty.action === 'all'" type="button" class="btn" @click="status = ''">{{ t('blog.admin.showAll') }}</button>
        </div>
        <RouterLink v-for="p in items" :key="p.id" class="rblog-item" :to="lp(`/review/blog/${p.id}`)" :data-post="p.id">
          <div class="rblog-item__head">
            <span class="rblog-item__title">{{ p.title }}</span>
            <span class="rblog-item__chips">
              <span v-if="p.pinned" class="chip rblog-chip">{{ t('blog.admin.pinned') }}</span>
              <span class="chip rblog-chip" :class="`rblog-chip--${displayStatus(p)}`">{{ t(`blog.admin.status.${displayStatus(p)}`) }}</span>
            </span>
          </div>
          <p class="subtle rblog-item__meta">
            {{ nameOf(columns.find((c) => c.id === p.columnId), p.columnSlug) }} · {{ localeLabel(p.locale) }}
            <template v-if="p.publishAt"> · {{ t('blog.admin.publishedAt', { date: dateTime(p.publishAt) }) }}</template>
          </p>
          <p class="subtle rblog-item__meta">{{ t('blog.admin.lastEdit', { name: p.editorHandle || p.authorHandle, date: dateTime(p.updatedAt) }) }}</p>
          <p class="rblog-item__stats" data-stats>
            <span :title="t('blog.admin.statViews', { n: fmt(p.viewCount) })"><span class="sr-only">{{ t('blog.admin.statViews', { n: fmt(p.viewCount) }) }}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></svg><span aria-hidden="true">{{ fmt(p.viewCount) }}</span>
            </span>
            <span :title="t('blog.admin.statLikes', { n: fmt(p.likeCount) })"><span class="sr-only">{{ t('blog.admin.statLikes', { n: fmt(p.likeCount) }) }}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.6S2.5 10.2 2.5 6.4A2.9 2.9 0 0 1 8 4.9a2.9 2.9 0 0 1 5.5 1.5c0 3.8-5.5 7.2-5.5 7.2z" /></svg><span aria-hidden="true">{{ fmt(p.likeCount) }}</span>
            </span>
            <span :title="t('blog.admin.statComments', { n: fmt(p.commentCount) })"><span class="sr-only">{{ t('blog.admin.statComments', { n: fmt(p.commentCount) }) }}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" /></svg><span aria-hidden="true">{{ fmt(p.commentCount) }}</span>
            </span>
          </p>
        </RouterLink>
      </div>
      <div v-if="page > 1 || hasNext" class="rblog-pager">
        <button class="btn btn--sm" :disabled="page === 1 || loading" @click="page--">{{ t('moderation.previous') }}</button>
        <button class="btn btn--sm" :disabled="!hasNext || loading" @click="page++">{{ t('moderation.next') }}</button>
      </div>
    </div>

    <BlogColumnDialog v-if="dialog" :kind="dialog.kind" :groups="groups" :initial="dialog.initial" :parent-id="dialog.parentId" :next-sort="nextSort"
                      @close="dialog = null" @saved="saved" />
  </section>
</template>

<style scoped>
.rblog { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: var(--s-5); align-items: start; min-width: 0; }
/* 左欄自己捲動，長樹也用得了；「⋯」選單是固定定位，不會被這裡的 overflow 裁掉 */
.rblog-side { position: sticky; top: calc(var(--header-h) + var(--s-3)); padding: var(--s-2); max-height: calc(100vh - var(--header-h) - var(--s-6)); overflow-y: auto; overscroll-behavior: contain; }
/* 左欄是 sticky，自成一層：選單打開時把整欄抬到看板娘（z-index 45）之上，選單才不會被蓋住；仍低於彈窗與提示 */
.rblog-side:has(.btree__menu[open]) { z-index: 50; }
.rblog-side__toggle { display: none; }
.rblog-forbidden { margin: 0; padding: var(--s-5); grid-column: 1 / -1; }

/* 右邊是一整塊：上面一條工具列，底下一列一列的文章，分頁在最下面 */
.rblog-main { display: grid; min-width: 0; overflow: hidden; }
.rblog-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2) var(--s-3); flex-wrap: wrap; padding: var(--s-3) var(--s-4); border-bottom: 1px solid var(--line); }
.rblog-status { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.rblog-status::-webkit-scrollbar { display: none; }
.rblog-bar__end { display: flex; align-items: center; gap: var(--s-3); margin-inline-start: auto; min-width: 0; }
.rblog-hint { margin: 0; font-size: 13px; text-align: end; }
.rblog-new[aria-disabled='true'] { opacity: 0.5; pointer-events: none; }
.rblog-error { margin: var(--s-3) var(--s-4) 0; }

.rblog-list { display: grid; }
.rblog-ghost { display: grid; gap: var(--s-2); padding: var(--s-4); }
.rblog-ghost + .rblog-ghost { border-top: 1px solid var(--line); }
.rblog-ghost .ghost { height: 14px; width: 60%; border-radius: var(--r-sm); }
.rblog-ghost .ghost + .ghost { height: 12px; width: 36%; }

.rblog-empty { display: grid; justify-items: center; gap: var(--s-2); padding: var(--s-7) var(--s-5); text-align: center; }
.rblog-empty__title { font-size: 15px; font-weight: 600; color: var(--text); }
.rblog-empty__text { max-width: 36em; font-size: 14px; line-height: 1.6; }
.rblog-empty .btn { margin-top: var(--s-2); }

.rblog-item { display: grid; gap: var(--s-1); padding: var(--s-3) var(--s-4); color: var(--text); transition: background var(--dur) var(--ease); }
.rblog-item + .rblog-item { border-top: 1px solid var(--line); }
.rblog-item:hover { background: color-mix(in srgb, var(--surface-2) 60%, transparent); }
.rblog-item:focus-visible { outline-offset: -2px; }
.rblog-item:hover .rblog-item__title { color: var(--accent-text); }
.rblog-item__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
.rblog-item__title { font-weight: 600; min-width: 0; overflow-wrap: anywhere; transition: color var(--dur) var(--ease); }
.rblog-item__chips { display: flex; gap: var(--s-1); flex: none; }
.rblog-item__meta { margin: 0; font-size: 13px; }
.rblog-item__stats { display: flex; gap: var(--s-3); margin: 0; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.rblog-item__stats span { display: inline-flex; align-items: center; gap: var(--s-1); }
.rblog-item__stats svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linejoin: round; }
.rblog-chip { height: 22px; padding: 0 var(--s-2); cursor: default; }
.rblog-chip:hover { color: var(--text-2); background: var(--surface-2); }
.rblog-chip--published, .rblog-chip--published:hover { color: var(--success); background: var(--success-soft); }
.rblog-chip--scheduled, .rblog-chip--scheduled:hover { color: var(--accent-text); background: var(--accent-tint); }
.rblog-pager { display: flex; justify-content: center; gap: var(--s-2); padding: var(--s-3); border-top: 1px solid var(--line); }

@media (max-width: 767px) {
  .rblog { grid-template-columns: minmax(0, 1fr); gap: var(--s-3); }
  .rblog-side { position: static; max-height: none; overflow: visible; padding: var(--s-1); }
  .rblog-side--open { padding-bottom: var(--s-2); }
  .rblog-side__toggle { display: flex; width: 100%; min-height: 44px; align-items: center; justify-content: space-between; gap: var(--s-2); padding: 0 var(--s-3); border: 0; border-radius: var(--r-md); background: transparent; color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
  .rblog-side__current { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rblog-side__caret { flex: none; color: var(--text-3); transition: transform var(--dur) var(--ease); }
  .rblog-side--open .rblog-side__caret { transform: rotate(180deg); }
  .rblog-side--open .rblog-side__toggle { margin-bottom: var(--s-1); }
  .rblog-side:not(.rblog-side--open) :deep(.btree) { display: none; }
  .rblog-bar { padding: var(--s-3); }
  .rblog-bar__end { flex: 1 1 100%; justify-content: space-between; }
  .rblog-hint { text-align: start; }
  .rblog-bar .btn { min-height: 44px; }
  .rblog-bar__end .rblog-new { margin-inline-start: auto; }
  .rblog-item { padding: var(--s-3); }
  .rblog-item__head { align-items: flex-start; }
}
</style>
