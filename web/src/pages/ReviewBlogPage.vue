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
    <p class="panel rblog-empty muted" data-forbidden>{{ t('blog.admin.managersOnly') }}</p>
  </section>
  <section v-else class="rblog" :aria-label="t('moderation.tab.blog')">
    <aside class="panel rblog-side" :class="{ 'rblog-side--open': treeOpen }">
      <button type="button" class="rblog-side__toggle" :aria-expanded="treeOpen" @click="treeOpen = !treeOpen">
        <span>{{ heading }}</span><span aria-hidden="true">▾</span>
      </button>
      <BlogColumnTree :groups="groups" :picked="picked" :total="allCount"
                      @pick="pick" @add-group="openDialog('group')" @add-column="(id) => openDialog('column', null, id)"
                      @edit="(item, kind) => openDialog(kind, item, item.parentId)" @move="move" @remove="remove" />
    </aside>

    <div class="rblog-main">
      <div class="rblog-bar">
        <h2 class="rblog-heading">{{ heading }}</h2>
        <RouterLink v-if="columns.length" class="btn btn--primary rblog-new" :to="newPostTo" data-action="new-post">{{ t('blog.admin.new') }}</RouterLink>
        <span v-else class="btn btn--primary rblog-new" aria-disabled="true" data-action="new-post">{{ t('blog.admin.new') }}</span>
      </div>
      <p v-if="treeLoaded && !columns.length" class="subtle rblog-hint">{{ t('blog.admin.needColumn') }}</p>
      <div class="seg rblog-status">
        <button v-for="s in STATUSES" :key="s" type="button" class="seg__item" :class="{ 'seg__item--on': status === s }" :aria-pressed="status === s" @click="status = s">{{ s ? t(`blog.admin.status.${s}`) : t('blog.all') }}</button>
      </div>

      <p v-if="error" class="notice notice--error" role="alert">{{ error }} <button class="btn btn--sm" :disabled="loading" @click="retry">{{ t('blog.retry') }}</button></p>

      <div class="rblog-list" :aria-busy="loading">
        <template v-if="loading && !items.length"><div v-for="n in 3" :key="n" class="ghost rblog-ghost" /></template>
        <div v-else-if="treeLoaded && !groups.length" class="panel rblog-empty">
          <p class="muted">{{ t('blog.admin.noGroups') }}</p>
          <button type="button" class="btn btn--primary" @click="openDialog('group')">{{ t('blog.admin.newGroup') }}</button>
        </div>
        <p v-else-if="!items.length" class="panel rblog-empty muted">{{ picked.kind === 'column' ? t('blog.admin.columnEmpty') : t('blog.empty') }}</p>
        <RouterLink v-for="p in items" :key="p.id" class="panel rblog-item" :to="lp(`/review/blog/${p.id}`)" :data-post="p.id">
          <div class="rblog-item__head">
            <span class="rblog-item__title">{{ p.title }}</span>
            <span class="rblog-item__chips">
              <span class="chip" :class="`rblog-chip--${displayStatus(p)}`">{{ t(`blog.admin.status.${displayStatus(p)}`) }}</span>
              <span v-if="p.pinned" class="chip">{{ t('blog.admin.pinned') }}</span>
            </span>
          </div>
          <p class="subtle rblog-item__meta">
            {{ nameOf(columns.find((c) => c.id === p.columnId), p.columnSlug) }} · {{ localeLabel(p.locale) }}
            <template v-if="p.publishAt"> · {{ t('blog.admin.publishedAt', { date: dateTime(p.publishAt) }) }}</template>
          </p>
          <p class="subtle rblog-item__meta">{{ t('blog.admin.lastEdit', { name: p.editorHandle || p.authorHandle, date: dateTime(p.updatedAt) }) }}</p>
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
.rblog-side { position: sticky; top: calc(var(--header-h) + var(--s-3)); padding: var(--s-3); max-height: calc(100vh - var(--header-h) - var(--s-6)); overflow-y: auto; }
.rblog-side__toggle { display: none; }
.rblog-main { display: grid; gap: var(--s-3); min-width: 0; }
.rblog-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; }
.rblog-heading { margin: 0; font-size: 18px; min-width: 0; overflow-wrap: anywhere; }
.rblog-new[aria-disabled='true'] { opacity: 0.5; pointer-events: none; }
.rblog-hint { margin: calc(-1 * var(--s-2)) 0 0; font-size: 13px; text-align: end; }
.rblog-status { justify-self: start; }
.rblog-list { display: grid; gap: var(--s-2); }
.rblog-ghost { height: 84px; border-radius: var(--r-lg); }
.rblog-empty { padding: var(--s-6); display: grid; gap: var(--s-3); justify-items: start; }
.rblog-item { display: grid; gap: 4px; padding: var(--s-3) var(--s-4); color: var(--text); }
.rblog-item:hover { border-color: var(--line-strong); }
.rblog-item__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
.rblog-item__title { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.rblog-item__chips { display: flex; gap: var(--s-1); flex: none; }
.rblog-item__meta { margin: 0; font-size: 13px; }
.rblog-chip--published { color: var(--success); }
.rblog-chip--scheduled { color: var(--accent-text); }
.rblog-pager { display: flex; justify-content: center; gap: var(--s-2); }
@media (max-width: 767px) {
  .rblog { grid-template-columns: minmax(0, 1fr); gap: var(--s-3); }
  .rblog-side { position: static; max-height: none; padding: var(--s-2); }
  .rblog-side__toggle { display: flex; width: 100%; min-height: 44px; align-items: center; justify-content: space-between; gap: var(--s-2); padding: 0 var(--s-3); border: 0; background: transparent; color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
  .rblog-side:not(.rblog-side--open) :deep(.btree) { display: none; }
  .rblog-bar .btn { min-height: 44px; }
}
</style>
