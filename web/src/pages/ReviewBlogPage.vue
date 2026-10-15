<script setup lang="ts">
/**
 * 社群管理的「部落格」：文章列表（依狀態、欄目篩選）與欄目管理。只給本站應用的 owner／admin（HarperHarbor 團隊），服務端再判一次。
 * 欄目表單每打開一次配一個操作編號，送失敗重按沿用，成功後換新的。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError } from '@/lib/api';
import { columnName, displayStatus, fetchAdminColumns, fetchAdminPosts, POST_LOCALES, saveColumn, type AdminPostRow, type BlogColumn } from '@/lib/blog';
import { LOCALES } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { dateTime } from '@/lib/format';
import { pageTitle } from '@/lib/i18n';

const { t } = useI18n();
const session = useSession();
const { lp, locale } = useLocalePath();

/** 服務端一頁的筆數（blog.ts 的 PAGE_SIZE） */
const PAGE = 12;
const STATUSES = ['', 'draft', 'published', 'unpublished'] as const;
const status = ref<(typeof STATUSES)[number]>('');
const column = ref('');
const page = ref(1);
const items = ref<AdminPostRow[]>([]);
const total = ref(0);
const loading = ref(true);
const error = ref('');
/** 不是應用 owner／admin：整頁只說這一句（服務端回 blog_write_forbidden） */
const forbidden = ref(false);
const columns = ref<BlogColumn[]>([]);
const hasNext = computed(() => page.value * PAGE < total.value);
const localeLabel = (code: string) => LOCALES.find((l) => l.code === code)?.label ?? code;

type ColumnForm = { id?: string; slug: string; name: Record<string, string>; description: Record<string, string>; sort: number; enabled: boolean; operationId: string; busy: boolean; error: string };
const form = ref<ColumnForm | null>(null);

async function token() {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}
let generation = 0;
async function load() {
  const gen = ++generation;
  loading.value = true; error.value = '';
  try {
    const res = await fetchAdminPosts(await token(), { status: status.value, column: column.value, page: page.value });
    if (gen !== generation) return;
    items.value = res.items; total.value = res.total;
  } catch (e) {
    if (gen !== generation) return;
    if (e instanceof ApiError && e.code === 'blog_write_forbidden') forbidden.value = true;
    else error.value = e instanceof Error ? e.message : t('state.loadFailed');
  } finally { if (gen === generation) loading.value = false; }
}
async function loadColumns() {
  try { columns.value = (await fetchAdminColumns(await token())).items; } catch (e) { if (!(e instanceof ApiError && e.code === 'blog_write_forbidden')) error.value = e instanceof Error ? e.message : t('state.loadFailed'); }
}

const blank = (src: Partial<Record<string, string>> = {}) => Object.fromEntries(POST_LOCALES.map((l) => [l, src[l] ?? '']));
function edit(c?: BlogColumn) {
  form.value = {
    id: c?.id, slug: c?.slug ?? '', name: blank(c?.name), description: blank(c?.description), sort: c?.sort ?? columns.value.length,
    enabled: c?.enabled ?? true, operationId: crypto.randomUUID(), busy: false, error: '',
  };
}
async function submit() {
  const f = form.value;
  if (!f || f.busy) return;
  f.busy = true; f.error = '';
  try {
    await saveColumn(await token(), { id: f.id, slug: f.slug.trim(), name: f.name, description: f.description, sort: Number(f.sort) || 0, enabled: f.enabled }, f.operationId);
    form.value = null;
    await loadColumns();
  } catch (e) { f.error = e instanceof Error ? e.message : t('moderation.error.retry'); } finally { f.busy = false; }
}

watch([status, column], () => { page.value = 1; void load(); });
watch(page, () => { void load(); });
onMounted(() => { document.title = pageTitle(t('moderation.tab.blog')); void load(); void loadColumns(); });
</script>

<template>
  <section v-if="forbidden" class="rblog" :aria-label="t('moderation.tab.blog')">
    <p class="panel rblog-empty muted" data-forbidden>{{ t('blog.admin.managersOnly') }}</p>
  </section>
  <section v-else class="rblog" :aria-label="t('moderation.tab.blog')">
    <div class="rblog-bar">
      <div class="seg rblog-status">
        <button v-for="s in STATUSES" :key="s" type="button" class="seg__item" :class="{ 'seg__item--on': status === s }" :aria-pressed="status === s" @click="status = s">{{ s ? t(`blog.admin.status.${s}`) : t('blog.all') }}</button>
      </div>
      <select v-model="column" class="input rblog-column" :aria-label="t('blog.admin.columns')">
        <option value="">{{ t('blog.all') }}</option>
        <option v-for="c in columns" :key="c.id" :value="c.id">{{ columnName(c, locale) }}</option>
      </select>
      <RouterLink class="btn btn--primary rblog-new" :to="lp('/review/blog/new')">{{ t('blog.admin.new') }}</RouterLink>
    </div>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }} <button class="btn btn--sm" :disabled="loading" @click="load">{{ t('blog.retry') }}</button></p>

    <div class="rblog-list" :aria-busy="loading">
      <template v-if="loading && !items.length"><div v-for="n in 3" :key="n" class="ghost rblog-ghost" /></template>
      <p v-else-if="!items.length" class="panel rblog-empty muted">{{ t('blog.empty') }}</p>
      <RouterLink v-for="p in items" :key="p.id" class="panel rblog-item" :to="lp(`/review/blog/${p.id}`)" :data-post="p.id">
        <div class="rblog-item__head">
          <span class="rblog-item__title">{{ p.title }}</span>
          <span class="rblog-item__chips">
            <span class="chip" :class="`rblog-chip--${displayStatus(p)}`">{{ t(`blog.admin.status.${displayStatus(p)}`) }}</span>
            <span v-if="p.pinned" class="chip">{{ t('blog.admin.pinned') }}</span>
          </span>
        </div>
        <p class="subtle rblog-item__meta">
          {{ columnName(columns.find((c) => c.id === p.columnId), locale, p.columnSlug) }} · {{ localeLabel(p.locale) }}
          <template v-if="p.publishAt"> · {{ t('blog.admin.publishedAt', { date: dateTime(p.publishAt) }) }}</template>
        </p>
        <p class="subtle rblog-item__meta">{{ t('blog.admin.lastEdit', { name: p.editorHandle || p.authorHandle, date: dateTime(p.updatedAt) }) }}</p>
      </RouterLink>
    </div>
    <div v-if="page > 1 || hasNext" class="rblog-pager">
      <button class="btn btn--sm" :disabled="page === 1 || loading" @click="page--">{{ t('moderation.previous') }}</button>
      <button class="btn btn--sm" :disabled="!hasNext || loading" @click="page++">{{ t('moderation.next') }}</button>
    </div>

    <section class="panel rblog-columns" :aria-label="t('blog.admin.columns')">
      <div class="rblog-columns__head">
        <h2>{{ t('blog.admin.columns') }}</h2>
        <button v-if="!form" type="button" class="btn btn--sm" data-action="new-column" @click="edit()">{{ t('blog.admin.newColumn') }}</button>
      </div>
      <ul v-if="columns.length" class="rblog-columns__list">
        <li v-for="c in columns" :key="c.id" :data-column="c.id">
          <span><strong>{{ columnName(c, locale) }}</strong> <span class="subtle">/{{ c.slug }}</span></span>
          <span class="rblog-columns__side">
            <span v-if="!c.enabled" class="chip">{{ t('blog.admin.hidden') }}</span>
            <button type="button" class="btn btn--sm btn--ghost" @click="edit(c)">{{ t('blog.admin.edit') }}</button>
          </span>
        </li>
      </ul>
      <form v-if="form" class="rblog-form" @submit.prevent="submit">
        <fieldset class="rblog-form__group">
          <legend>{{ t('blog.admin.columnName') }}</legend>
          <label v-for="l in POST_LOCALES" :key="l" class="rblog-form__row">
            <span class="subtle">{{ localeLabel(l) }}</span>
            <input v-model="form.name[l]" class="input" maxlength="40" :required="l === 'zh-Hant'" :disabled="form.busy" />
          </label>
        </fieldset>
        <label class="field">
          <span>{{ t('blog.admin.slug') }}</span>
          <input v-model="form.slug" class="input" required maxlength="40" pattern="[a-z0-9][a-z0-9\-]*" autocapitalize="off" spellcheck="false" :disabled="form.busy" />
          <span class="subtle">{{ t('blog.admin.slugHint') }}</span>
        </label>
        <fieldset class="rblog-form__group">
          <legend>{{ t('blog.admin.columnDescription') }}</legend>
          <label v-for="l in POST_LOCALES" :key="l" class="rblog-form__row">
            <span class="subtle">{{ localeLabel(l) }}</span>
            <input v-model="form.description[l]" class="input" maxlength="300" :disabled="form.busy" />
          </label>
        </fieldset>
        <label class="field rblog-form__sort">
          <span>{{ t('blog.admin.sort') }}</span>
          <input v-model.number="form.sort" class="input" type="number" step="1" inputmode="numeric" :disabled="form.busy" />
        </label>
        <label class="rblog-form__check">
          <input v-model="form.enabled" type="checkbox" :disabled="form.busy" />
          <span>{{ t('blog.admin.enabled') }}</span>
        </label>
        <p v-if="form.error" class="notice notice--error" role="alert">{{ form.error }}</p>
        <div class="rblog-form__actions">
          <button type="button" class="btn" :disabled="form.busy" @click="form = null">{{ t('dialog.cancel') }}</button>
          <button class="btn btn--primary" :disabled="form.busy">{{ t('blog.admin.save') }}</button>
        </div>
      </form>
    </section>
  </section>
</template>

<style scoped>
.rblog { display: grid; gap: var(--s-4); min-width: 0; }
.rblog-bar { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
.rblog-status { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.rblog-column { width: auto; min-width: 140px; }
.rblog-new { margin-inline-start: auto; }
.rblog-list { display: grid; gap: var(--s-3); }
.rblog-ghost { height: 88px; }
.rblog-empty { padding: var(--s-5); margin: 0; }
.rblog-item { display: grid; gap: var(--s-1); padding: var(--s-4); color: var(--text); min-width: 0; overflow-wrap: anywhere; }
.rblog-item:hover .rblog-item__title { color: var(--accent-text); }
.rblog-item__head { display: flex; justify-content: space-between; gap: var(--s-2); align-items: baseline; flex-wrap: wrap; }
.rblog-item__title { font-weight: 600; }
.rblog-item__chips { display: flex; gap: var(--s-1); flex-wrap: wrap; }
.rblog-item__chips .chip { cursor: default; }
.rblog-chip--published { background: var(--accent-tint); color: var(--accent-text); }
.rblog-item__meta { margin: 0; font-size: 13px; }
.rblog-pager { display: flex; gap: var(--s-2); justify-content: center; }
.rblog-columns { padding: var(--s-4) var(--s-5); display: grid; gap: var(--s-3); }
.rblog-columns__head { display: flex; justify-content: space-between; align-items: center; gap: var(--s-2); }
.rblog-columns__head h2 { font-size: 17px; }
.rblog-columns__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.rblog-columns__list li { display: flex; justify-content: space-between; align-items: center; gap: var(--s-2); flex-wrap: wrap; padding-bottom: var(--s-2); border-bottom: 1px solid var(--line); }
.rblog-columns__side { display: flex; gap: var(--s-2); align-items: center; }
.rblog-form { display: grid; gap: var(--s-3); }
.rblog-form .field { margin: 0; }
.rblog-form__group { border: 0; margin: 0; padding: 0; display: grid; gap: var(--s-2); min-width: 0; }
.rblog-form__group legend { font-size: 13px; font-weight: 600; margin-bottom: var(--s-2); }
.rblog-form__row { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: var(--s-2); align-items: center; }
.rblog-form__sort .input { max-width: 120px; }
.rblog-form__check { display: flex; gap: var(--s-2); align-items: center; min-height: 44px; }
.rblog-form__actions { display: flex; gap: var(--s-2); justify-content: flex-end; }
@media (max-width: 760px) {
  .rblog-columns { padding: var(--s-4); }
  .rblog-new { margin-inline-start: 0; }
  .rblog-column { flex: 1; }
  .rblog-form__row { grid-template-columns: minmax(0, 1fr); gap: var(--s-1); }
  .rblog .btn, .rblog .input { min-height: 44px; }
}
</style>
